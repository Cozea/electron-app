import type { ProviderKind } from "@cozea/assistant-contracts"

import { browserDevAppManifest } from "@/features/devapps/apps/browser/manifest"
import { claudeDevAppManifest } from "@/features/devapps/apps/claude/manifest"
import { codexDevAppManifest } from "@/features/devapps/apps/codex/manifest"
import { cursorDevAppManifest } from "@/features/devapps/apps/cursor/manifest"
import { devServerDevAppManifest } from "@/features/devapps/apps/dev-server/manifest"
import { mobileSimulatorDevAppManifest } from "@/features/devapps/apps/mobile-simulator/manifest"
import { openCodeDevAppManifest } from "@/features/devapps/apps/opencode/manifest"
import { terminalDevAppManifest } from "@/features/devapps/apps/terminal/manifest"
import type {
  DevAppCategoryId,
  DevAppLauncherGroup,
  DevAppManifest,
} from "@/features/devapps/registry/types"

export interface ListLauncherAppsOptions {
  enabledAssistantProviders?: ReadonlyArray<ProviderKind> | null
  group?: DevAppLauncherGroup
  query?: string
}

export interface ListStoreAppsOptions {
  category?: DevAppCategoryId
  query?: string
}

export const BUILTIN_DEV_APPS: ReadonlyArray<DevAppManifest> = [
  browserDevAppManifest,
  devServerDevAppManifest,
  terminalDevAppManifest,
  mobileSimulatorDevAppManifest,
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

export function listLauncherApps(options: ListLauncherAppsOptions = {}): DevAppManifest[] {
  const enabledAssistantProviders =
    options.enabledAssistantProviders && options.enabledAssistantProviders.length > 0
      ? new Set(options.enabledAssistantProviders)
      : null

  return BUILTIN_DEV_APPS
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
