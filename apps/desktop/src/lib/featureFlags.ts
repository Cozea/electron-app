interface FeatureFlagDefinition {
  key: string
  defaultValue: boolean
}

const DEFINITIONS = {
  prioritizedScheduling: { key: 'VITE_FF_PRIORITIZED_SCHEDULING', defaultValue: true },
  localWorkspaceCatalog: { key: 'VITE_FF_LOCAL_WORKSPACE_CATALOG', defaultValue: true },
  projectDevApps: { key: 'VITE_FF_PROJECT_DEVAPPS', defaultValue: true },
  desktopBootstrap: { key: 'VITE_FF_DESKTOP_BOOTSTRAP', defaultValue: true },
  shellFirstAuth: { key: 'VITE_FF_SHELL_FIRST_AUTH', defaultValue: true },
  commonRoutePrewarm: { key: 'VITE_FF_COMMON_ROUTE_PREWARM', defaultValue: true },
  lazyRendererHosts: { key: 'VITE_FF_LAZY_RENDERER_HOSTS', defaultValue: true },
  /**
   * `cozea.palette.enabled` — workbench command palette + keybindings discovery.
   * Override with `VITE_FF_COZEA_PALETTE_ENABLED=0` to disable.
   */
  paletteEnabled: { key: 'VITE_FF_COZEA_PALETTE_ENABLED', defaultValue: true },
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
  prioritizedScheduling: parseBoolean(
    import.meta.env[DEFINITIONS.prioritizedScheduling.key],
    DEFINITIONS.prioritizedScheduling.defaultValue
  ),
  localWorkspaceCatalog: parseBoolean(
    import.meta.env[DEFINITIONS.localWorkspaceCatalog.key],
    DEFINITIONS.localWorkspaceCatalog.defaultValue
  ),
  projectDevApps: parseBoolean(
    import.meta.env[DEFINITIONS.projectDevApps.key],
    DEFINITIONS.projectDevApps.defaultValue
  ),
  desktopBootstrap: parseBoolean(
    import.meta.env[DEFINITIONS.desktopBootstrap.key],
    DEFINITIONS.desktopBootstrap.defaultValue
  ),
  shellFirstAuth: parseBoolean(
    import.meta.env[DEFINITIONS.shellFirstAuth.key],
    DEFINITIONS.shellFirstAuth.defaultValue
  ),
  commonRoutePrewarm: parseBoolean(
    import.meta.env[DEFINITIONS.commonRoutePrewarm.key],
    DEFINITIONS.commonRoutePrewarm.defaultValue
  ),
  lazyRendererHosts: parseBoolean(
    import.meta.env[DEFINITIONS.lazyRendererHosts.key],
    DEFINITIONS.lazyRendererHosts.defaultValue
  ),
  /** Maps to plan flag `cozea.palette.enabled` (default ON). */
  paletteEnabled: parseBoolean(
    import.meta.env[DEFINITIONS.paletteEnabled.key],
    DEFINITIONS.paletteEnabled.defaultValue
  ),
} as const
