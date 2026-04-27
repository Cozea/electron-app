import type {
  ClientOrchestrationCommand,
  ModelSelection,
  ProviderInteractionMode,
  ProviderKind,
  RuntimeMode,
  ServerConfig,
  ServerProvider,
} from "@cozea/assistant-contracts"
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
} from "@cozea/assistant-contracts"
import {
  createModelSelection,
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "@cozea/assistant-shared/model"

import type { Project, Thread } from "@/stores/types"
import {
  selectProjectWorkbench,
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

export interface DiffDialogState {
  title: string
  diff: string
  error: string | null
  isLoading: boolean
}

type StrictModelSelection = Extract<
  ClientOrchestrationCommand,
  { type: "thread.create" }
>["modelSelection"]

const workspaceBindingQueue = new Map<string, Promise<void>>()

export function basenameFromPath(value: string | null): string {
  if (!value) {
    return "Workspace"
  }

  const segments = value.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? value
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Something went wrong while talking to the local assistant runtime."
}

export function truncateTitle(text: string, maxLength = 50): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}...`
}

export function getProviderSnapshot(
  config: ServerConfig | null,
  provider: ProviderKind,
): ServerProvider | null {
  return config?.providers.find((entry) => entry.provider === provider) ?? null
}

export function getProviderModelOptions(
  config: ServerConfig | null,
  provider: ProviderKind,
): ReadonlyArray<{ slug: string; name: string; shortName?: string; subProvider?: string }> {
  return (
    getProviderSnapshot(config, provider)?.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      ...(model.shortName ? { shortName: model.shortName } : {}),
      ...(model.subProvider ? { subProvider: model.subProvider } : {}),
    })) ?? []
  )
}

export async function withWorkspaceBindingLock<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = workspaceBindingQueue.get(workspaceRoot) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.finally(() => gate)

  workspaceBindingQueue.set(workspaceRoot, current)
  await previous

  try {
    return await task()
  } finally {
    release()
    if (workspaceBindingQueue.get(workspaceRoot) === current) {
      workspaceBindingQueue.delete(workspaceRoot)
    }
  }
}

export function getLiveAssistantTile(
  projectId: string,
  laneId: string,
  tileId: string,
  projectPath: string | null,
): WorkbenchAssistantChatTileRecord | null {
  const workbench = selectProjectWorkbench(
    projectId,
    laneId,
    projectPath,
  )(useProjectWorkbenchStore.getState())
  const tile = workbench?.tiles[tileId]
  return tile?.type === "assistantChat" ? tile : null
}

export function resolvePreferredProvider(input: {
  config: ServerConfig | null
  tile: WorkbenchAssistantChatTileRecord
  projectModelSelection: ModelSelection | null | undefined
}): ProviderKind {
  const defaultModelSelection = input.config?.settings.textGenerationModelSelection

  if (input.tile.provider) {
    return input.tile.provider
  }

  if (input.projectModelSelection?.provider) {
    return input.projectModelSelection.provider
  }

  if (defaultModelSelection?.provider) {
    return defaultModelSelection.provider
  }

  return "codex"
}

export function resolvePreferredModelSelection(input: {
  config: ServerConfig | null
  tile: WorkbenchAssistantChatTileRecord
  projectModelSelection: ModelSelection | null | undefined
  provider?: ProviderKind
}): StrictModelSelection {
  const defaultModelSelection = input.config?.settings.textGenerationModelSelection
  const provider =
    input.provider ??
    resolvePreferredProvider({
      config: input.config,
      tile: input.tile,
      projectModelSelection: input.projectModelSelection,
    })
  const providerModelOptions = getProviderModelOptions(input.config, provider)
  const candidateModel =
    (input.tile.provider === provider ? input.tile.model : null) ??
    (input.projectModelSelection?.provider === provider
      ? input.projectModelSelection.model
      : null) ??
    (defaultModelSelection?.provider === provider
      ? defaultModelSelection.model
      : null)
  const resolvedModel =
    resolveSelectableModel(provider, candidateModel, providerModelOptions) ??
    providerModelOptions[0]?.slug ??
    resolveModelSlugForProvider(provider, candidateModel) ??
    DEFAULT_MODEL_BY_PROVIDER[provider]

  switch (provider) {
    case "codex":
      return normalizeModelSelection({
        provider: "codex",
        model: resolvedModel,
        options:
          input.tile.provider === "codex"
            ? undefined
            : input.projectModelSelection?.provider === "codex"
              ? input.projectModelSelection.options
              : defaultModelSelection?.provider === "codex"
                ? defaultModelSelection.options
                : undefined,
      })
    case "claudeAgent":
      return normalizeModelSelection({
        provider: "claudeAgent",
        model: resolvedModel,
        options:
          input.tile.provider === "claudeAgent"
            ? undefined
            : input.projectModelSelection?.provider === "claudeAgent"
              ? input.projectModelSelection.options
              : defaultModelSelection?.provider === "claudeAgent"
                ? defaultModelSelection.options
                : undefined,
      })
    case "cursor":
      return normalizeModelSelection({
        provider: "cursor",
        model: resolvedModel,
        options:
          input.tile.provider === "cursor"
            ? undefined
            : input.projectModelSelection?.provider === "cursor"
              ? input.projectModelSelection.options
              : defaultModelSelection?.provider === "cursor"
                ? defaultModelSelection.options
                : undefined,
      })
    case "opencode":
      return normalizeModelSelection({
        provider: "opencode",
        model: resolvedModel,
        options:
          input.tile.provider === "opencode"
            ? undefined
            : input.projectModelSelection?.provider === "opencode"
              ? input.projectModelSelection.options
              : defaultModelSelection?.provider === "opencode"
                ? defaultModelSelection.options
                : undefined,
      })
  }
}

export function normalizeModelSelection(input: {
  provider: ProviderKind
  model: string
  options?: ModelSelection["options"]
}): StrictModelSelection {
  return createModelSelection(input.provider, input.model, input.options) as StrictModelSelection
}

export function withModelSelectionModel(
  selection: ModelSelection,
  model: string,
): StrictModelSelection {
  switch (selection.provider) {
    case "codex":
      return normalizeModelSelection({
        provider: "codex",
        model,
        options: selection.options,
      })
    case "claudeAgent":
      return normalizeModelSelection({
        provider: "claudeAgent",
        model,
        options: selection.options,
      })
    case "cursor":
      return normalizeModelSelection({
        provider: "cursor",
        model,
        options: selection.options,
      })
    case "opencode":
      return normalizeModelSelection({
        provider: "opencode",
        model,
        options: selection.options,
      })
  }
}

export function resolveRuntimeMode(tile: WorkbenchAssistantChatTileRecord): RuntimeMode {
  return tile.runtimeMode ?? DEFAULT_RUNTIME_MODE
}

export function resolveInteractionMode(
  tile: WorkbenchAssistantChatTileRecord,
): ProviderInteractionMode {
  return tile.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE
}

export function findAssistantProjectForTile(
  projects: readonly Project[],
  tile: WorkbenchAssistantChatTileRecord,
  projectPath: string | null,
): Project | null {
  if (tile.assistantProjectId) {
    return projects.find((project) => project.id === tile.assistantProjectId) ?? null
  }

  if (projectPath) {
    return projects.find((project) => project.cwd === projectPath) ?? null
  }

  return null
}

export function findAssistantThreadById(
  threads: readonly Thread[],
  threadId: string | null | undefined,
): Thread | null {
  if (!threadId) {
    return null
  }

  return threads.find((thread) => thread.id === threadId) ?? null
}
