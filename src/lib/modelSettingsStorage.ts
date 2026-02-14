import type { AgentId, VariantId, AISurface } from '@/lib/ai/runtimeProfiles'

export type StoredModelSettings = {
  agentId?: AgentId;
  variantId?: VariantId;
  surface?: AISurface;
}

const STORAGE_KEY = "crosscode.ai.modelSettings.v2";
const GLOBAL_STORAGE_KEY = "crosscode.ai.globalSettings.v1";

export type GlobalModelSettings = {
  model?: string;
  variantId?: VariantId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLegacyModelKey(key: string): { surface?: AISurface; model?: string } {
  const separatorIndex = key.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex >= key.length - 1) {
    return { model: key || undefined }
  }
  const surface = key.slice(0, separatorIndex)
  const model = key.slice(separatorIndex + 1)
  const normalizedSurface: AISurface | undefined =
    surface === 'wizard' ||
    surface === 'builder' ||
    surface === 'assistant_panel' ||
    surface === 'assistant_project'
      ? surface
      : undefined
  return {
    surface: normalizedSurface,
    model: model || undefined,
  }
}

export function getModelSettingsKey(model: string, surface: AISurface): string {
  return `${surface}:${model}`
}

export function readStoredModelSettings(
  settings: Record<string, StoredModelSettings>,
  model: string,
  surface: AISurface
): StoredModelSettings | undefined {
  return settings[getModelSettingsKey(model, surface)]
}

export function writeStoredModelSettings(
  settings: Record<string, StoredModelSettings>,
  model: string,
  surface: AISurface,
  value: StoredModelSettings
): Record<string, StoredModelSettings> {
  return {
    ...settings,
    [getModelSettingsKey(model, surface)]: {
      ...value,
      surface,
    },
  }
}

export function loadModelSettings(): Record<string, StoredModelSettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, StoredModelSettings>;
  } catch {
    return {};
  }
}

export function saveModelSettings(settings: Record<string, StoredModelSettings>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors (e.g., quota exceeded or disabled storage)
  }
}

function migrateGlobalSettingsFromLegacy(): GlobalModelSettings {
  const legacy = loadModelSettings()
  const entries = Object.entries(legacy)
    .map(([key, value]) => {
      const parsedKey = parseLegacyModelKey(key)
      return {
        surface: parsedKey.surface,
        model: parsedKey.model,
        variantId: value.variantId,
      }
    })
    .filter((item) => item.model)

  if (entries.length === 0) return {}

  const surfacePriority: AISurface[] = ['assistant_panel', 'assistant_project', 'wizard', 'builder']
  for (const surface of surfacePriority) {
    const hit = entries.find((entry) => entry.surface === surface)
    if (hit) {
      return {
        model: hit.model,
        variantId: hit.variantId,
      }
    }
  }

  return {
    model: entries[0]?.model,
    variantId: entries[0]?.variantId,
  }
}

export function loadGlobalModelSettings(): GlobalModelSettings {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(GLOBAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isRecord(parsed)) {
        return {
          model: typeof parsed.model === 'string' ? parsed.model : undefined,
          variantId: typeof parsed.variantId === 'string' ? parsed.variantId as VariantId : undefined,
        }
      }
    }

    const migrated = migrateGlobalSettingsFromLegacy()
    if (migrated.model || migrated.variantId) {
      saveGlobalModelSettings(migrated)
    }
    return migrated
  } catch {
    return {};
  }
}

export function saveGlobalModelSettings(settings: GlobalModelSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GLOBAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors (e.g., quota exceeded or disabled storage)
  }
}

export function updateGlobalModelSettings(
  updates: Partial<GlobalModelSettings>
): GlobalModelSettings {
  const current = loadGlobalModelSettings()
  const next = {
    ...current,
    ...updates,
  }
  saveGlobalModelSettings(next)
  return next
}
