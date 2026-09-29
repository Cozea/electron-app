import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DESTINATION_ROUTE_TEMPLATES,
  destinationHref,
  settingsDestinationForRoute,
  settingsPath,
} from "@/lib/destinations"
import { SETTINGS_SURFACES } from "@/lib/settings/settingsRegistry"

const REPO = process.cwd()
const ROUTES = fs.readFileSync(path.join(REPO, "apps/desktop/src/router/routes.tsx"), "utf8")

/** Full paths of every route in routes.tsx, rebuilt from parent + path. */
function registeredRoutePaths(): Set<string> {
  const constants = new Map<string, string>()
  for (const [, name, value] of ROUTES.matchAll(/const (\w+) = "([^"]+)";/g)) constants.set(name, value)

  const routes = new Map<string, { parent: string; path: string }>()
  for (const [, name, body] of ROUTES.matchAll(/const (\w+) = createRoute\(\{([\s\S]*?)\n\}\);/g)) {
    const parent = body.match(/getParentRoute: \(\) => (\w+)/)?.[1] ?? "rootRoute"
    const literal = body.match(/path: "([^"]*)"/)?.[1]
    const fromConstant = body.match(/path: toRoutePath\((\w+)\)/)?.[1]
    const routePath = literal ?? constants.get(fromConstant ?? "")?.replace(/^\//, "") ?? ""
    routes.set(name, { parent, path: routePath })
  }

  const fullPath = (name: string): string => {
    const route = routes.get(name)
    if (!route) return ""
    const parent = fullPath(route.parent)
    if (route.path === "/") return `${parent}/`
    return `${parent}/${route.path.replace(/^\//, "")}`.replace(/\/+/g, "/")
  }
  return new Set([...routes.keys()].map(fullPath))
}

describe("destinations", () => {
  const paths = registeredRoutePaths()

  it("resolve to routes that exist", () => {
    for (const [destination, template] of Object.entries(DESTINATION_ROUTE_TEMPLATES)) {
      if (destination === "settings") continue
      expect(paths, `${destination} → ${template}`).toContain(template)
    }
  })

  it("cover every settings section with a real page", () => {
    for (const surface of SETTINGS_SURFACES) {
      if (!surface.routes.personal) continue
      expect(paths, surface.id).toContain(settingsPath(surface.id))
    }
  })

  it("keep only the join links as legacy redirects", () => {
    expect(ROUTES).not.toMatch(/function Project\w*Redirect\(/)
    expect(ROUTES).toMatch(/function LegacyProjectJoinRedirect\(/)
    expect(ROUTES).toContain("defaultNotFoundComponent")
  })

  it("build the URLs routes expect", () => {
    expect(destinationHref({ to: "workbench", projectId: "p1" })).toBe("/projects/p/p1/workbench")
    expect(destinationHref({ to: "workbench", projectId: "p1", changes: true, laneId: "collab" })).toBe(
      "/projects/p/p1/workbench?lane=collab&changes=1",
    )
    expect(destinationHref({ to: "projectSettings", projectId: "p1" })).toBe("/projects/p/p1/settings")
    expect(destinationHref({ to: "projectSettings", projectId: "p1", section: "danger" })).toBe(
      "/projects/p/p1/settings?section=danger",
    )
    expect(destinationHref({ to: "skills", view: "schedules", search: { draft: "x y" } })).toBe(
      "/projects/skills?draft=x+y&view=schedules",
    )
    expect(destinationHref({ to: "settings", section: "computerUse" })).toBe("/projects/settings/computer-use")
    expect(destinationHref({ to: "settings", section: "organizations", search: { tab: "devApps" } })).toBe(
      "/projects/settings/organizations?tab=devApps",
    )
  })

  it("read settings routes sent by the main process", () => {
    expect(settingsDestinationForRoute("/settings/tooling")).toEqual({ to: "settings", section: "tooling" })
    expect(settingsDestinationForRoute("settings/organizations?tab=devApps")).toEqual({
      to: "settings",
      section: "organizations",
      search: { tab: "devApps" },
    })
    expect(settingsDestinationForRoute("github")).toEqual({ to: "settings", section: "github" })
    expect(settingsDestinationForRoute(undefined)).toEqual({ to: "settings", section: "account" })
  })
})

describe("navigation call sites", () => {
  it("navigate through destinations, not hand-built paths", () => {
    let hits = ""
    try {
      hits = execFileSync(
        "git",
        ["grep", "-n", "-E", "navigate\\(\\s*[`'\"]/|navigate\\(\\s*buildProjectPath", "--", "apps/desktop/src"],
        { cwd: REPO, encoding: "utf8" },
      )
    } catch {
      // git grep exits 1 when nothing matches, which is the passing case.
    }
    expect(hits).toBe("")
  })
})
