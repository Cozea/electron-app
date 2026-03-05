interface FeatureFlagDefinition {
  key: string
  defaultValue: boolean
}

const DEFINITIONS = {
  dataRouter: { key: 'VITE_FF_DATA_ROUTER', defaultValue: true },
  viewTransitions: { key: 'VITE_FF_VIEW_TRANSITIONS', defaultValue: true },
  prioritizedScheduling: { key: 'VITE_FF_PRIORITIZED_SCHEDULING', defaultValue: true },
  reactCompiler: { key: 'VITE_FF_REACT_COMPILER', defaultValue: true },
  rolldownBuild: { key: 'VITE_FF_ROLLDOWN_BUILD', defaultValue: true },
  jankDiagnostics: { key: 'VITE_FF_JANK_DIAGNOSTICS', defaultValue: true },
  contentVisibility: { key: 'VITE_FF_CONTENT_VISIBILITY', defaultValue: true },
  offscreenScreenshotEncoding: { key: 'VITE_FF_OFFSCREEN_SCREENSHOT', defaultValue: true },
  utilityProcessManifest: { key: 'VITE_FF_UTILITY_PROCESS_MANIFEST', defaultValue: true },
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
  dataRouter: parseBoolean(import.meta.env[DEFINITIONS.dataRouter.key], DEFINITIONS.dataRouter.defaultValue),
  viewTransitions: parseBoolean(import.meta.env[DEFINITIONS.viewTransitions.key], DEFINITIONS.viewTransitions.defaultValue),
  prioritizedScheduling: parseBoolean(
    import.meta.env[DEFINITIONS.prioritizedScheduling.key],
    DEFINITIONS.prioritizedScheduling.defaultValue
  ),
  reactCompiler: parseBoolean(import.meta.env[DEFINITIONS.reactCompiler.key], DEFINITIONS.reactCompiler.defaultValue),
  rolldownBuild: parseBoolean(import.meta.env[DEFINITIONS.rolldownBuild.key], DEFINITIONS.rolldownBuild.defaultValue),
  jankDiagnostics: parseBoolean(
    import.meta.env[DEFINITIONS.jankDiagnostics.key],
    DEFINITIONS.jankDiagnostics.defaultValue
  ),
  contentVisibility: parseBoolean(
    import.meta.env[DEFINITIONS.contentVisibility.key],
    DEFINITIONS.contentVisibility.defaultValue
  ),
  offscreenScreenshotEncoding: parseBoolean(
    import.meta.env[DEFINITIONS.offscreenScreenshotEncoding.key],
    DEFINITIONS.offscreenScreenshotEncoding.defaultValue
  ),
  utilityProcessManifest: parseBoolean(
    import.meta.env[DEFINITIONS.utilityProcessManifest.key],
    DEFINITIONS.utilityProcessManifest.defaultValue
  ),
} as const

export type FeatureFlagName = keyof typeof featureFlags

export function isFeatureEnabled(name: FeatureFlagName): boolean {
  return featureFlags[name]
}
