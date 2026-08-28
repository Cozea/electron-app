import type {
  ClientOrchestrationCommand,
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
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
  defaultInstanceIdForDriver,
} from "@cozea/assistant-contracts"

import { formatTerminalContextLabel } from "@/features/projects/components/assistant/lib/terminalContext"
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

export function deriveAssistantTurnRunning(input: {
  orchestrationStatus: string | null | undefined
  streamIsStreaming: boolean
}): boolean {
  return (
    input.streamIsStreaming ||
    input.orchestrationStatus === "running" ||
    input.orchestrationStatus === "starting"
  )
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
  instanceId?: ProviderInstanceId,
): ServerProvider | null {
  const defaultInstanceId = instanceId ?? defaultInstanceIdForDriver(provider as ProviderDriverKind)
  return (
    config?.providers.find((entry) => entry.instanceId === defaultInstanceId) ??
    config?.providers.find((entry) => entry.provider === provider) ??
    null
  )
}

export function getProviderModelOptions(
  config: ServerConfig | null,
  provider: ProviderKind,
  instanceId?: ProviderInstanceId,
): ReadonlyArray<{
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  isDefault?: boolean;
  isLegacy?: boolean;
}> {
  return (
    getProviderSnapshot(config, provider, instanceId)?.models.map((model) => ({
      slug: model.slug,
      name: model.name,
      ...(model.shortName ? { shortName: model.shortName } : {}),
      ...(model.subProvider ? { subProvider: model.subProvider } : {}),
      ...(model.isDefault !== undefined ? { isDefault: model.isDefault } : {}),
      ...(model.isLegacy !== undefined ? { isLegacy: model.isLegacy } : {}),
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
  workspaceId: string | null,
): WorkbenchAssistantChatTileRecord | null {
  const workbench = selectProjectWorkbench(
    projectId,
    laneId,
    workspaceId,
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
  providerInstanceId?: ProviderInstanceId
}): StrictModelSelection {
  const defaultModelSelection = input.config?.settings.textGenerationModelSelection
  const provider =
    input.provider ??
    resolvePreferredProvider({
      config: input.config,
      tile: input.tile,
      projectModelSelection: input.projectModelSelection,
    })
  const providerInstanceId =
    input.providerInstanceId ??
    (input.tile.provider === provider ? input.tile.providerInstanceId : undefined) ??
    (input.projectModelSelection?.provider === provider
      ? input.projectModelSelection.instanceId
      : undefined) ??
    (defaultModelSelection?.provider === provider
      ? defaultModelSelection.instanceId
      : undefined) ??
    defaultInstanceIdForDriver(provider as ProviderDriverKind)
  const providerModelOptions = getProviderModelOptions(input.config, provider, providerInstanceId)
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
    providerModelOptions.find((model) => model.isDefault && !model.isLegacy)?.slug ??
    providerModelOptions.find((model) => !model.isLegacy)?.slug ??
    providerModelOptions[0]?.slug ??
    resolveModelSlugForProvider(provider, candidateModel) ??
    DEFAULT_MODEL_BY_PROVIDER[provider]

  switch (provider) {
    case "codex":
      return normalizeModelSelection({
        provider: "codex",
        instanceId: providerInstanceId,
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
        instanceId: providerInstanceId,
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
        instanceId: providerInstanceId,
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
        instanceId: providerInstanceId,
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
  instanceId?: ProviderInstanceId
  model: string
  options?: ModelSelection["options"]
}): StrictModelSelection {
  return createModelSelection(
    input.provider,
    input.model,
    input.options,
    input.instanceId,
  ) as StrictModelSelection
}

export function withModelSelectionModel(
  selection: ModelSelection,
  model: string,
): StrictModelSelection {
  switch (selection.provider) {
    case "codex":
      return normalizeModelSelection({
        provider: "codex",
        instanceId: selection.instanceId,
        model,
        options: selection.options,
      })
    case "claudeAgent":
      return normalizeModelSelection({
        provider: "claudeAgent",
        instanceId: selection.instanceId,
        model,
        options: selection.options,
      })
    case "cursor":
      return normalizeModelSelection({
        provider: "cursor",
        instanceId: selection.instanceId,
        model,
        options: selection.options,
      })
    case "opencode":
      return normalizeModelSelection({
        provider: "opencode",
        instanceId: selection.instanceId,
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
  workspaceId: string | null,
): Project | null {
  if (tile.assistantProjectId) {
    return projects.find((project) => project.id === tile.assistantProjectId) ?? null
  }

  if (workspaceId) {
    return projects.find((project) => project.cwd === workspaceId) ?? null
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

export function revokeUserMessagePreviewUrls(message: { role: string; attachments?: readonly any[] }): void {
  if (message.role !== "user" || !message.attachments) {
    return
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue
    }
    if (attachment.previewUrl && typeof URL !== "undefined" && attachment.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }
}

export function cloneComposerImageForRetry(image: {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file?: File
}): {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file?: File
} {
  return {
    ...image,
    previewUrl: image.file ? URL.createObjectURL(image.file) : image.previewUrl,
  }
}

export function deriveTitleSeed(input: {
  prompt: string
  images: ReadonlyArray<{ name: string }>
  terminalContexts: ReadonlyArray<{ terminalLabel: string; lineStart: number; lineEnd: number }>
}): string {
  const trimmed = input.prompt.trim()
  if (trimmed) {
    return truncateTitle(trimmed)
  }
  if (input.images.length > 0 && input.images[0]) {
    return truncateTitle(`Image: ${input.images[0].name}`)
  }
  if (input.terminalContexts.length > 0 && input.terminalContexts[0]) {
    return truncateTitle(formatTerminalContextLabel(input.terminalContexts[0]))
  }
  return "New thread"
}
