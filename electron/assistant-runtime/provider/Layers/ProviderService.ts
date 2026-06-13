// @ts-nocheck
/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  ProviderInterruptTurnInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  defaultInstanceIdForDriver,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@cozea/assistant-contracts";
import { Effect, Fiber, Layer, Option, PubSub, Queue, Ref, Schema, SchemaIssue, Stream } from "effect";

import { ProviderValidationError } from "../Errors.ts";
import { ProviderAdapterRegistry } from "../Services/ProviderAdapterRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../Services/ProviderSessionDirectory.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { AnalyticsService } from "../../telemetry/Services/AnalyticsService.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { type ProviderSessionRuntimePayload } from "../../persistence/Services/ProviderSessionRuntime.ts";
import { isProviderInstanceEnabled } from "../ProviderInstanceScopedSettings.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
}

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const decodeInputOrValidationError = <S extends Schema.Top>(input: {
  readonly operation: string;
  readonly schema: S;
  readonly payload: unknown;
}) =>
  Schema.decodeUnknownEffect(input.schema)(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: ModelSelection;
    readonly interactionMode?: ProviderSessionRuntimePayload["interactionMode"];
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
    readonly sessionUpdatedAt?: string;
  },
): ProviderSessionRuntimePayload {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.interactionMode !== undefined ? { interactionMode: extra.interactionMode } : {}),
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
    ...(extra?.sessionUpdatedAt !== undefined ? { sessionUpdatedAt: extra.sessionUpdatedAt } : {}),
  };
}

function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return Schema.is(ModelSelection)(raw) ? raw : undefined;
}

function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function runtimePayloadFromEvent(event: ProviderRuntimeEvent): ProviderSessionRuntimePayload {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : undefined;
  const state = typeof payload?.state === "string" ? payload.state : undefined;
  const reason = typeof payload?.reason === "string" ? payload.reason : undefined;
  const message = typeof payload?.message === "string" ? payload.message : undefined;

  return {
    cwd: null,
    model: null,
    activeTurnId:
      event.type === "turn.completed" || event.type === "turn.aborted"
        ? null
        : (event.turnId ?? null),
    lastError:
      event.type === "runtime.error"
        ? message ?? reason ?? null
        : state === "error"
          ? reason ?? message ?? null
          : null,
    lastRuntimeEvent: event.type,
    lastRuntimeEventAt: event.createdAt,
    sessionUpdatedAt: event.createdAt,
  };
}

function withDefaultProviderInstanceId(event: ProviderRuntimeEvent): ProviderRuntimeEvent {
  return event.providerInstanceId !== undefined
    ? event
    : {
        ...event,
        providerInstanceId: defaultInstanceIdForDriver(event.provider),
      };
}

function runtimeStatusFromEvent(
  event: ProviderRuntimeEvent,
): ProviderRuntimeBinding["status"] | undefined {
  const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : undefined;
  const state = typeof payload?.state === "string" ? payload.state.toLowerCase() : undefined;

  if (event.type === "runtime.error") {
    return "error";
  }
  if (event.type === "session.exited") {
    return "stopped";
  }
  if (event.type === "turn.started" || event.type === "session.started" || event.type === "thread.started") {
    return "running";
  }
  if (event.type === "turn.completed" || event.type === "turn.aborted") {
    return "running";
  }
  if (event.type === "session.state.changed" || event.type === "thread.state.changed") {
    if (state === "error" || state === "failed") {
      return "error";
    }
    if (state === "closed" || state === "stopped" || state === "idle" || state === "exited") {
      return "stopped";
    }
    return "running";
  }
  return undefined;
}

const makeProviderService = (options?: ProviderServiceLiveOptions) =>
  Effect.gen(function* () {
    const analytics = yield* Effect.service(AnalyticsService);
    const serverSettings = yield* ServerSettingsService;
    const canonicalEventLogger =
      options?.canonicalEventLogger ??
      (options?.canonicalEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
            stream: "canonical",
          })
        : undefined);

    const registry = yield* ProviderAdapterRegistry;
    const directory = yield* ProviderSessionDirectory;
    const runtimeEventQueue = yield* Queue.unbounded<ProviderRuntimeEvent>();
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const withOperationAnalytics = <A, E>(input: {
      readonly operation: string;
      readonly details?: Record<string, unknown>;
      readonly effect: Effect.Effect<A, E>;
    }): Effect.Effect<A, E> =>
      Effect.gen(function* () {
        const startedAt = Date.now();
        const exit = yield* Effect.exit(input.effect);
        const durationMs = Date.now() - startedAt;
        const success = exit._tag === "Success";
        yield* analytics.record("provider.operation", {
          operation: input.operation,
          success,
          durationMs,
          ...input.details,
        });
        if (success) {
          return exit.value;
        }
        return yield* Effect.failCause(exit.cause);
      });

    const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
      Effect.succeed(event).pipe(
        Effect.tap((canonicalEvent) =>
          canonicalEventLogger
            ? canonicalEventLogger.write(canonicalEvent, canonicalEvent.threadId)
            : Effect.void,
        ),
        Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
        Effect.asVoid,
      );

    const upsertSessionBinding = (
      session: ProviderSession,
      threadId: ThreadId,
      extra?: {
        readonly modelSelection?: ModelSelection;
        readonly interactionMode?: ProviderSessionRuntimePayload["interactionMode"];
        readonly lastRuntimeEvent?: string;
        readonly lastRuntimeEventAt?: string;
      },
    ) =>
      directory.upsert({
        threadId,
        provider: session.provider,
        providerInstanceId: session.providerInstanceId ?? defaultInstanceIdForDriver(session.provider),
        runtimeMode: session.runtimeMode,
        status: toRuntimeStatus(session),
        ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
        runtimePayload: toRuntimePayloadFromSession(session, {
          ...extra,
          sessionUpdatedAt: session.updatedAt,
        }),
      });

    const processRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> => {
      const canonicalEvent = withDefaultProviderInstanceId(event);
      return directory
        .upsert({
          threadId: canonicalEvent.threadId,
          provider: canonicalEvent.provider,
          providerInstanceId: canonicalEvent.providerInstanceId,
          ...(runtimeStatusFromEvent(canonicalEvent)
            ? { status: runtimeStatusFromEvent(canonicalEvent) }
            : {}),
          runtimePayload: runtimePayloadFromEvent(canonicalEvent),
        })
        .pipe(
          Effect.catchCause(() =>
            Effect.logWarning("provider.runtime-event.persist-failed", {
              threadId: canonicalEvent.threadId,
              provider: canonicalEvent.provider,
              providerInstanceId: canonicalEvent.providerInstanceId,
              eventType: canonicalEvent.type,
            }),
          ),
          Effect.flatMap(() => publishRuntimeEvent(canonicalEvent)),
        );
    };

    const worker = Effect.forever(
      Queue.take(runtimeEventQueue).pipe(Effect.flatMap(processRuntimeEvent)),
    );
    yield* Effect.forkScoped(worker);

    // Each subscribed instance keeps its adapter plus the fiber draining its
    // streamEvents into runtimeEventQueue, so the fiber can be interrupted when
    // the instance is removed or its adapter is replaced. Without this, the
    // forkScoped fiber lives until the whole ProviderService scope closes and
    // (for adapters whose stream does not terminate on child-scope close) leaks.
    const subscribedAdapters = yield* Ref.make(
      new Map<
        unknown,
        { readonly adapter: unknown; readonly fiber: Fiber.Fiber<void, never> }
      >(),
    );
    const getAdapterEntries = Ref.get(subscribedAdapters).pipe(
      Effect.map((map) => Array.from(map.entries(), ([instanceId, value]) => [instanceId, value.adapter] as const)),
    );
    const reconcileInstanceSubscriptions = Effect.gen(function* () {
      const previous = yield* Ref.get(subscribedAdapters);
      const instanceIds = yield* registry.listInstances();
      const next = new Map<
        unknown,
        { readonly adapter: unknown; readonly fiber: Fiber.Fiber<void, never> }
      >();
      const retained = new Set();
      for (const instanceId of instanceIds) {
        const adapterOption = yield* registry
          .getByInstance(instanceId)
          .pipe(Effect.tapError(Effect.logWarning), Effect.option);
        if (Option.isNone(adapterOption)) {
          continue;
        }
        const adapter = adapterOption.value;
        const existing = previous.get(instanceId);
        if (existing && existing.adapter === adapter) {
          next.set(instanceId, existing);
          retained.add(instanceId);
          continue;
        }
        // Adapter replaced for this instance id: interrupt the stale drain fiber.
        if (existing) {
          yield* Fiber.interrupt(existing.fiber);
        }
        const fiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
          Queue.offer(runtimeEventQueue, event).pipe(Effect.asVoid),
        ).pipe(Effect.forkScoped);
        next.set(instanceId, { adapter, fiber });
        retained.add(instanceId);
      }
      // Interrupt drain fibers for instances that were removed entirely.
      for (const [instanceId, value] of previous) {
        if (!retained.has(instanceId)) {
          yield* Fiber.interrupt(value.fiber);
        }
      }
      yield* Ref.set(subscribedAdapters, next);
    });

    const instanceChanges = yield* registry.subscribeChanges;
    yield* reconcileInstanceSubscriptions;
    yield* Stream.runForEach(
      Stream.fromSubscription(instanceChanges),
      () => reconcileInstanceSubscriptions,
    ).pipe(Effect.forkScoped);

    // Resolve the adapter for a persisted binding. If the binding's instance id
    // no longer exists in the registry (e.g. the user removed a custom provider
    // instance from settings), fall back to the driver's default instance so the
    // thread keeps routing instead of hard-failing every op with
    // ProviderUnsupportedError. Built-in default instances are always registered.
    const resolveAdapterForBinding = (binding: ProviderRuntimeBinding) =>
      Effect.gen(function* () {
        const bindingInstanceId =
          binding.providerInstanceId ?? defaultInstanceIdForDriver(binding.provider);
        const defaultInstanceId = defaultInstanceIdForDriver(binding.provider);
        const adapterOption = yield* registry.getByInstance(bindingInstanceId).pipe(
          Effect.map(Option.some),
          Effect.catchTag("ProviderUnsupportedError", () => Effect.succeed(Option.none())),
        );
        if (Option.isSome(adapterOption)) {
          return { adapter: adapterOption.value, providerInstanceId: bindingInstanceId } as const;
        }
        if (defaultInstanceId === bindingInstanceId) {
          return yield* registry
            .getByInstance(bindingInstanceId)
            .pipe(Effect.map((adapter) => ({ adapter, providerInstanceId: bindingInstanceId }) as const));
        }
        yield* Effect.logWarning("provider.routing.instance-fallback", {
          threadId: binding.threadId,
          provider: binding.provider,
          missingInstanceId: bindingInstanceId,
          fallbackInstanceId: defaultInstanceId,
        });
        const adapter = yield* registry.getByInstance(defaultInstanceId);
        return { adapter, providerInstanceId: defaultInstanceId } as const;
      });

    const recoverSessionForThread = (input: {
      readonly binding: ProviderRuntimeBinding;
      readonly operation: string;
    }) =>
      Effect.gen(function* () {
        const { adapter, providerInstanceId: bindingInstanceId } =
          yield* resolveAdapterForBinding(input.binding);
        const hasResumeCursor =
          input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
        const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
        if (hasActiveSession) {
          const activeSessions = yield* adapter.listSessions();
          const existing = activeSessions.find(
            (session) => session.threadId === input.binding.threadId,
          );
          if (existing) {
            yield* upsertSessionBinding(
              { ...existing, providerInstanceId: bindingInstanceId },
              input.binding.threadId,
            );
            yield* analytics.record("provider.session.recovered", {
              provider: existing.provider,
              strategy: "adopt-existing",
              hasResumeCursor: existing.resumeCursor !== undefined,
            });
            return { adapter, session: existing } as const;
          }
        }

        if (!hasResumeCursor) {
          return yield* toValidationError(
            input.operation,
            `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
          );
        }

        const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
        const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);

        const resumed = yield* adapter.startSession({
          threadId: input.binding.threadId,
          provider: input.binding.provider,
          providerInstanceId: bindingInstanceId,
          ...(persistedCwd ? { cwd: persistedCwd } : {}),
          ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
          ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
          runtimeMode: input.binding.runtimeMode ?? "full-access",
        });
        if (resumed.provider !== adapter.provider) {
          return yield* toValidationError(
            input.operation,
            `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
          );
        }

        yield* upsertSessionBinding(
          { ...resumed, providerInstanceId: bindingInstanceId },
          input.binding.threadId,
        );
        yield* analytics.record("provider.session.recovered", {
          provider: resumed.provider,
          strategy: "resume-thread",
          hasResumeCursor: resumed.resumeCursor !== undefined,
        });
        return { adapter, session: resumed } as const;
      });

    const resolveRoutableSession = (input: {
      readonly threadId: ThreadId;
      readonly operation: string;
      readonly allowRecovery: boolean;
    }) =>
      Effect.gen(function* () {
        const bindingOption = yield* directory.getBinding(input.threadId);
        const binding = Option.getOrUndefined(bindingOption);
        if (!binding) {
          return yield* toValidationError(
            input.operation,
            `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
          );
        }
        const { adapter, providerInstanceId: bindingInstanceId } =
          yield* resolveAdapterForBinding(binding);

        const hasRequestedSession = yield* adapter.hasSession(input.threadId);
        if (hasRequestedSession) {
          return {
            adapter,
            threadId: input.threadId,
            providerInstanceId: bindingInstanceId,
            isActive: true,
          } as const;
        }

        if (!input.allowRecovery) {
          return {
            adapter,
            threadId: input.threadId,
            providerInstanceId: bindingInstanceId,
            isActive: false,
          } as const;
        }

        const recovered = yield* recoverSessionForThread({ binding, operation: input.operation });
        return {
          adapter: recovered.adapter,
          threadId: input.threadId,
          providerInstanceId: bindingInstanceId,
          isActive: true,
        } as const;
      });

    const stopStaleSessionsForThread = (input: {
      readonly threadId: ThreadId;
      readonly currentProviderInstanceId: ProviderSession["providerInstanceId"];
    }) =>
      getAdapterEntries.pipe(
        Effect.flatMap((adapters) =>
          Effect.forEach(
            adapters,
            ([instanceId, adapter]) =>
              instanceId === input.currentProviderInstanceId
                ? Effect.void
                : Effect.gen(function* () {
                    const hasSession = yield* adapter.hasSession(input.threadId);
                    if (!hasSession) {
                      return;
                    }

                    yield* adapter.stopSession(input.threadId).pipe(
                      Effect.tap(() =>
                        analytics.record("provider.session.stopped", {
                          provider: adapter.provider,
                        }),
                      ),
                      Effect.catchCause((cause) =>
                        Effect.logWarning("provider.session.stop-stale-failed", {
                          threadId: input.threadId,
                          provider: adapter.provider,
                          cause,
                        }),
                      ),
                    );
                  }),
            { discard: true },
          ),
        ),
      );

    const startSession: ProviderServiceShape["startSession"] = (threadId, rawInput) =>
      withOperationAnalytics({
        operation: "provider.startSession",
        details: { threadId },
        effect: Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.startSession",
          schema: ProviderSessionStartInput,
          payload: rawInput,
        });

        const requestedProvider = parsed.provider ?? parsed.modelSelection?.provider ?? "codex";
        const providerInstanceId =
          parsed.providerInstanceId ??
          parsed.modelSelection?.instanceId ??
          defaultInstanceIdForDriver(requestedProvider);
        const adapter = yield* registry.getByInstance(providerInstanceId);
        if (parsed.provider !== undefined && parsed.provider !== adapter.provider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${providerInstanceId}' belongs to '${adapter.provider}', not '${parsed.provider}'.`,
          );
        }
        const input = {
          ...parsed,
          threadId,
          provider: adapter.provider,
          providerInstanceId,
        };
        const settings = yield* serverSettings.getSettings.pipe(
          Effect.mapError((error) =>
            toValidationError(
              "ProviderService.startSession",
              `Failed to load provider settings: ${error.message}`,
              error,
            ),
          ),
        );
        if (
          !isProviderInstanceEnabled({
            settings,
            provider: adapter.provider,
            instanceId: providerInstanceId,
          })
        ) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${providerInstanceId}' is disabled in Cozea settings.`,
          );
        }
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor =
          input.resumeCursor ??
          (persistedBinding?.providerInstanceId === providerInstanceId
            ? persistedBinding.resumeCursor
            : undefined);
        const effectiveCwd =
          input.cwd ??
          (persistedBinding?.providerInstanceId === providerInstanceId
            ? readPersistedCwd(persistedBinding.runtimePayload)
            : undefined);
        const session = yield* adapter.startSession({
          ...input,
          providerInstanceId,
          ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
          ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
        });

        if (session.provider !== adapter.provider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
          );
        }

        yield* stopStaleSessionsForThread({
          threadId,
          currentProviderInstanceId: providerInstanceId,
        });
        const sessionWithInstance = {
          ...session,
          providerInstanceId,
        };
        yield* upsertSessionBinding(sessionWithInstance, threadId, {
          modelSelection: input.modelSelection,
        });
        yield* analytics.record("provider.session.started", {
          provider: session.provider,
          runtimeMode: input.runtimeMode,
          providerInstanceId,
          hasResumeCursor: sessionWithInstance.resumeCursor !== undefined,
          hasCwd: typeof effectiveCwd === "string" && effectiveCwd.trim().length > 0,
          hasModel:
            typeof input.modelSelection?.model === "string" &&
            input.modelSelection.model.trim().length > 0,
        });

        return sessionWithInstance;
        }),
      });

    const sendTurn: ProviderServiceShape["sendTurn"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.sendTurn",
        effect: Effect.gen(function* () {
        const parsed = yield* decodeInputOrValidationError({
          operation: "ProviderService.sendTurn",
          schema: ProviderSendTurnInput,
          payload: rawInput,
        });

        const input = {
          ...parsed,
          attachments: parsed.attachments ?? [],
        };
        if (!input.input && input.attachments.length === 0) {
          return yield* toValidationError(
            "ProviderService.sendTurn",
            "Either input text or at least one attachment is required",
          );
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.sendTurn",
          allowRecovery: true,
        });
        const turn = yield* routed.adapter.sendTurn(input);
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          providerInstanceId: routed.providerInstanceId,
          status: "running",
          ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
          runtimePayload: {
            ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
            ...(input.interactionMode !== undefined ? { interactionMode: input.interactionMode } : {}),
            activeTurnId: turn.turnId,
            lastRuntimeEvent: "provider.sendTurn",
            lastRuntimeEventAt: new Date().toISOString(),
            sessionUpdatedAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.turn.sent", {
          provider: routed.adapter.provider,
          model: input.modelSelection?.model,
          interactionMode: input.interactionMode,
          attachmentCount: input.attachments.length,
          hasInput: typeof input.input === "string" && input.input.trim().length > 0,
        });
        return turn;
        }),
      });

    const interruptTurn: ProviderServiceShape["interruptTurn"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.interruptTurn",
        effect: Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.interruptTurn",
          schema: ProviderInterruptTurnInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.interruptTurn",
          allowRecovery: true,
        });
        yield* routed.adapter.interruptTurn(routed.threadId, input.turnId);
        yield* analytics.record("provider.turn.interrupted", {
          provider: routed.adapter.provider,
        });
        }),
      });

    const respondToRequest: ProviderServiceShape["respondToRequest"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.respondToRequest",
        effect: Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToRequest",
          schema: ProviderRespondToRequestInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
        yield* analytics.record("provider.request.responded", {
          provider: routed.adapter.provider,
          decision: input.decision,
        });
        }),
      });

    const respondToUserInput: ProviderServiceShape["respondToUserInput"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.respondToUserInput",
        effect: Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.respondToUserInput",
          schema: ProviderRespondToUserInputInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToUserInput",
          allowRecovery: true,
        });
        yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
        }),
      });

    const stopSession: ProviderServiceShape["stopSession"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.stopSession",
        effect: Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.stopSession",
          schema: ProviderStopSessionInput,
          payload: rawInput,
        });
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSession",
          allowRecovery: false,
        });
        if (routed.isActive) {
          yield* routed.adapter.stopSession(routed.threadId);
        }
        yield* directory.upsert({
          threadId: input.threadId,
          provider: routed.adapter.provider,
          providerInstanceId: routed.providerInstanceId,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
            lastRuntimeEvent: "provider.stopSession",
            lastRuntimeEventAt: new Date().toISOString(),
            sessionUpdatedAt: new Date().toISOString(),
          },
        });
        yield* analytics.record("provider.session.stopped", {
          provider: routed.adapter.provider,
        });
        }),
      });

    const listSessions: ProviderServiceShape["listSessions"] = () =>
      Effect.gen(function* () {
        const adapterEntries = yield* getAdapterEntries;
        const sessionsByProvider = yield* Effect.forEach(adapterEntries, ([, adapter]) =>
          adapter.listSessions(),
        );
        const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
        const persistedBindings = yield* directory.listThreadIds().pipe(
          Effect.flatMap((threadIds) =>
            Effect.forEach(
              threadIds,
              (threadId) =>
                directory
                  .getBinding(threadId)
                  .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
              { concurrency: "unbounded" },
            ),
          ),
          Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
        );
        const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
        for (const bindingOption of persistedBindings) {
          const binding = Option.getOrUndefined(bindingOption);
          if (binding) {
            bindingsByThreadId.set(binding.threadId, binding);
          }
        }

        return activeSessions.map((session) => {
          const binding = bindingsByThreadId.get(session.threadId);
          if (!binding) {
            return session;
          }

          const overrides: {
            resumeCursor?: ProviderSession["resumeCursor"];
            runtimeMode?: ProviderSession["runtimeMode"];
            providerInstanceId?: ProviderSession["providerInstanceId"];
          } = {};
          overrides.providerInstanceId =
            binding.providerInstanceId ?? defaultInstanceIdForDriver(binding.provider);
          if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
            overrides.resumeCursor = binding.resumeCursor;
          }
          if (binding.runtimeMode !== undefined) {
            overrides.runtimeMode = binding.runtimeMode;
          }
          return Object.assign({}, session, overrides);
        });
      });

    const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
      registry.getByProvider(provider).pipe(Effect.map((adapter) => adapter.capabilities));

    const rollbackConversation: ProviderServiceShape["rollbackConversation"] = (rawInput) =>
      withOperationAnalytics({
        operation: "provider.rollbackConversation",
        effect: Effect.gen(function* () {
        const input = yield* decodeInputOrValidationError({
          operation: "ProviderService.rollbackConversation",
          schema: ProviderRollbackConversationInput,
          payload: rawInput,
        });
        if (input.numTurns === 0) {
          return;
        }
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.rollbackConversation",
          allowRecovery: true,
        });
        yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
        yield* analytics.record("provider.conversation.rolled_back", {
          provider: routed.adapter.provider,
          turns: input.numTurns,
        });
        }),
      });

    const runStopAll = () =>
      Effect.gen(function* () {
        const threadIds = yield* directory.listThreadIds();
        const adapterEntries = yield* getAdapterEntries;
        const activeSessions = yield* Effect.forEach(adapterEntries, ([, adapter]) =>
          adapter.listSessions(),
        ).pipe(
          Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)),
        );
        yield* Effect.forEach(activeSessions, (session) =>
          upsertSessionBinding(session, session.threadId, {
            lastRuntimeEvent: "provider.stopAll",
            lastRuntimeEventAt: new Date().toISOString(),
          }),
        ).pipe(Effect.asVoid);
        yield* Effect.forEach(adapterEntries, ([, adapter]) => adapter.stopAll()).pipe(Effect.asVoid);
        yield* Effect.forEach(threadIds, (threadId) =>
          directory.getBinding(threadId).pipe(
            Effect.flatMap((bindingOption) =>
              Option.match(bindingOption, {
                onNone: () => Effect.void,
                onSome: (binding) =>
                  directory.upsert({
                    threadId,
                    provider: binding.provider,
                    providerInstanceId: binding.providerInstanceId,
                    status: "stopped",
                    runtimePayload: {
                      activeTurnId: null,
                      lastRuntimeEvent: "provider.stopAll",
                      lastRuntimeEventAt: new Date().toISOString(),
                    },
                  }),
              }),
            ),
          ),
        ).pipe(Effect.asVoid);
        yield* analytics.record("provider.sessions.stopped_all", {
          sessionCount: threadIds.length,
        });
        yield* analytics.flush;
      });

    yield* Effect.addFinalizer(() =>
      Effect.catch(runStopAll(), (cause) =>
        Effect.logWarning("failed to stop provider service", { cause }),
      ),
    );

    return {
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      getCapabilities,
      rollbackConversation,
      // Each access creates a fresh PubSub subscription so that multiple
      // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
      // independently receive all runtime events.
      get streamEvents(): ProviderServiceShape["streamEvents"] {
        return Stream.fromPubSub(runtimeEventPubSub);
      },
    } satisfies ProviderServiceShape;
  });

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}
