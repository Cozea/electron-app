import type { ProviderKind } from "@cozea/assistant-contracts"

import type {
  DevAppCategoryId,
  DevAppLauncherGroup,
  DevAppManifest,
  DevAppWorkbenchTileTarget,
} from "@/features/devapps/registry/types"
import {
  derivableSurfaces,
  type DevAppSurface,
} from "@/features/devapps/registry/parts"

export interface ListLauncherAppsOptions {
  additionalApps?: ReadonlyArray<DevAppManifest>
  enabledAssistantProviders?: ReadonlyArray<ProviderKind> | null
  group?: DevAppLauncherGroup
  query?: string
}

export interface ListStoreAppsOptions {
  category?: DevAppCategoryId
  query?: string
}

function sortDevApps(a: DevAppManifest, b: DevAppManifest): number {
  if (a.launcher.order !== b.launcher.order) {
    return a.launcher.order - b.launcher.order
  }
  return a.id.localeCompare(b.id)
}

const BUILTIN_DEV_APP_MODULES = import.meta.glob<{ default: DevAppManifest }>(
  "../apps/*/manifest.ts",
  { eager: true },
)

/**
 * Every built-in is a self-contained manifest module. Adding one means adding that one
 * module; the registry, launcher, Store, provider lookup, and surface lookup discover it.
 */
function loadBuiltinDevApps(
  modules: Record<string, { default: DevAppManifest }>,
): ReadonlyArray<DevAppManifest> {
  const manifests = Object.entries(modules).map(([modulePath, module]) => {
    if (!module.default) {
      throw new Error(`Built-in DevApp module ${modulePath} has no default manifest export.`)
    }
    return module.default
  })
  const ids = new Set<string>()
  const assistantProviders = new Set<ProviderKind>()
  const surfaceTileTypes = new Set<DevAppWorkbenchTileTarget>()
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) {
      throw new Error(`Built-in DevApp id ${manifest.id} is registered more than once.`)
    }
    ids.add(manifest.id)

    if (manifest.launch.kind === "assistantChat") {
      if (assistantProviders.has(manifest.launch.provider)) {
        throw new Error(
          `Assistant provider ${manifest.launch.provider} is registered by more than one built-in DevApp.`,
        )
      }
      assistantProviders.add(manifest.launch.provider)
      continue
    }

    if (surfaceTileTypes.has(manifest.launch.tileType)) {
      throw new Error(
        `Surface tile type ${manifest.launch.tileType} is registered by more than one built-in DevApp.`,
      )
    }
    surfaceTileTypes.add(manifest.launch.tileType)
  }
  return manifests.sort(sortDevApps)
}

export const BUILTIN_DEV_APPS = loadBuiltinDevApps(BUILTIN_DEV_APP_MODULES)

function matchesQuery(manifest: DevAppManifest, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  const searchableValues = [
    manifest.id,
    manifest.name,
    manifest.description,
    manifest.launcher.group,
    manifest.store.categoryLabel,
    ...(manifest.launcher.searchTerms ?? []),
    manifest.launch.kind === "assistantChat" ? manifest.launch.provider : null,
  ]

  return searchableValues
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => value.toLowerCase().includes(normalizedQuery))
}

export function getDevAppById(appId: string): DevAppManifest | undefined {
  return BUILTIN_DEV_APPS.find((manifest) => manifest.id === appId)
}

export function getDevAppForAssistantProvider(
  provider: ProviderKind | null | undefined,
): DevAppManifest | null {
  if (!provider) return null
  return (
    BUILTIN_DEV_APPS.find(
      (manifest) =>
        manifest.launch.kind === "assistantChat" && manifest.launch.provider === provider,
    ) ?? null
  )
}

export function getDevAppForSurfaceTileType(
  tileType: DevAppWorkbenchTileTarget | null | undefined,
): DevAppManifest | null {
  if (!tileType) return null
  return (
    BUILTIN_DEV_APPS.find(
      (manifest) =>
        manifest.launch.tileType === tileType && manifest.launch.kind !== "assistantChat",
    ) ?? null
  )
}

export function listLauncherApps(options: ListLauncherAppsOptions = {}): DevAppManifest[] {
  const enabledAssistantProviders =
    options.enabledAssistantProviders && options.enabledAssistantProviders.length > 0
      ? new Set(options.enabledAssistantProviders)
      : null

  return [...(options.additionalApps ?? []), ...BUILTIN_DEV_APPS]
    .filter((manifest) => manifest.launcher.enabled)
    .filter((manifest) => !options.group || manifest.launcher.group === options.group)
    .filter((manifest) => {
      if (!enabledAssistantProviders || manifest.launch.kind !== "assistantChat") {
        return true
      }
      return enabledAssistantProviders.has(manifest.launch.provider)
    })
    .filter((manifest) => matchesQuery(manifest, options.query ?? ""))
    .slice()
    .sort(sortDevApps)
}

export function listStoreApps(options: ListStoreAppsOptions = {}): DevAppManifest[] {
  return BUILTIN_DEV_APPS
    .filter(
      (manifest) =>
        !options.category ||
        options.category === "discover" ||
        manifest.categories.includes(options.category),
    )
    .filter((manifest) => matchesQuery(manifest, options.query ?? ""))
    .slice()
    .sort(sortDevApps)
}

/**
 * Which surfaces a DevApp may occupy, derived from its parts rather than declared.
 *
 * Nothing writes "I am a tile app" — an app describes what it is made of, and where it
 * can appear follows. Adding a fourth surface later is a change to `derivableSurfaces`
 * alone, not an edit to every manifest and every release already published.
 */
export function surfacesForDevApp(manifest: DevAppManifest): DevAppSurface[] {
  return derivableSurfaces(manifest.parts)
}

export function devAppOccupiesSurface(manifest: DevAppManifest, surface: DevAppSurface): boolean {
  return surfacesForDevApp(manifest).includes(surface)
}

/** Lists the apps that can appear on a given surface. */
export function listAppsForSurface(
  surface: DevAppSurface,
  options: { additionalApps?: ReadonlyArray<DevAppManifest> } = {},
): DevAppManifest[] {
  return [...(options.additionalApps ?? []), ...BUILTIN_DEV_APPS]
    .filter((manifest) => devAppOccupiesSurface(manifest, surface))
    .slice()
    .sort(sortDevApps)
}
