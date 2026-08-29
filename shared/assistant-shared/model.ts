// @ts-nocheck
import {
  DEFAULT_MODEL_BY_PROVIDER,
  MODEL_SLUG_ALIASES_BY_PROVIDER,
  type ClaudeCodeEffort,
  type ModelCapabilities,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ProviderKind,
  type ProviderInstanceId,
} from "@cozea/assistant-contracts";

export interface SelectableModelOption {
  slug: string;
  name: string;
}

type ProviderOptionSelectionsLike =
  | ReadonlyArray<ProviderOptionSelection>
  | Record<string, unknown>
  | null
  | undefined;

const EFFORT_OPTION_IDS = ["effort", "reasoningEffort", "reasoning"] as const;
const FAST_MODE_OPTION_IDS = ["fastMode", "serviceTier", "speed", "fast"] as const;
const THINKING_OPTION_IDS = ["thinking"] as const;
const CONTEXT_WINDOW_OPTION_IDS = ["contextWindow"] as const;

function canonicalOptionId(id: string): string {
  switch (id.trim()) {
    case "reasoningEffort":
    case "reasoning":
      return "effort";
    case "serviceTier":
    case "speed":
    case "fast":
      return "fastMode";
    default:
      return id.trim();
  }
}

function candidateOptionIds(id: string): ReadonlyArray<string> {
  const canonicalId = canonicalOptionId(id);
  switch (canonicalId) {
    case "effort":
      return EFFORT_OPTION_IDS;
    case "fastMode":
      return FAST_MODE_OPTION_IDS;
    case "thinking":
      return THINKING_OPTION_IDS;
    case "contextWindow":
      return CONTEXT_WINDOW_OPTION_IDS;
    default:
      return [canonicalId];
  }
}

function cloneChoice(
  choice: Extract<ProviderOptionDescriptor, { type: "select" }>["options"][number],
) {
  return { ...choice };
}

function cloneDescriptor(descriptor: ProviderOptionDescriptor): ProviderOptionDescriptor {
  return descriptor.type === "select"
    ? {
        ...descriptor,
        options: descriptor.options.map(cloneChoice),
        ...(descriptor.promptInjectedValues
          ? { promptInjectedValues: [...descriptor.promptInjectedValues] }
          : {}),
      }
    : { ...descriptor };
}

function cloneSelection(selection: ProviderOptionSelection): ProviderOptionSelection {
  return { ...selection, id: canonicalOptionId(selection.id) };
}

function coerceSelectionsLike(
  selections: ProviderOptionSelectionsLike,
): ReadonlyArray<ProviderOptionSelection> {
  if (!selections) {
    return [];
  }
  if (Array.isArray(selections)) {
    return selections.map(cloneSelection);
  }
  const nextSelections: Array<ProviderOptionSelection> = [];
  for (const [rawId, rawValue] of Object.entries(selections)) {
    const id = canonicalOptionId(rawId);
    if (!id) {
      continue;
    }
    if (typeof rawValue === "string") {
      const trimmed = trimOrNull(rawValue);
      if (trimmed) {
        nextSelections.push({ id, value: trimmed });
      }
      continue;
    }
    if (typeof rawValue === "boolean") {
      nextSelections.push({ id, value: rawValue });
    }
  }
  return nextSelections;
}

function getRawSelectionValueById(
  selections: ProviderOptionSelectionsLike,
  id: string,
): string | boolean | undefined {
  const candidates = candidateOptionIds(id);
  const canonicalSelections = coerceSelectionsLike(selections);
  for (const candidateId of candidates) {
    const selection = canonicalSelections.find((entry) => canonicalOptionId(entry.id) === canonicalOptionId(candidateId));
    if (selection) {
      return selection.value;
    }
  }
  return undefined;
}

function cloneSelections(
  selections: ReadonlyArray<ProviderOptionSelection>,
): Array<ProviderOptionSelection> {
  return selections.map(cloneSelection);
}

function findDescriptor(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  id: string,
): ProviderOptionDescriptor | undefined {
  const candidates = new Set(candidateOptionIds(id).map(canonicalOptionId));
  return descriptors.find((descriptor) => candidates.has(canonicalOptionId(descriptor.id)));
}

function descriptorDefaultValue(
  descriptor: ProviderOptionDescriptor,
): string | boolean | undefined {
  if (descriptor.type === "boolean") {
    return descriptor.currentValue;
  }
  if (descriptor.currentValue) {
    return descriptor.currentValue;
  }
  return descriptor.options.find((option) => option.isDefault)?.id;
}

function resolveDescriptorChoiceValue(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  raw: string | null | undefined,
): string | undefined {
  const trimmed = trimOrNull(raw);
  if (!trimmed) {
    return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.length === 0) {
    return trimmed;
  }
  if (
    descriptor.promptInjectedValues?.includes(trimmed) &&
    descriptor.options.some((option) => option.id === trimmed)
  ) {
    return descriptor.options.find((option) => option.isDefault)?.id;
  }
  if (descriptor.options.some((option) => option.id === trimmed)) {
    return trimmed;
  }
  return descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id;
}

function withDescriptorCurrentValue(
  descriptor: ProviderOptionDescriptor,
  rawCurrentValue: string | boolean | undefined,
): ProviderOptionDescriptor {
  if (descriptor.type === "boolean") {
    if (typeof rawCurrentValue === "boolean") {
      return {
        ...descriptor,
        currentValue: rawCurrentValue,
      };
    }
    return descriptor;
  }
  const currentValue =
    typeof rawCurrentValue === "string"
      ? resolveDescriptorChoiceValue(descriptor, rawCurrentValue)
      : resolveDescriptorChoiceValue(descriptor, descriptor.currentValue);
  if (!currentValue) {
    const { currentValue: _unusedCurrentValue, ...rest } = descriptor;
    return rest;
  }
  return {
    ...descriptor,
    currentValue,
  };
}

function deriveLegacyOptionDescriptors(caps: ModelCapabilities): Array<ProviderOptionDescriptor> {
  const descriptors: Array<ProviderOptionDescriptor> = [];

  if (caps.reasoningEffortLevels.length > 0) {
    descriptors.push({
      id: "effort",
      type: "select",
      label: "Effort",
      options: caps.reasoningEffortLevels.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true } : {}),
      })),
      ...(caps.promptInjectedEffortLevels.length > 0
        ? { promptInjectedValues: [...caps.promptInjectedEffortLevels] }
        : {}),
    });
  }

  if (caps.contextWindowOptions.length > 0) {
    descriptors.push({
      id: "contextWindow",
      type: "select",
      label: "Context",
      options: caps.contextWindowOptions.map((option) => ({
        id: option.value,
        label: option.label,
        ...(option.isDefault ? { isDefault: true } : {}),
      })),
    });
  }

  if (caps.supportsFastMode) {
    descriptors.push({
      id: "fastMode",
      type: "boolean",
      label: "Fast mode",
    });
  }

  if (caps.supportsThinkingToggle) {
    descriptors.push({
      id: "thinking",
      type: "boolean",
      label: "Thinking",
    });
  }

  return descriptors;
}

export function createModelCapabilities(input: {
  optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): ModelCapabilities {
  const descriptors = input.optionDescriptors.map(cloneDescriptor);
  const effortDescriptor = findDescriptor(descriptors, "effort");
  const contextWindowDescriptor = findDescriptor(descriptors, "contextWindow");
  const fastModeDescriptor = findDescriptor(descriptors, "fastMode");
  const thinkingDescriptor = findDescriptor(descriptors, "thinking");

  return {
    optionDescriptors: descriptors,
    reasoningEffortLevels:
      effortDescriptor?.type === "select"
        ? effortDescriptor.options.map((option) => ({
            value: option.id,
            label: option.label,
            ...(option.isDefault ? { isDefault: true } : {}),
          }))
        : [],
    supportsFastMode: fastModeDescriptor?.type === "boolean",
    supportsThinkingToggle: thinkingDescriptor?.type === "boolean",
    contextWindowOptions:
      contextWindowDescriptor?.type === "select"
        ? contextWindowDescriptor.options.map((option) => ({
            value: option.id,
            label: option.label,
            ...(option.isDefault ? { isDefault: true } : {}),
          }))
        : [],
    promptInjectedEffortLevels:
      effortDescriptor?.type === "select" ? [...(effortDescriptor.promptInjectedValues ?? [])] : [],
  };
}

export function getProviderOptionSelectionValue(
  selections: ProviderOptionSelectionsLike,
  id: string,
): string | boolean | undefined {
  return getRawSelectionValueById(selections, id);
}

export function getProviderOptionStringSelectionValue(
  selections: ProviderOptionSelectionsLike,
  id: string,
): string | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "string" ? value : undefined;
}

export function getProviderOptionBooleanSelectionValue(
  selections: ProviderOptionSelectionsLike,
  id: string,
): boolean | undefined {
  const value = getProviderOptionSelectionValue(selections, id);
  return typeof value === "boolean" ? value : undefined;
}

export function getModelSelectionOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | boolean | undefined {
  return getProviderOptionSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionStringOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): string | undefined {
  return getProviderOptionStringSelectionValue(modelSelection?.options, id);
}

export function getModelSelectionBooleanOptionValue(
  modelSelection: ModelSelection | null | undefined,
  id: string,
): boolean | undefined {
  return getProviderOptionBooleanSelectionValue(modelSelection?.options, id);
}

export function getProviderOptionDescriptors(input: {
  caps: ModelCapabilities;
  selections?: ProviderOptionSelectionsLike;
}): ReadonlyArray<ProviderOptionDescriptor> {
  const baseDescriptors =
    input.caps.optionDescriptors && input.caps.optionDescriptors.length > 0
      ? input.caps.optionDescriptors.map(cloneDescriptor)
      : deriveLegacyOptionDescriptors(input.caps);

  return baseDescriptors.map((descriptor) =>
    withDescriptorCurrentValue(
      descriptor,
      getRawSelectionValueById(input.selections, descriptor.id) ?? descriptorDefaultValue(descriptor),
    ),
  );
}

export function getModelSelectionOptionDescriptors(
  modelSelection: ModelSelection | null | undefined,
  caps?: ModelCapabilities | null | undefined,
): ReadonlyArray<ProviderOptionDescriptor> {
  if (!modelSelection || !caps) {
    return [];
  }
  return getProviderOptionDescriptors({
    caps,
    selections: modelSelection.options,
  });
}

export function getProviderOptionCurrentValue(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | boolean | undefined {
  if (!descriptor) {
    return undefined;
  }
  return descriptorDefaultValue(descriptor);
}

export function getProviderOptionCurrentLabel(
  descriptor: ProviderOptionDescriptor | null | undefined,
): string | undefined {
  if (!descriptor) {
    return undefined;
  }
  if (descriptor.type === "boolean") {
    return typeof descriptor.currentValue === "boolean"
      ? descriptor.currentValue
        ? "On"
        : "Off"
      : undefined;
  }
  const currentValue = getProviderOptionCurrentValue(descriptor);
  if (typeof currentValue !== "string") {
    return undefined;
  }
  return descriptor.options.find((option) => option.id === currentValue)?.label;
}

export function buildProviderOptionSelectionsFromDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor> | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  if (!descriptors || descriptors.length === 0) {
    return undefined;
  }

  const nextSelections: Array<ProviderOptionSelection> = [];
  for (const descriptor of descriptors) {
    const value = getProviderOptionCurrentValue(descriptor);
    if (typeof value === "string" || typeof value === "boolean") {
      nextSelections.push({ id: canonicalOptionId(descriptor.id), value });
    }
  }

  return nextSelections.length > 0 ? nextSelections : undefined;
}

export function setProviderOptionSelectionValue(
  selections: ProviderOptionSelectionsLike,
  id: string,
  value: string | boolean | null | undefined,
): Array<ProviderOptionSelection> | undefined {
  const canonicalId = canonicalOptionId(id);
  const candidateIds = new Set(candidateOptionIds(canonicalId).map(canonicalOptionId));
  const nextSelections = coerceSelectionsLike(selections).filter(
    (selection) => !candidateIds.has(canonicalOptionId(selection.id)),
  );

  if (typeof value === "string") {
    const trimmed = trimOrNull(value);
    if (trimmed) {
      nextSelections.push({ id: canonicalId, value: trimmed });
    }
  } else if (typeof value === "boolean") {
    nextSelections.push({ id: canonicalId, value });
  }

  return nextSelections.length > 0 ? nextSelections : undefined;
}

export function mergeProviderOptionSelections(
  current: ProviderOptionSelectionsLike,
  patch: ProviderOptionSelectionsLike,
): Array<ProviderOptionSelection> | undefined {
  let nextSelections = coerceSelectionsLike(current);
  for (const selection of coerceSelectionsLike(patch)) {
    nextSelections =
      setProviderOptionSelectionValue(nextSelections, selection.id, selection.value) ?? [];
  }
  return nextSelections.length > 0 ? nextSelections : undefined;
}

export function createModelSelection(
  provider: ProviderKind,
  model: string,
  options?: ProviderOptionSelectionsLike,
  instanceId?: ProviderInstanceId,
): ModelSelection {
  const normalizedOptions = options ? coerceSelectionsLike(options) : [];
  return {
    provider,
    instanceId: instanceId ?? provider,
    model,
    ...(normalizedOptions.length > 0 ? { options: cloneSelections(normalizedOptions) } : {}),
  } as ModelSelection;
}

function resolveEffortDescriptor(caps: ModelCapabilities) {
  return findDescriptor(getProviderOptionDescriptors({ caps }), "effort");
}

export function hasEffortLevel(caps: ModelCapabilities, value: string): boolean {
  const descriptor = resolveEffortDescriptor(caps);
  return descriptor?.type === "select"
    ? descriptor.options.some((option) => option.id === value)
    : false;
}

export function getDefaultEffort(caps: ModelCapabilities): string | null {
  const descriptor = resolveEffortDescriptor(caps);
  if (descriptor?.type !== "select") {
    return null;
  }
  return (
    descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id ?? null
  );
}

export function resolveEffort(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const descriptor = resolveEffortDescriptor(caps);
  if (descriptor?.type !== "select") {
    return undefined;
  }

  return resolveDescriptorChoiceValue(descriptor, raw) ?? undefined;
}

function resolveContextWindowDescriptor(caps: ModelCapabilities) {
  return findDescriptor(getProviderOptionDescriptors({ caps }), "contextWindow");
}

export function hasContextWindowOption(caps: ModelCapabilities, value: string): boolean {
  const descriptor = resolveContextWindowDescriptor(caps);
  return descriptor?.type === "select"
    ? descriptor.options.some((option) => option.id === value)
    : false;
}

export function getDefaultContextWindow(caps: ModelCapabilities): string | null {
  const descriptor = resolveContextWindowDescriptor(caps);
  if (descriptor?.type !== "select") {
    return null;
  }
  return (
    descriptor.currentValue ?? descriptor.options.find((option) => option.isDefault)?.id ?? null
  );
}

export function resolveContextWindow(
  caps: ModelCapabilities,
  raw: string | null | undefined,
): string | undefined {
  const descriptor = resolveContextWindowDescriptor(caps);
  if (descriptor?.type !== "select") {
    return undefined;
  }
  return resolveDescriptorChoiceValue(descriptor, raw) ?? undefined;
}

export function isClaudeUltrathinkPrompt(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bultrathink\b/i.test(text);
}

export function normalizeModelSlug(
  model: string | null | undefined,
  provider: ProviderKind = "codex",
): string | null {
  if (typeof model !== "string") {
    return null;
  }

  const trimmed = model.trim();
  if (!trimmed) {
    return null;
  }

  const aliases = MODEL_SLUG_ALIASES_BY_PROVIDER[provider] as Record<string, string>;
  const aliased = Object.prototype.hasOwnProperty.call(aliases, trimmed)
    ? aliases[trimmed]
    : undefined;
  return typeof aliased === "string" ? aliased : trimmed;
}

export function resolveSelectableModel(
  provider: ProviderKind,
  value: string | null | undefined,
  options: ReadonlyArray<SelectableModelOption>,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const direct = options.find((option) => option.slug === trimmed);
  if (direct) {
    return direct.slug;
  }

  const byName = options.find((option) => option.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) {
    return byName.slug;
  }

  const normalized = normalizeModelSlug(trimmed, provider);
  if (!normalized) {
    return null;
  }

  const resolved = options.find((option) => option.slug === normalized);
  return resolved ? resolved.slug : null;
}

export function resolveModelSlug(model: string | null | undefined, provider: ProviderKind): string {
  const normalized = normalizeModelSlug(model, provider);
  if (!normalized) {
    return DEFAULT_MODEL_BY_PROVIDER[provider];
  }
  return normalized;
}

export function resolveModelSlugForProvider(
  provider: ProviderKind,
  model: string | null | undefined,
): string {
  return resolveModelSlug(model, provider);
}

/** Trim a string, returning null for empty/missing values. */
export function trimOrNull<T extends string>(value: T | null | undefined): T | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim() as T;
  return trimmed || null;
}

export function resolveApiModelId(modelSelection: ModelSelection): string {
  switch (modelSelection.provider) {
    case "claudeAgent": {
      switch (getModelSelectionStringOptionValue(modelSelection, "contextWindow")) {
        case "1m":
          return `${modelSelection.model}[1m]`;
        default:
          return modelSelection.model;
      }
    }
    default: {
      return modelSelection.model;
    }
  }
}

export function resolvePromptInjectedEffort(
  caps: ModelCapabilities,
  rawEffort: string | null | undefined,
): string | null {
  const trimmed = trimOrNull(rawEffort);
  if (!trimmed) return null;
  const effortDescriptor = resolveEffortDescriptor(caps);
  if (effortDescriptor?.type !== "select") {
    return null;
  }
  return effortDescriptor.promptInjectedValues?.includes(trimmed) ? trimmed : null;
}

export function applyClaudePromptEffortPrefix(
  text: string,
  effort: ClaudeCodeEffort | string | null | undefined,
): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (effort !== "ultrathink") {
    return trimmed;
  }
  if (trimmed.startsWith("Ultrathink:")) {
    return trimmed;
  }
  return `Ultrathink:\n${trimmed}`;
}
