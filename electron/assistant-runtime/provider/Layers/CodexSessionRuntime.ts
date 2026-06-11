import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from "@cozea/assistant-contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@cozea/assistant-shared/model";

import type {
  CodexAppServerSendTurnInput,
  CodexAppServerStartSessionInput,
} from "../../codexAppServerManager.ts";

function getCodexModel(modelSelection: ModelSelection | null | undefined): string | undefined {
  return modelSelection?.provider === "codex" ? modelSelection.model : undefined;
}

function getCodexServiceTier(
  modelSelection: ModelSelection | null | undefined,
): CodexAppServerSendTurnInput["serviceTier"] | undefined {
  return modelSelection?.provider === "codex" &&
    getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true
    ? "fast"
    : undefined;
}

function getCodexEffort(
  modelSelection: ModelSelection | null | undefined,
): CodexAppServerSendTurnInput["effort"] | undefined {
  return modelSelection?.provider === "codex"
    ? getModelSelectionStringOptionValue(modelSelection, "effort")
    : undefined;
}

export interface BuildCodexStartSessionInputOptions {
  readonly threadId: ThreadId;
  readonly cwd?: string;
  readonly resumeCursor?: unknown;
  readonly runtimeMode: RuntimeMode;
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly modelSelection?: ModelSelection | null | undefined;
}

export function buildCodexStartSessionInput(
  input: BuildCodexStartSessionInputOptions,
): CodexAppServerStartSessionInput {
  const model = getCodexModel(input.modelSelection);
  const serviceTier = getCodexServiceTier(input.modelSelection);

  return {
    threadId: input.threadId,
    provider: "codex",
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.resumeCursor !== undefined ? { resumeCursor: input.resumeCursor } : {}),
    runtimeMode: input.runtimeMode,
    binaryPath: input.binaryPath,
    ...(input.homePath ? { homePath: input.homePath } : {}),
    ...(model ? { model } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  };
}

export interface BuildCodexSendTurnInputOptions {
  readonly threadId: ThreadId;
  readonly input?: string;
  readonly attachments?: ReadonlyArray<{ type: "image"; url: string }>;
  readonly modelSelection?: ModelSelection | null | undefined;
  readonly interactionMode?: ProviderInteractionMode;
}

export function buildCodexSendTurnInput(
  input: BuildCodexSendTurnInputOptions,
): CodexAppServerSendTurnInput {
  const model = getCodexModel(input.modelSelection);
  const effort = getCodexEffort(input.modelSelection);
  const serviceTier = getCodexServiceTier(input.modelSelection);

  return {
    threadId: input.threadId,
    ...(input.input !== undefined ? { input: input.input } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(serviceTier ? { serviceTier } : {}),
    ...(input.interactionMode !== undefined
      ? { interactionMode: input.interactionMode }
      : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  };
}
