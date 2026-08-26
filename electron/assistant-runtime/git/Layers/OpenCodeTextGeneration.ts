// @ts-nocheck
import { Duration, Effect, Exit, Fiber, Layer, Schema, Scope } from "effect";
import * as Semaphore from "effect/Semaphore";

import {
  type ChatAttachment,
  type OpenCodeModelSelection,
} from "@cozea/assistant-contracts";
import { getModelSelectionStringOptionValue } from "@cozea/assistant-shared/model";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@cozea/assistant-shared/git";

import { ServerConfig } from "../../config.ts";
import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "../Prompts.ts";
import { type TextGenerationShape, TextGeneration } from "../Services/TextGeneration.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
} from "../Utils.ts";
import {
  createOpenCodeSdkClient,
  type OpenCodeServerConnection,
  type OpenCodeServerProcess,
  parseOpenCodeModelSlug,
  startOpenCodeServerProcess,
  toOpenCodeFileParts,
} from "../../provider/opencodeRuntime.ts";
import { mergeProviderInstanceEnvironment } from "../../provider/ProviderInstanceEnvironment.ts";

/** Extract a human-readable error message from an OpenCode prompt response error. */
function getOpenCodePromptErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const message =
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
      ? error.data.message.trim()
      : "";
  if (message.length > 0) {
    return message;
  }

  if ("name" in error && typeof error.name === "string") {
    const name = error.name.trim();
    return name.length > 0 ? name : null;
  }

  return null;
}

/** Extract concatenated text content from OpenCode response parts. */
function getOpenCodeTextResponse(parts: ReadonlyArray<unknown> | undefined): string {
  return (parts ?? [])
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      if (!("type" in part) || part.type !== "text") {
        return [];
      }
      if (!("text" in part) || typeof part.text !== "string") {
        return [];
      }
      return [part.text];
    })
    .join("")
    .trim();
}

/** Extract the outermost JSON object from raw text, handling embedded braces. */
function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  if (start < 0) {
    return trimmed;
  }

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return trimmed.slice(start);
}

/**
 * Build a stable, order-independent key for a set of per-instance environment
 * overrides so the shared OpenCode server is only reused when the environment
 * matches the one it was started with.
 */
function buildEnvironmentKey(
  environment: ReadonlyArray<{ readonly name: string; readonly value: string }> | undefined,
): string {
  if (!environment || environment.length === 0) {
    return "";
  }
  return JSON.stringify(
    [...environment]
      .map((variable) => [variable.name, variable.value] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}

const OPENCODE_TEXT_GENERATION_IDLE_TTL_MS = 30_000;

interface SharedOpenCodeTextGenerationServerState {
  server: OpenCodeServerProcess | null;
  binaryPath: string | null;
  /**
   * Stable serialization of the per-instance environment the active server was
   * started with. Two instances may share a binaryPath but carry different
   * environment overrides; reuse must key on both so a request never silently
   * runs against another instance's environment.
   */
  environmentKey: string | null;
  activeRequests: number;
  idleCloseFiber: Fiber.Fiber<void, never> | null;
}

const makeOpenCodeTextGeneration = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;
  const serverSettingsService = yield* ServerSettingsService;
  const idleFiberScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const sharedServerMutex = yield* Semaphore.make(1);
  const sharedServerState: SharedOpenCodeTextGenerationServerState = {
    server: null,
    binaryPath: null,
    environmentKey: null,
    activeRequests: 0,
    idleCloseFiber: null,
  };

  const closeSharedServer = (server: OpenCodeServerProcess) => {
    if (sharedServerState.server === server) {
      sharedServerState.server = null;
      sharedServerState.binaryPath = null;
      sharedServerState.environmentKey = null;
    }
    server.close();
  };

  const cancelIdleCloseFiber = Effect.fn(function* () {
    const idleCloseFiber = sharedServerState.idleCloseFiber;
    sharedServerState.idleCloseFiber = null;
    if (idleCloseFiber !== null) {
      yield* Fiber.interrupt(idleCloseFiber).pipe(Effect.ignore);
    }
  });

  const scheduleIdleClose = Effect.fn(function* (server: OpenCodeServerProcess) {
    yield* cancelIdleCloseFiber();
    const fiber = yield* Effect.sleep(Duration.millis(OPENCODE_TEXT_GENERATION_IDLE_TTL_MS)).pipe(
      Effect.andThen(
        sharedServerMutex.withPermit(
          Effect.sync(() => {
            if (sharedServerState.server !== server || sharedServerState.activeRequests > 0) {
              return;
            }
            sharedServerState.idleCloseFiber = null;
            closeSharedServer(server);
          }),
        ),
      ),
      Effect.forkIn(idleFiberScope),
    );
    sharedServerState.idleCloseFiber = fiber;
  });

  const acquireSharedServer = (input: {
    readonly binaryPath: string;
    readonly environment?: NodeJS.ProcessEnv;
    /**
     * Stable key for the per-instance environment overrides; servers are only
     * reused when both binaryPath and environmentKey match.
     */
    readonly environmentKey: string;
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
  }) =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        yield* cancelIdleCloseFiber();

        const existingServer = sharedServerState.server;
        if (existingServer !== null) {
          const binaryPathMismatch = sharedServerState.binaryPath !== input.binaryPath;
          const environmentMismatch = sharedServerState.environmentKey !== input.environmentKey;
          const mismatch = binaryPathMismatch || environmentMismatch;
          if (mismatch && sharedServerState.activeRequests === 0) {
            closeSharedServer(existingServer);
          } else {
            if (mismatch) {
              yield* Effect.logWarning(
                "OpenCode shared server config mismatch (" +
                  (binaryPathMismatch
                    ? "binaryPath: requested " +
                      input.binaryPath +
                      " but active server uses " +
                      sharedServerState.binaryPath
                    : "environment override") +
                  "); reusing existing server because there are active requests",
              );
            }
            sharedServerState.activeRequests += 1;
            return existingServer;
          }
        }

        const server = yield* Effect.tryPromise({
          try: () =>
            startOpenCodeServerProcess({
              binaryPath: input.binaryPath,
              ...(input.environment ? { environment: input.environment } : {}),
            }),
          catch: (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: cause instanceof Error ? cause.message : "Failed to start OpenCode server.",
              cause,
            }),
        });

        sharedServerState.server = server;
        sharedServerState.binaryPath = input.binaryPath;
        sharedServerState.environmentKey = input.environmentKey;
        sharedServerState.activeRequests = 1;
        return server;
      }),
    );

  const releaseSharedServer = (server: OpenCodeServerProcess) =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        if (sharedServerState.server !== server) {
          return;
        }
        sharedServerState.activeRequests = Math.max(0, sharedServerState.activeRequests - 1);
        if (sharedServerState.activeRequests === 0) {
          yield* scheduleIdleClose(server);
        }
      }),
    );

  yield* Effect.addFinalizer(() =>
    sharedServerMutex.withPermit(
      Effect.gen(function* () {
        yield* cancelIdleCloseFiber();
        const server = sharedServerState.server;
        sharedServerState.server = null;
        sharedServerState.binaryPath = null;
        sharedServerState.environmentKey = null;
        sharedServerState.activeRequests = 0;
        if (server !== null) {
          server.close();
        }
      }),
    ),
  );

  const runOpenCodeJson = Effect.fn(function* <S extends Schema.Top>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    readonly cwd: string;
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly modelSelection: OpenCodeModelSelection;
    readonly attachments?: ReadonlyArray<ChatAttachment> | undefined;
  }) {
    const parsedModel = parseOpenCodeModelSlug(input.modelSelection.model);
    if (!parsedModel) {
      return yield* new TextGenerationError({
        operation: input.operation,
        detail: "OpenCode model selection must use the 'provider/model' format.",
      });
    }

    const settings = yield* serverSettingsService.getSettings.pipe(
      Effect.map(
        (value) =>
          value.providers?.opencode ?? {
            enabled: true,
            binaryPath: "opencode",
            serverUrl: "",
            serverPassword: "",
            customModels: [],
          },
      ),
      Effect.orElseSucceed(() => ({
        enabled: true,
        binaryPath: "opencode",
        serverUrl: "",
        serverPassword: "",
        customModels: [],
      })),
    );

    const fileParts = toOpenCodeFileParts({
      attachments: input.attachments,
      resolveAttachmentPath: (attachment) =>
        resolveAttachmentPath({ attachmentsDir: serverConfig.attachmentsDir, attachment }),
    });

    const runAgainstServer = (server: Pick<OpenCodeServerConnection, "url">) =>
      Effect.tryPromise({
        try: async () => {
          const client = createOpenCodeSdkClient({
            baseUrl: server.url,
            directory: input.cwd,
            ...(settings.serverUrl.length > 0 && settings.serverPassword
              ? { serverPassword: settings.serverPassword }
              : {}),
          });
          const session = await client.session.create({
            title: `Cozea ${input.operation}`,
            permission: [{ permission: "*", pattern: "*", action: "deny" }],
          });
          if (!session.data) {
            throw new Error("OpenCode session.create returned no session payload.");
          }

          const selectedAgent = getModelSelectionStringOptionValue(input.modelSelection, "agent");
          const selectedVariant = getModelSelectionStringOptionValue(input.modelSelection, "variant");

          const result = await client.session.prompt({
            sessionID: session.data.id,
            model: parsedModel,
            ...(selectedAgent ? { agent: selectedAgent } : {}),
            ...(selectedVariant ? { variant: selectedVariant } : {}),
            parts: [{ type: "text", text: input.prompt }, ...fileParts],
          });

          // Check for provider-level errors in the response.
          const errorMessage = getOpenCodePromptErrorMessage(result.data?.info?.error);
          if (errorMessage) {
            throw new Error(errorMessage);
          }

          // Extract raw text from response parts (same approach as T3).
          const rawText = getOpenCodeTextResponse(result.data?.parts);
          if (rawText.length === 0) {
            throw new Error("OpenCode returned empty output.");
          }
          return rawText;
        },
        catch: (cause) =>
          new TextGenerationError({
            operation: input.operation,
            detail:
              cause instanceof Error ? cause.message : "OpenCode text generation request failed.",
            cause,
          }),
      });

    const rawOutput =
      settings.serverUrl.length > 0
        ? yield* runAgainstServer({ url: settings.serverUrl })
        : yield* Effect.acquireUseRelease(
            acquireSharedServer({
              binaryPath: settings.binaryPath,
              environment: mergeProviderInstanceEnvironment(settings.environment, process.env),
              environmentKey: buildEnvironmentKey(settings.environment),
              operation: input.operation,
            }),
            runAgainstServer,
            releaseSharedServer,
          );

    return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson))(
      extractJsonObject(rawOutput),
    ).pipe(
      Effect.catchTag("SchemaError", (cause) =>
        Effect.fail(
          new TextGenerationError({
            operation: input.operation,
            detail: "OpenCode returned invalid structured output.",
            cause,
          }),
        ),
      ),
    );
  });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = Effect.fn(
    "OpenCodeTextGeneration.generateCommitMessage",
  )(function* (input) {
    if (input.modelSelection.provider !== "opencode") {
      return yield* new TextGenerationError({
        operation: "generateCommitMessage",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: input.includeBranch === true,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      subject: sanitizeCommitSubject(generated.subject),
      body: generated.body.trim(),
      ...("branch" in generated && typeof generated.branch === "string"
        ? { branch: sanitizeFeatureBranchName(generated.branch) }
        : {}),
    };
  });

  const generatePrContent: TextGenerationShape["generatePrContent"] = Effect.fn(
    "OpenCodeTextGeneration.generatePrContent",
  )(function* (input) {
    if (input.modelSelection.provider !== "opencode") {
      return yield* new TextGenerationError({
        operation: "generatePrContent",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
    });

    return {
      title: sanitizePrTitle(generated.title),
      body: generated.body.trim(),
    };
  });

  const generateBranchName: TextGenerationShape["generateBranchName"] = Effect.fn(
    "OpenCodeTextGeneration.generateBranchName",
  )(function* (input) {
    if (input.modelSelection.provider !== "opencode") {
      return yield* new TextGenerationError({
        operation: "generateBranchName",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildBranchNamePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateBranchName",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      branch: sanitizeBranchFragment(generated.branch),
    };
  });

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = Effect.fn(
    "OpenCodeTextGeneration.generateThreadTitle",
  )(function* (input) {
    if (input.modelSelection.provider !== "opencode") {
      return yield* new TextGenerationError({
        operation: "generateThreadTitle",
        detail: "Invalid model selection.",
      });
    }

    const { prompt, outputSchema } = buildThreadTitlePrompt({
      message: input.message,
      attachments: input.attachments,
    });
    const generated = yield* runOpenCodeJson({
      operation: "generateThreadTitle",
      cwd: input.cwd,
      prompt,
      outputSchemaJson: outputSchema,
      modelSelection: input.modelSelection,
      attachments: input.attachments,
    });

    return {
      title: sanitizeThreadTitle(generated.title),
    };
  });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});

export const OpenCodeTextGenerationLive = Layer.effect(TextGeneration, makeOpenCodeTextGeneration);
