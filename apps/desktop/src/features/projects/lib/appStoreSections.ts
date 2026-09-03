import {
  activeInstallationsByPublication,
  isOrgDevAppUpdateAvailable,
} from "@/features/devapps/orgDevAppInstallationCatalog"
import {
  buildInstalledDevAppManifest,
  buildPublishedDevAppManifest,
  type OrgDevAppConsumerRecord,
} from "@/features/devapps/orgDevAppManifest"
import type { DevAppManifest } from "@/features/devapps/registry/types"
import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"

export const APP_STORE_SCOPES = ["builtin", "organization"] as const
export type AppStoreScope = (typeof APP_STORE_SCOPES)[number]

export type AppStoreSectionId = "popular" | "assistants" | "updates" | "all" | "results"

export type AppStoreInstallState = "install" | "update" | "installed"

export interface AppStoreBuiltinItem {
  kind: "builtin"
  key: string
  app: DevAppManifest
}

/**
 * Generic in the record so a caller passing rows straight from Convex keeps
 * its branded `Id<…>` types through to the install handlers.
 */
export interface AppStoreOrgItem<TEntry extends OrgDevAppConsumerRecord = OrgDevAppConsumerRecord> {
  kind: "org"
  key: string
  app: DevAppManifest
  entry: TEntry
  installState: AppStoreInstallState
  installedVersion: number | null
}

export type AppStoreItem<TEntry extends OrgDevAppConsumerRecord = OrgDevAppConsumerRecord> =
  | AppStoreBuiltinItem
  | AppStoreOrgItem<TEntry>

export interface AppStoreSection<TEntry extends OrgDevAppConsumerRecord = OrgDevAppConsumerRecord> {
  id: AppStoreSectionId
  items: AppStoreItem<TEntry>[]
}

export interface InstalledRailEntry {
  kind: "builtin" | "org"
  key: string
  name: string
  app: DevAppManifest
  scope: AppStoreScope
}

export interface BuildAppStoreSectionsInput<
  TEntry extends OrgDevAppConsumerRecord = OrgDevAppConsumerRecord,
> {
  scope: AppStoreScope
  query: string
  /** Already filtered by `listStoreApps({ query })`, so the registry owns built-in matching. */
  builtinApps: ReadonlyArray<DevAppManifest>
  /** `undefined` while the Convex query is in flight or skipped entirely. */
  orgApps: ReadonlyArray<TEntry> | undefined
  installations: ReadonlyArray<OrgDevAppInstallation>
}

/**
 * Reads `?scope=`. Anything unrecognised — including a legacy `?category=…`
 * link from the old storefront — lands on the built-in catalog.
 */
export function resolveAppStoreScope(value: string | null | undefined): AppStoreScope {
  return APP_STORE_SCOPES.find((scope) => scope === value) ?? "builtin"
}

/**
 * The registry's `matchesQuery` only understands manifests. Organization
 * releases carry catalog facts a user would reasonably search for — the
 * publishing org, the framework, and the version — so they match here too.
 */
export function matchesOrgDevAppQuery(entry: OrgDevAppConsumerRecord, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return [
    entry.name,
    entry.description ?? "",
    entry.organizationName,
    entry.activeRelease.framework,
    `v${entry.activeRelease.version}`,
  ].some((value) => value.toLowerCase().includes(normalized))
}

export function resolveOrgInstallState(
  installations: ReadonlyArray<OrgDevAppInstallation>,
  entry: OrgDevAppConsumerRecord,
): { state: AppStoreInstallState; installedVersion: number | null } {
  const installed = activeInstallationsByPublication(installations).get(entry.publicationId)
  if (!installed) {
    return { state: "install", installedVersion: null }
  }

  const state = isOrgDevAppUpdateAvailable(
    installations,
    entry.publicationId,
    entry.activeRelease.version,
  )
    ? "update"
    : "installed"

  return { state, installedVersion: installed.activeRelease.version }
}

function toOrgItem<TEntry extends OrgDevAppConsumerRecord>(
  entry: TEntry,
  installations: ReadonlyArray<OrgDevAppInstallation>,
): AppStoreOrgItem<TEntry> {
  const { state, installedVersion } = resolveOrgInstallState(installations, entry)
  return {
    kind: "org",
    key: entry.publicationId,
    app: buildPublishedDevAppManifest(entry),
    entry,
    installState: state,
    installedVersion,
  }
}

function toBuiltinItem(app: DevAppManifest): AppStoreBuiltinItem {
  return { kind: "builtin", key: app.id, app }
}

function section<TEntry extends OrgDevAppConsumerRecord>(
  id: AppStoreSectionId,
  items: AppStoreItem<TEntry>[],
): AppStoreSection<TEntry>[] {
  return items.length > 0 ? [{ id, items }] : []
}

function visibleOrgApps<TEntry extends OrgDevAppConsumerRecord>(
  input: Pick<BuildAppStoreSectionsInput<TEntry>, "orgApps" | "query">,
): TEntry[] {
  return (input.orgApps ?? []).filter((entry) => matchesOrgDevAppQuery(entry, input.query))
}

/**
 * A query collapses the active scope into one flat result list — section
 * headers over one or two matches carry no information.
 */
export function buildAppStoreSections<TEntry extends OrgDevAppConsumerRecord>(
  input: BuildAppStoreSectionsInput<TEntry>,
): AppStoreSection<TEntry>[] {
  const searching = Boolean(input.query.trim())

  if (input.scope === "organization") {
    const items = visibleOrgApps(input).map((entry) => toOrgItem(entry, input.installations))
    if (searching) {
      return section("results", items)
    }
    return [
      ...section(
        "updates",
        items.filter((item) => item.installState === "update"),
      ),
      ...section(
        "all",
        items.filter((item) => item.installState !== "update"),
      ),
    ]
  }

  const items = input.builtinApps.map(toBuiltinItem)
  if (searching) {
    return section<TEntry>("results", items)
  }

  // `store.featured` is true on every built-in and read by nothing, so the
  // split uses `launcher.group` — a real, maintained field that keeps sorting
  // itself when a new manifest lands.
  return [
    ...section<TEntry>(
      "popular",
      items.filter((item) => item.app.launcher.group === "Development"),
    ),
    ...section<TEntry>(
      "assistants",
      items.filter((item) => item.app.launcher.group === "Assistant"),
    ),
  ]
}

/** Match counts for both scopes, so the inactive tab can show what it is hiding. */
export function countAppStoreMatches<TEntry extends OrgDevAppConsumerRecord>(
  input: Omit<BuildAppStoreSectionsInput<TEntry>, "scope">,
): Record<AppStoreScope, number> {
  return {
    builtin: input.builtinApps.length,
    organization: visibleOrgApps(input).length,
  }
}

/**
 * Built-ins first — they ship with the app and are always present — then one
 * entry per publication that has an active install on this device, most
 * recently used first.
 */
export function buildInstalledRail(
  builtinApps: ReadonlyArray<DevAppManifest>,
  installations: ReadonlyArray<OrgDevAppInstallation>,
): InstalledRailEntry[] {
  const builtins: InstalledRailEntry[] = builtinApps.map((app) => ({
    kind: "builtin",
    key: app.id,
    name: app.name,
    app,
    scope: "builtin",
  }))

  const installed: InstalledRailEntry[] = [...activeInstallationsByPublication(installations).values()]
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt)
    .map((installation) => ({
      kind: "org",
      key: installation.publicationId,
      name: installation.name,
      app: buildInstalledDevAppManifest(installation),
      scope: "organization",
    }))

  return [...builtins, ...installed]
}
