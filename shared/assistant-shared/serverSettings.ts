// @ts-nocheck
import {
  type ProviderKind,
  ServerSettings,
  type ServerSettingsPatch,
} from "@cozea/assistant-contracts";
import { Schema } from "effect";

import { deepMerge } from "./Struct";
import { createModelSelection, mergeProviderOptionSelections } from "./model";
import { fromLenientJson } from "./schemaJson";

const ServerSettingsJson = fromLenientJson(ServerSettings);

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  try {
    const decoded = Schema.decodeUnknownSync(ServerSettingsJson)(raw);
    return extractPersistedServerObservabilitySettings(decoded);
  } catch {
    return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
  }
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const selectionPatch = patch.textGenerationModelSelection;
  const merged = deepMerge(current, patch);
  const next =
    patch.providerInstances === undefined
      ? merged
      : {
          ...merged,
          providerInstances: patch.providerInstances,
        };
  if (!selectionPatch) {
    return next;
  }

  const provider =
    selectionPatch.provider ??
    current.textGenerationModelSelection.provider ??
    inferBuiltInProvider(selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId) ??
    "codex";
  const instanceId =
    selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId ?? provider;
  const model = selectionPatch.model ?? current.textGenerationModelSelection.model;
  const shouldReplaceSelection =
    selectionPatch.provider !== undefined ||
    selectionPatch.instanceId !== undefined ||
    selectionPatch.model !== undefined;
  if (!shouldReplaceSelection && selectionPatch.options === undefined) {
    return next;
  }
  const nextOptions = shouldReplaceSelection
    ? selectionPatch.options
    : mergeProviderOptionSelections(
        current.textGenerationModelSelection.options,
        selectionPatch.options,
      );

  return {
    ...next,
    textGenerationModelSelection: createModelSelection(provider, model, nextOptions, instanceId),
  };
}

function inferBuiltInProvider(instanceId: unknown): ProviderKind | undefined {
  return instanceId === "codex" ||
    instanceId === "claudeAgent" ||
    instanceId === "cursor" ||
    instanceId === "opencode"
    ? instanceId
    : undefined;
}
