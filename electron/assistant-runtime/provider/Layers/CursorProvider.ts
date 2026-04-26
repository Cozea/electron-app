import * as nodeFs from "node:fs";
import * as nodeOs from "node:os";
import * as nodePath from "node:path";
import * as nodeChildProcess from "node:child_process";

import type {
  CursorModelOptions,
  CursorSettings,
  ModelCapabilities,
  ServerProvider,
  ServerProviderAuth,
  ServerProviderModel,
  ServerProviderSlashCommand,
  ServerProviderState,
} from "@cozea/assistant-contracts";
import { ServerSettingsError } from "../../serverSettings.ts";
import type * as EffectAcpSchema from "@cozea/effect-acp/schema";
import { Cause, Effect, Equal, Exit, Layer, Option, Result, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import {
  buildServerProvider,
  isCommandMissingCause,
  nonEmptyTrimmed,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type CommandResult,
} from "../providerSnapshot.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import { CursorProvider } from "../Services/CursorProvider.ts";
import { AcpSessionRuntime, layerAcpSessionRuntime } from "../acp/AcpSessionRuntime.ts";
import type { AcpAvailableCommand, AcpParsedSessionEvent } from "../acp/AcpRuntimeModel.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { getClaudeModelCapabilities } from "./ClaudeProvider.ts";
import { getCodexModelCapabilities } from "./CodexProvider.ts";

const PROVIDER = "cursor" as const;
const EMPTY_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS = 30_000;
const CURSOR_ACP_MODEL_CAPABILITY_TIMEOUT = "4 seconds";
const CURSOR_ACP_COMMAND_DISCOVERY_TIMEOUT = "4 seconds";
const CURSOR_ACP_MODEL_DISCOVERY_CONCURRENCY = 4;
const CURSOR_REFRESH_INTERVAL = "1 hour";
const CURSOR_PARAMETERIZED_MODEL_PICKER_MIN_VERSION_DATE = 2026_04_08;
const CURSOR_VERSION_TIMEOUT_MS = 4_000;
export const CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES = {
  _meta: {
    parameterizedModelPicker: true,
  },
} satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

function buildInitialCursorProviderSnapshot(cursorSettings: CursorSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = getCursorFallbackModels(cursorSettings);

  if (!cursorSettings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Cursor is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking Cursor Agent availability...",
    },
  });
}

interface CursorSessionSelectOption {
  readonly value: string;
  readonly name: string;
}

interface CursorAcpDiscoveredModel {
  readonly slug: string;
  readonly name: string;
  readonly capabilities: ModelCapabilities;
}

interface CursorCapabilityOption {
  readonly value: string;
  readonly label: string;
  readonly isDefault?: boolean;
}

interface ParsedCursorModelSlug {
  readonly baseModel: string;
  readonly parameters: ReadonlyMap<string, string>;
}

const COMMON_CURSOR_REASONING_EFFORT_LEVELS: ReadonlyArray<CursorCapabilityOption> = [
  { value: "xhigh", label: "Extra High" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium", isDefault: true },
  { value: "low", label: "Low" },
  { value: "max", label: "Max" },
];

function cloneCursorCapabilities(capabilities: ModelCapabilities): ModelCapabilities {
  return {
    reasoningEffortLevels: capabilities.reasoningEffortLevels.map((option) => ({ ...option })),
    supportsFastMode: capabilities.supportsFastMode,
    supportsThinkingToggle: capabilities.supportsThinkingToggle,
    contextWindowOptions: capabilities.contextWindowOptions.map((option) => ({ ...option })),
    promptInjectedEffortLevels: [...capabilities.promptInjectedEffortLevels],
  };
}

function parseCursorModelSlug(modelSlug: string): ParsedCursorModelSlug {
  const baseModel = resolveCursorAcpBaseModelId(modelSlug).trim();
  const rawParameters = modelSlug.match(/\[(.*)\]$/)?.[1] ?? "";
  const parameters = new Map<string, string>();

  for (const rawEntry of rawParameters.split(",")) {
    const trimmedEntry = rawEntry.trim();
    if (!trimmedEntry) {
      continue;
    }
    const separatorIndex = trimmedEntry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmedEntry.slice(0, separatorIndex).trim().toLowerCase();
    const value = trimmedEntry.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    parameters.set(key, value);
  }

  return {
    baseModel,
    parameters,
  };
}

function formatCursorReasoningLabel(value: string): string {
  switch (value) {
    case "xhigh":
      return "Extra High";
    case "ultrathink":
      return "Ultrathink";
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

function formatCursorContextWindowLabel(value: string): string {
  const trimmed = value.trim();
  if (/^\d+m$/i.test(trimmed)) {
    return `${trimmed.slice(0, -1)}M`;
  }
  return trimmed;
}

function withSelectedCapabilityOption(
  options: ReadonlyArray<CursorCapabilityOption>,
  selectedValue: string,
  formatLabel: (value: string) => string,
): Array<CursorCapabilityOption> {
  const normalizedSelectedValue = selectedValue.trim().toLowerCase();
  const nextOptions = options.map((option) => {
    const isDefault = option.value.trim().toLowerCase() === normalizedSelectedValue;
    return {
      value: option.value,
      label: option.label,
      ...(isDefault ? { isDefault: true } : {}),
    };
  });

  if (nextOptions.some((option) => option.isDefault)) {
    return nextOptions;
  }

  return [
    ...nextOptions,
    {
      value: selectedValue,
      label: formatLabel(selectedValue),
      isDefault: true,
    },
  ];
}

function getCursorFamilyCapabilities(baseModel: string): ModelCapabilities {
  if (baseModel.startsWith("claude-")) {
    return cloneCursorCapabilities(getClaudeModelCapabilities(baseModel));
  }
  if (baseModel.startsWith("gpt-")) {
    return cloneCursorCapabilities(getCodexModelCapabilities(baseModel));
  }
  return cloneCursorCapabilities(EMPTY_CAPABILITIES);
}

function mergeCursorCapabilities(
  primary: ModelCapabilities,
  fallback: ModelCapabilities,
): ModelCapabilities {
  return {
    reasoningEffortLevels:
      primary.reasoningEffortLevels.length > 0
        ? primary.reasoningEffortLevels.map((option) => ({ ...option }))
        : fallback.reasoningEffortLevels.map((option) => ({ ...option })),
    supportsFastMode: primary.supportsFastMode || fallback.supportsFastMode,
    supportsThinkingToggle: primary.supportsThinkingToggle || fallback.supportsThinkingToggle,
    contextWindowOptions:
      primary.contextWindowOptions.length > 0
        ? primary.contextWindowOptions.map((option) => ({ ...option }))
        : fallback.contextWindowOptions.map((option) => ({ ...option })),
    promptInjectedEffortLevels:
      primary.promptInjectedEffortLevels.length > 0
        ? [...primary.promptInjectedEffortLevels]
        : [...fallback.promptInjectedEffortLevels],
  };
}

export function inferCursorCapabilitiesFromModelSlug(modelSlug: string): ModelCapabilities {
  const { baseModel, parameters } = parseCursorModelSlug(modelSlug);
  const baseCapabilities = getCursorFamilyCapabilities(baseModel);
  let reasoningEffortLevels = baseCapabilities.reasoningEffortLevels;
  let supportsFastMode = baseCapabilities.supportsFastMode;
  let supportsThinkingToggle = baseCapabilities.supportsThinkingToggle;
  let contextWindowOptions = baseCapabilities.contextWindowOptions;
  const promptInjectedEffortLevels = baseCapabilities.promptInjectedEffortLevels;

  const selectedReasoning =
    normalizeCursorReasoningValue(parameters.get("reasoning")) ??
    normalizeCursorReasoningValue(parameters.get("effort"));
  if (selectedReasoning) {
    reasoningEffortLevels = withSelectedCapabilityOption(
      reasoningEffortLevels.length > 0
        ? reasoningEffortLevels
        : COMMON_CURSOR_REASONING_EFFORT_LEVELS,
      selectedReasoning,
      formatCursorReasoningLabel,
    );
  }

  const selectedContextWindow = parameters.get("context");
  if (selectedContextWindow) {
    contextWindowOptions = withSelectedCapabilityOption(
      contextWindowOptions,
      selectedContextWindow,
      formatCursorContextWindowLabel,
    );
  }

  if (parameters.has("fast")) {
    supportsFastMode = true;
  }

  if (parameters.has("thinking")) {
    supportsThinkingToggle = true;
  }

  return {
    reasoningEffortLevels,
    supportsFastMode,
    supportsThinkingToggle,
    contextWindowOptions,
    promptInjectedEffortLevels,
  };
}

function shouldProbeCursorModelCapabilities(model: ServerProviderModel): boolean {
  if (model.isCustom || hasCursorModelCapabilities(model)) {
    return false;
  }
  const inferredCapabilities = inferCursorCapabilitiesFromModelSlug(model.slug);
  if (hasCursorModelCapabilities({ capabilities: inferredCapabilities })) {
    return false;
  }
  const parsedModelSlug = parseCursorModelSlug(model.slug);
  return parsedModelSlug.parameters.size > 0;
}

function flattenSessionConfigSelectOptions(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
): ReadonlyArray<CursorSessionSelectOption> {
  if (!configOption || configOption.type !== "select") {
    return [];
  }
  return configOption.options.flatMap((entry) =>
    "value" in entry
      ? [{ value: entry.value.trim(), name: entry.name.trim() } satisfies CursorSessionSelectOption]
      : entry.options.map(
          (option) =>
            ({
              value: option.value.trim(),
              name: option.name.trim(),
            }) satisfies CursorSessionSelectOption,
        ),
  );
}

function normalizeCursorReasoningValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  switch (normalized) {
    case "low":
    case "medium":
    case "high":
    case "max":
      return normalized;
    case "xhigh":
    case "extra-high":
    case "extra high":
      return "xhigh";
    default:
      return undefined;
  }
}

function findCursorModelConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  return configOptions.find((option) => option.category === "model");
}

function getCursorConfigOptionCategory(option: EffectAcpSchema.SessionConfigOption): string {
  return option.category?.trim().toLowerCase() ?? "";
}

function isCursorEffortConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return (
    id === "effort" ||
    id === "reasoning" ||
    name === "effort" ||
    name === "reasoning" ||
    name.includes("effort") ||
    name.includes("reasoning")
  );
}

function findCursorEffortConfigOption(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
): EffectAcpSchema.SessionConfigOption | undefined {
  const candidates = configOptions.filter(
    (option) => option.type === "select" && isCursorEffortConfigOption(option),
  );
  return (
    candidates.find((option) => getCursorConfigOptionCategory(option) === "model_option") ??
    candidates.find((option) => option.id.trim().toLowerCase() === "effort") ??
    candidates.find((option) => getCursorConfigOptionCategory(option) === "thought_level") ??
    candidates[0]
  );
}

function isCursorContextConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "context" || id === "context_size" || name.includes("context");
}

function isCursorFastConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "fast" || name === "fast" || name.includes("fast mode");
}

function isCursorThinkingConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  const id = option.id.trim().toLowerCase();
  const name = option.name.trim().toLowerCase();
  return id === "thinking" || name.includes("thinking");
}

function isBooleanLikeConfigOption(option: EffectAcpSchema.SessionConfigOption): boolean {
  if (option.type === "boolean") {
    return true;
  }
  if (option.type !== "select") {
    return false;
  }
  const values = new Set(
    flattenSessionConfigSelectOptions(option).map((entry) => entry.value.trim().toLowerCase()),
  );
  return values.has("true") && values.has("false");
}

export function buildCursorCapabilitiesFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ModelCapabilities {
  if (!configOptions || configOptions.length === 0) {
    return EMPTY_CAPABILITIES;
  }

  const reasoningConfig = findCursorEffortConfigOption(configOptions);
  const reasoningEffortLevels =
    reasoningConfig?.type === "select"
      ? flattenSessionConfigSelectOptions(reasoningConfig).flatMap((entry) => {
          const normalizedValue = normalizeCursorReasoningValue(entry.value);
          if (!normalizedValue) {
            return [];
          }
          return [
            {
              value: normalizedValue,
              label: entry.name,
              ...(normalizeCursorReasoningValue(reasoningConfig.currentValue) === normalizedValue
                ? { isDefault: true }
                : {}),
            },
          ];
        })
      : [];

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  const contextWindowOptions =
    contextOption?.type === "select"
      ? flattenSessionConfigSelectOptions(contextOption).map((entry) => {
          if (contextOption.currentValue === entry.value) {
            return {
              value: entry.value,
              label: entry.name,
              isDefault: true,
            };
          }
          return {
            value: entry.value,
            label: entry.name,
          };
        })
      : [];

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );

  return {
    reasoningEffortLevels,
    supportsFastMode: fastOption ? isBooleanLikeConfigOption(fastOption) : false,
    supportsThinkingToggle: thinkingOption ? isBooleanLikeConfigOption(thinkingOption) : false,
    contextWindowOptions,
    promptInjectedEffortLevels: [],
  };
}

function buildCursorDiscoveredModels(
  discoveredModels: ReadonlyArray<CursorAcpDiscoveredModel>,
): ReadonlyArray<ServerProviderModel> {
  const seen = new Set<string>();
  return discoveredModels.flatMap((model) => {
    if (!model.slug || seen.has(model.slug)) {
      return [];
    }
    seen.add(model.slug);
    return [
      {
        slug: model.slug,
        name: model.name,
        isCustom: false,
        capabilities: model.capabilities,
      } satisfies ServerProviderModel,
    ];
  });
}

function hasCursorModelCapabilities(model: Pick<ServerProviderModel, "capabilities">): boolean {
  return (
    (model.capabilities?.reasoningEffortLevels.length ?? 0) > 0 ||
    model.capabilities?.supportsFastMode === true ||
    model.capabilities?.supportsThinkingToggle === true ||
    (model.capabilities?.contextWindowOptions.length ?? 0) > 0 ||
    (model.capabilities?.promptInjectedEffortLevels.length ?? 0) > 0
  );
}

export function buildCursorDiscoveredModelsFromConfigOptions(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!configOptions || configOptions.length === 0) {
    return [];
  }

  const modelOption = findCursorModelConfigOption(configOptions);
  const modelChoices = flattenSessionConfigSelectOptions(modelOption);
  if (!modelOption || modelChoices.length === 0) {
    return [];
  }

  const currentModelValue =
    modelOption.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;
  const currentModelCapabilities = currentModelValue
    ? mergeCursorCapabilities(
        buildCursorCapabilitiesFromConfigOptions(configOptions),
        inferCursorCapabilitiesFromModelSlug(currentModelValue),
      )
    : buildCursorCapabilitiesFromConfigOptions(configOptions);

  return buildCursorDiscoveredModels(
    modelChoices.map((modelChoice) => ({
      slug: modelChoice.value.trim(),
      name: modelChoice.name.trim(),
      capabilities:
        currentModelValue === modelChoice.value.trim()
          ? currentModelCapabilities
          : inferCursorCapabilitiesFromModelSlug(modelChoice.value.trim()),
    })),
  );
}

const makeCursorAcpProbeRuntime = (cursorSettings: CursorSettings) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const acpContext = yield* Layer.build(
      layerAcpSessionRuntime({
        spawn: {
          command: cursorSettings.binaryPath,
          args: [
            ...(cursorSettings.apiEndpoint ? (["-e", cursorSettings.apiEndpoint] as const) : []),
            "acp",
          ],
          cwd: process.cwd(),
        },
        cwd: process.cwd(),
        clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
        authMethodId: "cursor_login",
        clientCapabilities: CURSOR_PARAMETERIZED_MODEL_PICKER_CAPABILITIES,
      }).pipe(Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner))),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });

const withCursorAcpProbeRuntime = <A, E, R>(
  cursorSettings: CursorSettings,
  useRuntime: (acp: AcpSessionRuntime["Service"]) => Effect.Effect<A, E, R>,
) => makeCursorAcpProbeRuntime(cursorSettings).pipe(Effect.flatMap(useRuntime), Effect.scoped);

function normalizeCursorConfigOptionToken(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-") ?? ""
  );
}

function findCursorSelectOptionValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  matcher: (option: CursorSessionSelectOption) => boolean,
): string | undefined {
  return flattenSessionConfigSelectOptions(configOption).find(matcher)?.value;
}

function findCursorBooleanConfigValue(
  configOption: EffectAcpSchema.SessionConfigOption | undefined,
  requested: boolean,
): string | boolean | undefined {
  if (!configOption) {
    return undefined;
  }
  if (configOption.type === "boolean") {
    return requested;
  }
  return findCursorSelectOptionValue(
    configOption,
    (option) => normalizeCursorConfigOptionToken(option.value) === String(requested),
  );
}

export function resolveCursorAcpBaseModelId(model: string | null | undefined): string {
  const trimmed = model?.trim();
  const base = trimmed && trimmed.length > 0 ? trimmed : "default";
  return base.includes("[") ? base.slice(0, base.indexOf("[")) : base;
}

/**
 * Value for Cursor ACP `session/set_config_option` on the model id. The Agent CLI
 * rejects bare `default` / `auto` and expects bracketed tokens such as `default[]`.
 */
export function resolveCursorAcpSessionModelConfigValue(model: string | null | undefined): string {
  const trimmed = model?.trim() ?? "";
  if (trimmed.length === 0 || trimmed === "auto") {
    return "default[]";
  }
  if (trimmed === "default") {
    return "default[]";
  }
  if (trimmed.includes("[")) {
    return trimmed;
  }
  return trimmed;
}

export function resolveCursorAcpConfigUpdates(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  modelOptions: CursorModelOptions | null | undefined,
): ReadonlyArray<{ readonly configId: string; readonly value: string | boolean }> {
  if (!configOptions || configOptions.length === 0) {
    return [];
  }

  const updates: Array<{ readonly configId: string; readonly value: string | boolean }> = [];

  const reasoningOption = findCursorEffortConfigOption(configOptions);
  const requestedReasoning = normalizeCursorReasoningValue(modelOptions?.reasoning);
  if (reasoningOption && requestedReasoning) {
    const value = findCursorSelectOptionValue(reasoningOption, (option) => {
      const normalizedValue = normalizeCursorReasoningValue(option.value);
      const normalizedName = normalizeCursorReasoningValue(option.name);
      return normalizedValue === requestedReasoning || normalizedName === requestedReasoning;
    });
    if (value) {
      updates.push({ configId: reasoningOption.id, value });
    }
  }

  const contextOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorContextConfigOption(option),
  );
  if (contextOption && modelOptions?.contextWindow) {
    const value = findCursorSelectOptionValue(
      contextOption,
      (option) =>
        normalizeCursorConfigOptionToken(option.value) ===
          normalizeCursorConfigOptionToken(modelOptions.contextWindow) ||
        normalizeCursorConfigOptionToken(option.name) ===
          normalizeCursorConfigOptionToken(modelOptions.contextWindow),
    );
    if (value) {
      updates.push({ configId: contextOption.id, value });
    }
  }

  const fastOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorFastConfigOption(option),
  );
  if (fastOption && typeof modelOptions?.fastMode === "boolean") {
    const value = findCursorBooleanConfigValue(fastOption, modelOptions.fastMode);
    if (value !== undefined) {
      updates.push({ configId: fastOption.id, value });
    }
  }

  const thinkingOption = configOptions.find(
    (option) => option.category === "model_config" && isCursorThinkingConfigOption(option),
  );
  if (thinkingOption && typeof modelOptions?.thinking === "boolean") {
    const value = findCursorBooleanConfigValue(thinkingOption, modelOptions.thinking);
    if (value !== undefined) {
      updates.push({ configId: thinkingOption.id, value });
    }
  }

  return updates;
}

export const discoverCursorModelsViaAcp = (cursorSettings: CursorSettings) =>
  withCursorAcpProbeRuntime(cursorSettings, (acp) =>
    Effect.map(acp.start(), (started) =>
      buildCursorDiscoveredModelsFromConfigOptions(started.sessionSetupResult.configOptions ?? []),
    ),
  );

export const discoverCursorModelCapabilitiesViaAcp = (
  cursorSettings: CursorSettings,
  existingModels: ReadonlyArray<ServerProviderModel>,
) =>
  withCursorAcpProbeRuntime(cursorSettings, (acp) =>
    Effect.gen(function* () {
      const started = yield* acp.start();
      const initialConfigOptions = started.sessionSetupResult.configOptions ?? [];
      const modelOption = findCursorModelConfigOption(initialConfigOptions);
      const modelChoices = flattenSessionConfigSelectOptions(modelOption);
      if (!modelOption || modelChoices.length === 0) {
        return [];
      }

      const currentModelValue =
        modelOption.type === "select" ? modelOption.currentValue?.trim() || undefined : undefined;
      const capabilitiesBySlug = new Map<string, ModelCapabilities>();
      if (currentModelValue) {
        capabilitiesBySlug.set(
          currentModelValue,
          buildCursorCapabilitiesFromConfigOptions(initialConfigOptions),
        );
      }

      const targetModelSlugs = new Set(
        existingModels
          .filter((model) => shouldProbeCursorModelCapabilities(model))
          .map((model) => model.slug),
      );
      if (targetModelSlugs.size === 0) {
        return buildCursorDiscoveredModels(
          modelChoices.map((modelChoice) => ({
            slug: modelChoice.value.trim(),
            name: modelChoice.name.trim(),
            capabilities:
              capabilitiesBySlug.get(modelChoice.value.trim()) ??
              inferCursorCapabilitiesFromModelSlug(modelChoice.value.trim()),
          })),
        );
      }

      const probedCapabilities = yield* Effect.forEach(
        modelChoices,
        (modelChoice) => {
          const modelSlug = modelChoice.value.trim();
          if (!modelSlug || !targetModelSlugs.has(modelSlug) || capabilitiesBySlug.has(modelSlug)) {
            return Effect.void.pipe(
              Effect.as<readonly [string, ModelCapabilities] | undefined>(undefined),
            );
          }

          return withCursorAcpProbeRuntime(cursorSettings, (probeAcp) =>
            Effect.gen(function* () {
              const probeStarted = yield* probeAcp.start();
              const probeConfigOptions = probeStarted.sessionSetupResult.configOptions ?? [];
              const probeModelOption = findCursorModelConfigOption(probeConfigOptions);
              const probeCurrentModelValue =
                probeModelOption?.type === "select"
                  ? probeModelOption.currentValue?.trim() || undefined
                  : undefined;
              yield* Effect.annotateCurrentSpan({
                "cursor.acp.model.value": modelSlug,
                "cursor.acp.model.currentValue": probeCurrentModelValue,
                "cursor.acp.config_option_id": probeModelOption?.id ?? modelOption.id,
              });
              const nextConfigOptions =
                probeCurrentModelValue === modelSlug
                  ? probeConfigOptions
                  : yield* probeAcp
                      .setConfigOption(probeModelOption?.id ?? modelOption.id, modelSlug)
                      .pipe(Effect.map((response) => response.configOptions ?? probeConfigOptions));
              return [
                modelSlug,
                buildCursorCapabilitiesFromConfigOptions(nextConfigOptions),
              ] as const;
            }),
          ).pipe(
            Effect.timeout(CURSOR_ACP_MODEL_CAPABILITY_TIMEOUT),
            Effect.retry({ times: 3 }),
            Effect.withSpan("cursor-acp-model-capability-probe"),
            Effect.catchCause((cause) =>
              Effect.logWarning("Cursor ACP capability probe failed", {
                modelSlug,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        },
        { concurrency: CURSOR_ACP_MODEL_DISCOVERY_CONCURRENCY },
      );

      for (const entry of probedCapabilities) {
        if (!entry) {
          continue;
        }
        capabilitiesBySlug.set(entry[0], entry[1]);
      }

      return buildCursorDiscoveredModels(
        modelChoices.map((modelChoice) => ({
          slug: modelChoice.value.trim(),
          name: modelChoice.name.trim(),
          capabilities:
            capabilitiesBySlug.get(modelChoice.value.trim()) ??
            inferCursorCapabilitiesFromModelSlug(modelChoice.value.trim()),
        })),
      );
    }).pipe(Effect.withSpan("cursor-acp-model-capability-discovery", {})),
  );

function mapAcpAvailableCommandsToSlashCommands(
  commands: ReadonlyArray<AcpAvailableCommand>,
): ReadonlyArray<ServerProviderSlashCommand> {
  const commandsByName = new Map<string, ServerProviderSlashCommand>();
  for (const command of commands) {
    const name = command.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (commandsByName.has(key)) continue;
    const description = command.description.trim();
    const inputHint = command.inputHint?.trim();
    commandsByName.set(key, {
      name,
      ...(description ? { description } : {}),
      ...(inputHint ? { input: { hint: inputHint } } : {}),
    });
  }
  return [...commandsByName.values()];
}

export const discoverCursorSlashCommandsViaAcp = (cursorSettings: CursorSettings) =>
  withCursorAcpProbeRuntime(cursorSettings, (acp) =>
    Effect.gen(function* () {
      yield* acp.start();
      const event = yield* Stream.filter(
        acp.getEvents(),
        (next): next is Extract<AcpParsedSessionEvent, { readonly _tag: "AvailableCommandsUpdated" }> =>
          next._tag === "AvailableCommandsUpdated",
      ).pipe(Stream.runHead, Effect.timeoutOption(CURSOR_ACP_COMMAND_DISCOVERY_TIMEOUT));
      if (Option.isNone(event)) {
        return [];
      }
      return mapAcpAvailableCommandsToSlashCommands(event.value.commands);
    }).pipe(Effect.withSpan("cursor-acp-command-discovery", {})),
  );

export function getCursorFallbackModels(
  cursorSettings: Pick<CursorSettings, "customModels">,
): ReadonlyArray<ServerProviderModel> {
  const configuredModel = readCursorCliConfigCurrentModel();
  return providerModelsFromSettings(
    configuredModel ? [configuredModel] : [],
    PROVIDER,
    cursorSettings.customModels,
    EMPTY_CAPABILITIES,
  );
}

/** Timeout for `agent about` — it's slower than a simple `--version` probe. */
const ABOUT_TIMEOUT_MS = 12_000;

/** Strip ANSI escape sequences so we can parse plain key-value lines. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\].*?\x07/g, "");
}

/**
 * Extract a value from `agent about` key-value output.
 * Lines look like: `CLI Version         2026.03.20-44cb435`
 */
function extractAboutField(plain: string, key: string): string | undefined {
  const regex = new RegExp(`^${key}\\s{2,}(.+)$`, "mi");
  const match = regex.exec(plain);
  return match?.[1]?.trim();
}

export interface CursorAboutResult {
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
}

interface CursorCommandResult extends CommandResult {
  readonly signal: NodeJS.Signals | null;
  readonly timedOut?: boolean;
}

function joinProviderMessages(...messages: ReadonlyArray<string | undefined>): string | undefined {
  const parts = messages
    .map((message) => message?.trim())
    .filter((message): message is string => Boolean(message));
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function buildCursorMetadataRecoveryMessage(...messages: ReadonlyArray<string | undefined>): string {
  const detail = joinProviderMessages(...messages);
  return detail
    ? `Using Cursor ACP metadata because \`agent about\` failed. ${detail}`
    : "Using Cursor ACP metadata because `agent about` failed.";
}

export function buildCursorProviderSnapshot(input: {
  readonly checkedAt: string;
  readonly cursorSettings: CursorSettings;
  readonly parsed: CursorAboutResult;
  readonly discoveredModels?: ReadonlyArray<ServerProviderModel>;
  readonly slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  readonly discoveryWarning?: string;
}): ServerProvider {
  const message = joinProviderMessages(input.parsed.message, input.discoveryWarning);
  const models =
    input.discoveredModels && input.discoveredModels.length > 0
      ? providerModelsFromSettings(
          input.discoveredModels,
          PROVIDER,
          input.cursorSettings.customModels,
          EMPTY_CAPABILITIES,
        )
      : getCursorFallbackModels(input.cursorSettings);
  return buildServerProvider({
    provider: PROVIDER,
    enabled: input.cursorSettings.enabled,
    checkedAt: input.checkedAt,
    models,
    slashCommands: input.slashCommands,
    probe: {
      installed: true,
      version: input.parsed.version,
      status:
        input.discoveryWarning && input.parsed.status === "ready" ? "warning" : input.parsed.status,
      auth: input.parsed.auth,
      ...(message ? { message } : {}),
    },
  });
}

export function buildRecoveredCursorProviderSnapshot(input: {
  readonly checkedAt: string;
  readonly cursorSettings: CursorSettings;
  readonly parsed: CursorAboutResult;
  readonly discoveredModels: ReadonlyArray<ServerProviderModel>;
  readonly slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  readonly fallbackVersion?: string | null;
  readonly discoveryWarning?: string;
}): ServerProvider {
  return buildServerProvider({
    provider: PROVIDER,
    enabled: input.cursorSettings.enabled,
    checkedAt: input.checkedAt,
    models: providerModelsFromSettings(
      input.discoveredModels,
      PROVIDER,
      input.cursorSettings.customModels,
      EMPTY_CAPABILITIES,
    ),
    slashCommands: input.slashCommands,
    probe: {
      installed: true,
      version: input.parsed.version ?? input.fallbackVersion ?? null,
      status: "warning",
      auth: input.parsed.auth,
      message: buildCursorMetadataRecoveryMessage(
        input.parsed.message,
        input.discoveryWarning,
      ),
    },
  });
}

interface CursorAboutJsonPayload {
  readonly cliVersion?: unknown;
  readonly subscriptionTier?: unknown;
  readonly userEmail?: unknown;
}

interface CursorCliConfigModelPayload {
  readonly modelId?: unknown;
  readonly displayModelId?: unknown;
  readonly displayName?: unknown;
  readonly displayNameShort?: unknown;
}

interface CursorCliConfigPayload {
  readonly channel?: unknown;
  readonly model?: unknown;
}

export function parseCursorVersionDate(version: string | null | undefined): number | undefined {
  const match = version?.trim().match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\b|-|$)/);
  if (!match) {
    return undefined;
  }
  const [, year, month, day] = match;
  return Number(`${year}${month}${day}`);
}

function parseCursorCliConfig(raw: string): CursorCliConfigPayload | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as CursorCliConfigPayload;
    }
  } catch {
    // Ignore malformed configs and fall back to CLI probes.
  }
  return undefined;
}

export function parseCursorCliConfigChannel(raw: string): string | undefined {
  const parsed = parseCursorCliConfig(raw);
  if (typeof parsed?.channel !== "string") {
    return undefined;
  }
  const channel = parsed.channel.trim().toLowerCase();
  return channel.length > 0 ? channel : undefined;
}

export function parseCursorCliConfigCurrentModel(
  raw: string,
): ServerProviderModel | undefined {
  const parsed = parseCursorCliConfig(raw);
  const model =
    parsed?.model && typeof parsed.model === "object" && parsed.model !== null
      ? (parsed.model as CursorCliConfigModelPayload)
      : undefined;
  if (!model) {
    return undefined;
  }

  const slugCandidate =
    typeof model.modelId === "string"
      ? model.modelId.trim()
      : typeof model.displayModelId === "string"
        ? model.displayModelId.trim()
        : "";
  if (slugCandidate.length === 0) {
    return undefined;
  }

  const nameCandidate =
    typeof model.displayName === "string" && model.displayName.trim().length > 0
      ? model.displayName.trim()
      : typeof model.displayNameShort === "string" && model.displayNameShort.trim().length > 0
        ? model.displayNameShort.trim()
        : typeof model.displayModelId === "string" && model.displayModelId.trim().length > 0
          ? model.displayModelId.trim()
          : slugCandidate;

  return {
    slug: slugCandidate,
    name: nameCandidate,
    isCustom: false,
    capabilities: inferCursorCapabilitiesFromModelSlug(slugCandidate),
  };
}

function toTitleCaseWords(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function cursorSubscriptionLabel(subscriptionType: string | undefined): string | undefined {
  const normalized = subscriptionType?.toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) return undefined;

  switch (normalized) {
    case "team":
      return "Team";
    case "pro":
      return "Pro";
    case "free":
      return "Free";
    case "business":
      return "Business";
    case "enterprise":
      return "Enterprise";
    default:
      return toTitleCaseWords(subscriptionType!);
  }
}

function cursorAuthMetadata(
  subscriptionType: string | undefined,
): Pick<ServerProviderAuth, "label" | "type"> | undefined {
  if (!subscriptionType) {
    return undefined;
  }
  const subscriptionLabel = cursorSubscriptionLabel(subscriptionType);
  return {
    type: subscriptionType,
    label: `Cursor ${subscriptionLabel ?? toTitleCaseWords(subscriptionType)} Subscription`,
  };
}

function parseCursorAboutJsonPayload(raw: string): CursorAboutJsonPayload | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as CursorAboutJsonPayload;
  } catch {
    return undefined;
  }
}

function hasOwn(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getCursorCredentialAccessErrorMessage(combinedOutput: string): string | undefined {
  const lowerOutput = combinedOutput.toLowerCase();
  if (
    lowerOutput.includes("secitemcopymatching failed") ||
    lowerOutput.includes("errsecinteractionnotallowed") ||
    lowerOutput.includes("user interaction is not allowed")
  ) {
    return (
      "Cursor Agent CLI could not read its macOS Keychain credentials. " +
      "Unlock the login keychain, open Cursor once, then run `agent login` again if needed."
    );
  }
  return undefined;
}

function getCursorAboutFailureMessage(result: CursorCommandResult): string {
  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const credentialAccessErrorMessage = getCursorCredentialAccessErrorMessage(combinedOutput);
  if (credentialAccessErrorMessage) {
    return credentialAccessErrorMessage;
  }

  if (result.timedOut) {
    return "Cursor Agent CLI timed out while running `agent about`.";
  }

  const detail = nonEmptyTrimmed(result.stderr) ?? nonEmptyTrimmed(result.stdout);
  if (detail) {
    return `Cursor Agent CLI failed while running \`agent about\`: ${detail}`;
  }

  if (result.signal) {
    return `Cursor Agent CLI crashed while running \`agent about\` (${result.signal}).`;
  }

  if (result.code !== 0) {
    return `Cursor Agent CLI exited with code ${result.code} while running \`agent about\`.`;
  }

  return "Cursor Agent CLI failed while running `agent about`.";
}

function parseCursorVersionFromCommandResult(result: CommandResult): string | null {
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout && !stdout.includes("\n")) {
    return stdout;
  }
  return parseGenericCliVersion(`${result.stdout}\n${result.stderr}`);
}

function isCursorAboutJsonFormatUnsupported(result: CommandResult): boolean {
  const lowerOutput = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return (
    lowerOutput.includes("unknown option '--format'") ||
    lowerOutput.includes("unexpected argument '--format'") ||
    lowerOutput.includes("unrecognized option '--format'") ||
    lowerOutput.includes("unknown argument '--format'")
  );
}

function readCursorCliConfigChannel(): string | undefined {
  try {
    const configPath = nodePath.join(nodeOs.homedir(), ".cursor", "cli-config.json");
    return parseCursorCliConfigChannel(nodeFs.readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }
}

function readCursorCliConfigCurrentModel(): ServerProviderModel | undefined {
  try {
    const configPath = nodePath.join(nodeOs.homedir(), ".cursor", "cli-config.json");
    return parseCursorCliConfigCurrentModel(nodeFs.readFileSync(configPath, "utf8"));
  } catch {
    return undefined;
  }
}

export function getCursorParameterizedModelPickerUnsupportedMessage(input: {
  readonly version: string | null | undefined;
  readonly channel: string | null | undefined;
}): string | undefined {
  const reasons: Array<string> = [];
  const versionDate = parseCursorVersionDate(input.version);
  if (
    versionDate !== undefined &&
    versionDate < CURSOR_PARAMETERIZED_MODEL_PICKER_MIN_VERSION_DATE
  ) {
    reasons.push(
      `Cursor Agent CLI version ${input.version} is too old for Cursor ACP parameterized model picker`,
    );
  }

  const normalizedChannel = input.channel?.trim().toLowerCase();
  if (
    normalizedChannel !== undefined &&
    normalizedChannel.length > 0 &&
    normalizedChannel !== "lab"
  ) {
    reasons.push(
      `Cursor Agent CLI channel is ${JSON.stringify(input.channel)}, but parameterized model picker is only available on the lab channel`,
    );
  }

  if (reasons.length === 0) {
    return undefined;
  }

  return `${reasons.join(". ")}. Run \`agent set-channel lab && agent update\` and use Cursor Agent CLI 2026.04.08 or newer.`;
}

/**
 * Parse the output of `agent about` to extract version and authentication
 * status in a single probe.
 *
 * Example output (logged in):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          user@example.com
 * ```
 *
 * Example output (logged out):
 * ```
 * About Cursor CLI
 *
 * CLI Version         2026.03.20-44cb435
 * User Email          Not logged in
 * ```
 */
export function parseCursorAboutOutput(result: CommandResult): CursorAboutResult {
  const combined = `${result.stdout}\n${result.stderr}`;
  const jsonPayload = parseCursorAboutJsonPayload(result.stdout);
  if (jsonPayload) {
    const version =
      typeof jsonPayload.cliVersion === "string" ? jsonPayload.cliVersion.trim() : null;
    const hasUserEmailField = hasOwn(jsonPayload, "userEmail");
    const userEmail =
      typeof jsonPayload.userEmail === "string" ? jsonPayload.userEmail.trim() : undefined;
    const subscriptionType =
      typeof jsonPayload.subscriptionTier === "string"
        ? jsonPayload.subscriptionTier.trim()
        : undefined;
    const authMetadata = cursorAuthMetadata(subscriptionType);

    if (hasUserEmailField && jsonPayload.userEmail == null) {
      return {
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
      };
    }

    if (!userEmail) {
      if (result.code === 0) {
        return {
          version,
          status: "ready",
          auth: {
            status: "unknown",
            ...authMetadata,
          },
        };
      }
      return {
        version,
        status: "warning",
        auth: { status: "unknown" },
        message: "Could not verify Cursor Agent authentication status.",
      };
    }

    const lowerEmail = userEmail.toLowerCase();
    if (
      lowerEmail === "not logged in" ||
      lowerEmail.includes("login required") ||
      lowerEmail.includes("authentication required")
    ) {
      return {
        version,
        status: "error",
        auth: { status: "unauthenticated" },
        message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
      };
    }

    return {
      version,
      status: "ready",
      auth: {
        status: "authenticated",
        ...authMetadata,
      },
    };
  }

  const lowerOutput = combined.toLowerCase();
  const credentialAccessErrorMessage = getCursorCredentialAccessErrorMessage(combined);
  if (credentialAccessErrorMessage) {
    const plain = stripAnsi(combined);
    return {
      version: extractAboutField(plain, "CLI Version") ?? null,
      status: "error",
      auth: { status: "unknown" },
      message: credentialAccessErrorMessage,
    };
  }

  // If the command itself isn't recognised, we're on an old CLI version.
  if (
    lowerOutput.includes("unknown command") ||
    lowerOutput.includes("unrecognized command") ||
    lowerOutput.includes("unexpected argument")
  ) {
    return {
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "The `agent about` command is unavailable in this version of the Cursor Agent CLI.",
    };
  }

  const plain = stripAnsi(combined);
  const version = extractAboutField(plain, "CLI Version") ?? null;
  const userEmail = extractAboutField(plain, "User Email");

  // Determine auth from the User Email field.
  if (userEmail === undefined) {
    // Field missing entirely — can't determine auth.
    if (result.code === 0) {
      return { version, status: "ready", auth: { status: "unknown" } };
    }
    return {
      version,
      status: "warning",
      auth: { status: "unknown" },
      message: "Could not verify Cursor Agent authentication status.",
    };
  }

  const lowerEmail = userEmail.toLowerCase();
  if (
    lowerEmail === "not logged in" ||
    lowerEmail.includes("login required") ||
    lowerEmail.includes("authentication required")
  ) {
    return {
      version,
      status: "error",
      auth: { status: "unauthenticated" },
      message: "Cursor Agent is not authenticated. Run `agent login` and try again.",
    };
  }

  // Any non-empty email value means authenticated.
  return { version, status: "ready", auth: { status: "authenticated" } };
}

const spawnCursorCommand = (
  binaryPath: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
): Promise<CursorCommandResult> =>
  new Promise((resolve, reject) => {
    const child = nodeChildProcess.spawn(binaryPath, [...args], {
      shell: process.platform === "win32",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeoutHandle =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            const forceKillHandle = setTimeout(() => {
              child.kill("SIGKILL");
            }, 1_000);
            forceKillHandle.unref();
          }, timeoutMs)
        : null;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      callback();
    };

    child.once("error", (error) => {
      settle(() => reject(error));
    });

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("close", (code, signal) => {
      settle(() =>
        resolve({
          stdout,
          stderr,
          code: typeof code === "number" ? code : 1,
          signal,
          ...(timedOut ? { timedOut: true } : {}),
        }),
      );
    });
  });

const runCursorCommand = (
  args: ReadonlyArray<string>,
  timeoutMs: number,
) =>
  Effect.gen(function* () {
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.cursor),
    );
    const result = yield* Effect.tryPromise({
      try: () => spawnCursorCommand(cursorSettings.binaryPath, args, timeoutMs),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    });

    if (process.platform === "win32" && result.code === 9009) {
      return yield* Effect.fail(new Error(`spawn ${cursorSettings.binaryPath} ENOENT`));
    }

    return result;
  }).pipe(Effect.scoped);

const runCursorAboutCommand = Effect.gen(function* () {
  const jsonResult = yield* runCursorCommand(["about", "--format", "json"], ABOUT_TIMEOUT_MS);
  if (!isCursorAboutJsonFormatUnsupported(jsonResult)) {
    return jsonResult;
  }
  return yield* runCursorCommand(["about"], ABOUT_TIMEOUT_MS);
});

const runCursorVersionCommand = runCursorCommand(["--version"], CURSOR_VERSION_TIMEOUT_MS);

const discoverCursorModelsWithWarning = (cursorSettings: CursorSettings) =>
  Effect.gen(function* () {
    let discoveredModels: ReadonlyArray<ServerProviderModel> = [];
    let discoveryWarning: string | undefined;

    const discoveryExit = yield* Effect.exit(
      discoverCursorModelsViaAcp(cursorSettings).pipe(
        Effect.timeoutOption(CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS),
      ),
    );

    if (Exit.isFailure(discoveryExit)) {
      yield* Effect.logWarning("Cursor ACP model discovery failed", {
        cause: Cause.pretty(discoveryExit.cause),
      });
      discoveryWarning = "Cursor ACP model discovery failed. Check server logs for details.";
    } else if (Option.isNone(discoveryExit.value)) {
      discoveryWarning = `Cursor ACP model discovery timed out after ${CURSOR_ACP_MODEL_DISCOVERY_TIMEOUT_MS}ms.`;
    } else if (discoveryExit.value.value.length === 0) {
      discoveryWarning = "Cursor ACP model discovery returned no built-in models.";
    } else {
      discoveredModels = discoveryExit.value.value;
    }

    return { discoveredModels, discoveryWarning } as const;
  });

export const checkCursorProviderStatus = Effect.fn("checkCursorProviderStatus")(
  function* (): Effect.fn.Return<
    ServerProvider,
    ServerSettingsError,
    ChildProcessSpawner.ChildProcessSpawner | ServerSettingsService
  > {
    const cursorSettings = yield* Effect.service(ServerSettingsService).pipe(
      Effect.flatMap((service) => service.getSettings),
      Effect.map((settings) => settings.providers.cursor),
    );
    const checkedAt = new Date().toISOString();
    const fallbackModels = getCursorFallbackModels(cursorSettings);

    if (!cursorSettings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Cursor is disabled in T3 Code settings.",
        },
      });
    }

    const fallbackVersion = yield* Effect.match(
      runCursorVersionCommand,
      {
        onFailure: () => null,
        onSuccess: (result) => parseCursorVersionFromCommandResult(result),
      },
    );

    // Single `agent about` probe: returns version + auth status in one call.
    const aboutProbe = yield* Effect.result(runCursorAboutCommand);

    if (Result.isFailure(aboutProbe)) {
      const error = aboutProbe.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: !isCommandMissingCause(error),
          version: fallbackVersion,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "Cursor Agent CLI (`agent`) is not installed or not on PATH."
            : `Failed to execute Cursor Agent CLI health check: ${error instanceof Error ? error.message : String(error)}.`,
        },
      });
    }

    const aboutResult = aboutProbe.success;
    const parsed =
      aboutResult.timedOut
        ? {
            version: fallbackVersion,
            status: "error" as const,
            auth: { status: "unknown" } as const,
            message: getCursorAboutFailureMessage(aboutResult),
          }
        : (() => {
            const parsedAbout = parseCursorAboutOutput(aboutResult);
            return parsedAbout.version || !fallbackVersion
              ? parsedAbout
              : { ...parsedAbout, version: fallbackVersion };
          })();
    const parameterizedModelPickerUnsupportedMessage =
      getCursorParameterizedModelPickerUnsupportedMessage({
        version: parsed.version,
        channel: readCursorCliConfigChannel(),
      });
    if (parameterizedModelPickerUnsupportedMessage) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: cursorSettings.enabled,
        checkedAt,
        models: fallbackModels,
        probe: {
          installed: true,
          version: parsed.version,
          status: "error",
          auth: parsed.auth,
          message:
            parsed.auth.status === "unauthenticated" && parsed.message
              ? `${parameterizedModelPickerUnsupportedMessage} ${parsed.message}`
              : parameterizedModelPickerUnsupportedMessage,
        },
      });
    }

    const { discoveredModels, discoveryWarning } =
      parsed.auth.status === "unauthenticated"
        ? { discoveredModels: [] as const, discoveryWarning: undefined }
        : yield* discoverCursorModelsWithWarning(cursorSettings);
    const slashCommands =
      parsed.auth.status === "unauthenticated"
        ? []
        : yield* discoverCursorSlashCommandsViaAcp(cursorSettings).pipe(
            Effect.timeoutOption(CURSOR_ACP_COMMAND_DISCOVERY_TIMEOUT),
            Effect.flatMap((result) => (Option.isSome(result) ? Effect.succeed(result.value) : Effect.succeed([]))),
            Effect.catchCause((cause) =>
              Effect.logWarning("Cursor ACP command discovery failed", {
                cause: Cause.pretty(cause),
              }).pipe(Effect.as([] as ReadonlyArray<ServerProviderSlashCommand>)),
            ),
          );

    if (parsed.status === "error" && parsed.auth.status !== "unauthenticated" && discoveredModels.length > 0) {
      return buildRecoveredCursorProviderSnapshot({
        checkedAt,
        cursorSettings,
        parsed,
        discoveredModels,
        slashCommands,
        fallbackVersion,
        ...(discoveryWarning ? { discoveryWarning } : {}),
      });
    }

    return buildCursorProviderSnapshot({
      checkedAt,
      cursorSettings,
      parsed,
      discoveredModels,
      slashCommands,
      ...(discoveryWarning ? { discoveryWarning } : {}),
    });
  },
);

export const CursorProviderLive = Layer.effect(
  CursorProvider,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const checkProvider = checkCursorProviderStatus().pipe(
      Effect.provideService(ServerSettingsService, serverSettings),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
    );

    return yield* makeManagedServerProvider<CursorSettings>({
      getSettings: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.cursor),
        Effect.orDie,
      ),
      streamSettings: serverSettings.streamChanges.pipe(
        Stream.map((settings) => settings.providers.cursor),
      ),
      haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
      initialSnapshot: buildInitialCursorProviderSnapshot,
      checkProvider,
      enrichSnapshot: ({ settings, snapshot, publishSnapshot }) => {
        if (
          !settings.enabled ||
          snapshot.auth.status === "unauthenticated" ||
          !snapshot.models.some((model) => !model.isCustom && !hasCursorModelCapabilities(model))
        ) {
          return Effect.void;
        }

        return discoverCursorModelCapabilitiesViaAcp(settings, snapshot.models).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
          Effect.flatMap((discoveredModels) => {
            if (discoveredModels.length === 0) {
              return Effect.void;
            }

            return publishSnapshot({
              ...snapshot,
              models: providerModelsFromSettings(
                discoveredModels,
                PROVIDER,
                settings.customModels,
                EMPTY_CAPABILITIES,
              ),
            });
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning("Cursor ACP background capability enrichment failed", {
              models: snapshot.models.map((model) => model.slug),
              cause: Cause.pretty(cause),
            }).pipe(Effect.asVoid),
          ),
        );
      },
      refreshInterval: CURSOR_REFRESH_INTERVAL,
    });
  }),
);
