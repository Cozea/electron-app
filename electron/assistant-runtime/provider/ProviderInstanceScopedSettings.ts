// @ts-nocheck
import {
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerSettings,
} from "@cozea/assistant-contracts";
import { Effect, Stream } from "effect";

import type { ServerSettingsShape } from "../serverSettings.ts";

export function asBuiltInProviderKind(driver: ProviderDriverKind): ProviderKind | undefined {
  return driver === "codex" ||
    driver === "claudeAgent" ||
    driver === "opencode" ||
    driver === "cursor"
    ? driver
    : undefined;
}

export function isProviderInstanceEnabled(input: {
  readonly settings: ServerSettings;
  readonly provider: ProviderKind;
  readonly instanceId: ProviderInstanceId;
}): boolean {
  const explicit = input.settings.providerInstances[input.instanceId];
  if (explicit) {
    if (typeof explicit.enabled === "boolean") {
      return explicit.enabled;
    }
    const config = explicit.config;
    if (config && typeof config === "object" && !Array.isArray(config)) {
      const enabled = (config as { readonly enabled?: unknown }).enabled;
      if (typeof enabled === "boolean") {
        return enabled;
      }
    }
    return true;
  }
  return input.settings.providers[input.provider]?.enabled !== false;
}

export function makeProviderInstanceScopedSettings(input: {
  readonly upstream: ServerSettingsShape;
  readonly driverKind: ProviderDriverKind;
  readonly provider: ProviderKind;
  readonly instanceId: ProviderInstanceId;
  readonly environment?: ServerSettings["providerInstances"][string]["environment"];
  readonly config: Record<string, unknown>;
  readonly enabled: boolean;
}): ServerSettingsShape {
  const materialize = (settings: ServerSettings): ServerSettings => {
    const providerSettings = settings.providers[input.provider] ?? {};
    return {
      ...settings,
      providers: {
        ...settings.providers,
        [input.provider]: {
          ...providerSettings,
          ...input.config,
          ...(input.environment ? { environment: input.environment } : {}),
          enabled: input.enabled,
        },
      },
      textGenerationModelSelection:
        settings.textGenerationModelSelection.instanceId === input.instanceId
          ? {
              ...settings.textGenerationModelSelection,
              provider: input.provider,
              instanceId: input.instanceId,
            }
          : settings.textGenerationModelSelection,
    };
  };

  return {
    start: input.upstream.start,
    ready: input.upstream.ready,
    getSettings: input.upstream.getSettings.pipe(Effect.map(materialize)),
    updateSettings: input.upstream.updateSettings,
    get streamChanges() {
      return input.upstream.streamChanges.pipe(Stream.map(materialize));
    },
  };
}
