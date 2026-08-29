import {
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  type ModelCapabilities,
  type ProviderKind,
  type ProviderOptionSelection,
  type ServerProvider,
  type ServerProviderModel,
} from "@cozea/assistant-contracts"
import {
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
  normalizeModelSlug,
  resolveContextWindow,
  resolveEffort,
  setProviderOptionSelectionValue,
} from "@cozea/assistant-shared/model"

const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
}

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ReadonlyArray<ServerProviderModel> {
  return getProviderSnapshot(providers, provider)?.models ?? []
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): ServerProvider | undefined {
  const defaultInstanceId = defaultInstanceIdForDriver(provider as never)
  return (
    providers.find((candidate) => candidate.instanceId === defaultInstanceId) ??
    providers.find((candidate) => candidate.provider === provider)
  )
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.enabled ?? true
}

export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind | null | undefined,
): ProviderKind {
  const requested = provider ?? "codex"
  if (isProviderEnabled(providers, requested)) {
    return requested
  }

  return providers.find((candidate) => candidate.enabled && candidate.availability !== "unavailable")?.provider ?? requested
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider)
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderKind,
): string {
  const models = getProviderModels(providers, provider)
  return (
    models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    models.find((model) => !model.isLegacy && !model.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider]
  )
}

export function normalizeCodexModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | Record<string, unknown> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const reasoningEffort = resolveEffort(caps, getProviderOptionStringSelectionValue(modelOptions, "effort"))
  const fastModeEnabled = getProviderOptionBooleanSelectionValue(modelOptions, "fastMode") === true
  let nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined
  nextOptions = setProviderOptionSelectionValue(nextOptions, "effort", reasoningEffort)
  nextOptions = setProviderOptionSelectionValue(nextOptions, "fastMode", fastModeEnabled ? true : undefined)
  return nextOptions
}

export function normalizeClaudeModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | Record<string, unknown> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const effort = resolveEffort(caps, getProviderOptionStringSelectionValue(modelOptions, "effort"))
  const thinking =
    caps.supportsThinkingToggle && getProviderOptionBooleanSelectionValue(modelOptions, "thinking") === false
      ? false
      : undefined
  const fastMode =
    caps.supportsFastMode && getProviderOptionBooleanSelectionValue(modelOptions, "fastMode") === true
      ? true
      : undefined
  const contextWindow = resolveContextWindow(
    caps,
    getProviderOptionStringSelectionValue(modelOptions, "contextWindow"),
  )
  let nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined
  nextOptions = setProviderOptionSelectionValue(nextOptions, "thinking", thinking)
  nextOptions = setProviderOptionSelectionValue(nextOptions, "effort", effort)
  nextOptions = setProviderOptionSelectionValue(nextOptions, "fastMode", fastMode)
  nextOptions = setProviderOptionSelectionValue(nextOptions, "contextWindow", contextWindow)
  return nextOptions
}

export function normalizeOpenCodeModelOptionsWithCapabilities(
  _caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | Record<string, unknown> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const variant = getProviderOptionStringSelectionValue(modelOptions, "variant")
  const agent = getProviderOptionStringSelectionValue(modelOptions, "agent")
  let nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined
  if (variant) {
    nextOptions = setProviderOptionSelectionValue(nextOptions, "variant", variant)
  }
  if (agent) {
    nextOptions = setProviderOptionSelectionValue(nextOptions, "agent", agent)
  }
  return nextOptions
}

export function normalizeCursorModelOptionsWithCapabilities(
  caps: ModelCapabilities,
  modelOptions: ReadonlyArray<ProviderOptionSelection> | Record<string, unknown> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  const reasoning = resolveEffort(caps, getProviderOptionStringSelectionValue(modelOptions, "reasoning") ?? getProviderOptionStringSelectionValue(modelOptions, "effort"))
  const fastMode =
    caps.supportsFastMode && getProviderOptionBooleanSelectionValue(modelOptions, "fastMode") === true
      ? true
      : undefined
  let nextOptions: ReadonlyArray<ProviderOptionSelection> | undefined
  if (reasoning) {
    nextOptions = setProviderOptionSelectionValue(nextOptions, "reasoning", reasoning)
  }
  if (fastMode) {
    nextOptions = setProviderOptionSelectionValue(nextOptions, "fastMode", fastMode)
  }
  return nextOptions
}
