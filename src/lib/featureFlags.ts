interface FeatureFlagDefinition {
  key: string
  defaultValue: boolean
}

const DEFINITIONS = {
  viewTransitions: { key: 'VITE_FF_VIEW_TRANSITIONS', defaultValue: true },
  prioritizedScheduling: { key: 'VITE_FF_PRIORITIZED_SCHEDULING', defaultValue: true },
  jankDiagnostics: { key: 'VITE_FF_JANK_DIAGNOSTICS', defaultValue: true },
  contentVisibility: { key: 'VITE_FF_CONTENT_VISIBILITY', defaultValue: true },
  localWorkspaceCatalog: { key: 'VITE_FF_LOCAL_WORKSPACE_CATALOG', defaultValue: true },
} satisfies Record<string, FeatureFlagDefinition>

function parseBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  if (!rawValue) return fallback
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }
  return fallback
}

export const featureFlags = {
  viewTransitions: parseBoolean(import.meta.env[DEFINITIONS.viewTransitions.key], DEFINITIONS.viewTransitions.defaultValue),
  prioritizedScheduling: parseBoolean(
    import.meta.env[DEFINITIONS.prioritizedScheduling.key],
    DEFINITIONS.prioritizedScheduling.defaultValue
  ),
  jankDiagnostics: parseBoolean(
    import.meta.env[DEFINITIONS.jankDiagnostics.key],
    DEFINITIONS.jankDiagnostics.defaultValue
  ),
  contentVisibility: parseBoolean(
    import.meta.env[DEFINITIONS.contentVisibility.key],
    DEFINITIONS.contentVisibility.defaultValue
  ),
  localWorkspaceCatalog: parseBoolean(
    import.meta.env[DEFINITIONS.localWorkspaceCatalog.key],
    DEFINITIONS.localWorkspaceCatalog.defaultValue
  ),
} as const
