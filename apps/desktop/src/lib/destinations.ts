/**
 * Every screen the app can navigate to, as data. Navigation used to be URL
 * strings assembled at each call site, so a moved route broke silently and
 * old paths lived on as redirects. Callers now describe where they are going
 * and `destinationHref` is the only place that knows the URL shape.
 *
 * DESTINATION_ROUTE_TEMPLATES lists the route each destination resolves to;
 * tests/navigation/destinations.test.ts checks every template against the
 * registered route tree, so a route change that orphans a destination fails
 * the build instead of shipping a blank page.
 */
import { getSettingsSurfaceRoute, resolveSettingsSurfaceFromRoute } from "@/lib/settings/settingsRegistry"
import type { SettingsSurfaceId } from "@/lib/settings/settingsSurfaceTypes"

export type ProjectSettingsSection = "general" | "danger"
export type SkillsView = "builds" | "schedules"

export type Destination =
  | { to: "projects" }
  | { to: "store" }
  | { to: "skills"; view?: SkillsView; search?: Record<string, string> }
  | { to: "inbox" }
  | { to: "newProject"; search?: Record<string, string> }
  | { to: "settings"; section: SettingsSurfaceId; search?: Record<string, string> }
  | {
      to: "workbench"
      projectId: string
      laneId?: string | null
      openTile?: "assistantChat" | "terminal"
      focusTileId?: string | null
      /** Opens the Changes panel over the workbench. */
      changes?: boolean
    }
  | { to: "tasks"; projectId: string }
  | { to: "team"; projectId: string }
  | { to: "projectSettings"; projectId: string; section?: ProjectSettingsSection }
  | { to: "join"; token: string }

export const DESTINATION_ROUTE_TEMPLATES = {
  projects: "/projects/",
  store: "/projects/store",
  skills: "/projects/skills",
  inbox: "/projects/inbox",
  newProject: "/projects/new",
  settings: "/projects/settings/*",
  workbench: "/projects/p/$projectId/workbench",
  tasks: "/projects/p/$projectId/tasks",
  team: "/projects/p/$projectId/team",
  projectSettings: "/projects/p/$projectId/settings",
  join: "/projects/join/$token",
} as const satisfies Record<Destination["to"], string>

function withSearch(path: string, search: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined && value !== "") params.set(key, value)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

function project(projectId: string, page: string): string {
  return `/projects/p/${encodeURIComponent(projectId)}/${page}`
}

export function settingsPath(section: SettingsSurfaceId): string {
  const route = getSettingsSurfaceRoute(section, "personal") ?? "/settings/account"
  return `/projects${route}`
}

export function destinationHref(destination: Destination): string {
  switch (destination.to) {
    case "projects":
      return "/projects"
    case "store":
      return "/projects/store"
    case "skills":
      return withSearch("/projects/skills", { ...destination.search, view: destination.view })
    case "inbox":
      return "/projects/inbox"
    case "newProject":
      return withSearch("/projects/new", destination.search ?? {})
    case "settings":
      return withSearch(settingsPath(destination.section), destination.search ?? {})
    case "workbench":
      return withSearch(project(destination.projectId, "workbench"), {
        lane: destination.laneId ?? undefined,
        openTile: destination.openTile,
        focusTile: destination.focusTileId ?? undefined,
        changes: destination.changes ? "1" : undefined,
      })
    case "tasks":
      return project(destination.projectId, "tasks")
    case "team":
      return project(destination.projectId, "team")
    case "projectSettings":
      return withSearch(project(destination.projectId, "settings"), {
        section: destination.section && destination.section !== "general" ? destination.section : undefined,
      })
    case "join":
      return `/projects/join/${encodeURIComponent(destination.token)}`
  }
}

/**
 * A settings route as the main process sends it (the macOS Settings… menu,
 * `window:openSettings`): "/settings/tooling", "settings/organizations?tab=x"
 * or a bare surface id. Unknown routes open Device Identity.
 */
export function settingsDestinationForRoute(route: string | null | undefined): Destination {
  const raw = (route ?? "").trim()
  const [pathPart = "", query = ""] = raw.split("?", 2)
  const bare = pathPart.replace(/^\/+/, "")
  const path = bare.startsWith("settings/") || bare === "settings" ? `/${bare}` : `/settings/${bare}`
  const resolved = resolveSettingsSurfaceFromRoute(path, { scopeKind: "personal" })
  const search = Object.fromEntries(new URLSearchParams(query))
  return {
    to: "settings",
    section: resolved?.surface.id ?? "account",
    ...(Object.keys(search).length > 0 ? { search } : {}),
  }
}
