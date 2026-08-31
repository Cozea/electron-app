import type { ProviderKind } from "@cozea/assistant-contracts"

import { browserDevAppManifest } from "@/features/devapps/apps/browser/manifest"
import { claudeDevAppManifest } from "@/features/devapps/apps/claude/manifest"
import { codexDevAppManifest } from "@/features/devapps/apps/codex/manifest"
import { cursorDevAppManifest } from "@/features/devapps/apps/cursor/manifest"
import { devServerDevAppManifest } from "@/features/devapps/apps/dev-server/manifest"
import { llamaDevAppManifest } from "@/features/devapps/apps/llama/manifest"
import { mobileSimulatorDevAppManifest } from "@/features/devapps/apps/mobile-simulator/manifest"
import { openCodeDevAppManifest } from "@/features/devapps/apps/opencode/manifest"
import { terminalDevAppManifest } from "@/features/devapps/apps/terminal/manifest"
import type {
  DevAppCategoryId,
  DevAppLauncherGroup,
  DevAppManifest,
} from "@/features/devapps/registry/types"
import {
  derivableSurfaces,
  partsForLaunchSpec,
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

const DEV_APP_ID_BY_ASSISTANT_PROVIDER: Partial<Record<ProviderKind, string>> = {
  codex: "codex",
  claudeAgent: "claude",
  cursor: "cursor",
  opencode: "opencode",
}

const DEV_APP_ID_BY_SURFACE_TILE_TYPE = {
  browser: "browser",
  devServer: "dev-server",
  llama: "llama",
  mobileSimulator: "mobile-simulator",
  terminal: "terminal",
} as const

export const BUILTIN_DEV_APPS: ReadonlyArray<DevAppManifest> = [
  browserDevAppManifest,
  devServerDevAppManifest,
  terminalDevAppManifest,
  mobileSimulatorDevAppManifest,
  llamaDevAppManifest,
  codexDevAppManifest,
  claudeDevAppManifest,
  cursorDevAppManifest,
  openCodeDevAppManifest,
]

function sortDevApps(a: DevAppManifest, b: DevAppManifest): number {
  if (a.launcher.order !== b.launcher.order) {
    return a.launcher.order - b.launcher.order
  }
  return a.id.localeCompare(b.id)
}

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
  const appId = DEV_APP_ID_BY_ASSISTANT_PROVIDER[provider]
  return appId ? (getDevAppById(appId) ?? null) : null
}

export function getDevAppForSurfaceTileType(
  tileType: keyof typeof DEV_APP_ID_BY_SURFACE_TILE_TYPE | null | undefined,
): DevAppManifest | null {
  if (!tileType) return null
  return getDevAppById(DEV_APP_ID_BY_SURFACE_TILE_TYPE[tileType]) ?? null
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
    .filter((manifest) => !options.category || options.category === "discover" || manifest.categories.includes(options.category))
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
  return derivableSurfaces(partsForLaunchSpec(manifest.launch))
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
