// @ts-nocheck
import {
  inferProviderFromInstanceId,
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
          // Merge per-instance so a partial patch (one edited instance) does not
          // drop the other configured instances. Each patched instance config
          // replaces its prior entry wholesale — deepMerge would otherwise
          // index-merge nested arrays (e.g. `environment`), which is incorrect.
          providerInstances: {
            ...current.providerInstances,
            ...patch.providerInstances,
          },
        };
  if (!selectionPatch) {
    return next;
  }

  const provider =
    selectionPatch.provider ??
    current.textGenerationModelSelection.provider ??
    inferProviderFromInstanceId(
      selectionPatch.instanceId ?? current.textGenerationModelSelection.instanceId,
    ) ??
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
