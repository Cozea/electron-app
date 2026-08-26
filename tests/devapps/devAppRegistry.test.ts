import { describe, expect, it } from "vitest"

import {
  BUILTIN_DEV_APPS,
  getDevAppById,
  listLauncherApps,
  listStoreApps,
} from "@/features/devapps/registry"

describe("DevApps registry", () => {
  it("assigns a unique stable id to each builtin app", () => {
    const ids = BUILTIN_DEV_APPS.map((app) => app.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("provides icon, launcher, store, and launch metadata for every manifest", () => {
    for (const app of BUILTIN_DEV_APPS) {
      expect(app.icon.src.length).toBeGreaterThan(0)
      expect(app.launcher.order).toBeGreaterThan(0)
      expect(app.store.categoryLabel.length).toBeGreaterThan(0)
      expect(app.launch.tileType.length).toBeGreaterThan(0)
    }
  })

  it("lists launcher apps in deterministic order and filters assistant providers", () => {
    expect(listLauncherApps().map((app) => app.id)).toEqual([
      "browser",
      "dev-server",
      "terminal",
      "mobile-simulator",
      "codex",
      "claude",
      "cursor",
      "opencode",
    ])

    expect(
      listLauncherApps({
        enabledAssistantProviders: ["codex", "cursor"],
      }).map((app) => app.id),
    ).toEqual([
      "browser",
      "dev-server",
      "terminal",
      "mobile-simulator",
      "codex",
      "cursor",
    ])
  })

  it("filters store apps by category and query", () => {
    expect(listStoreApps({ category: "preview-tools" }).map((app) => app.id)).toEqual([
      "browser",
      "dev-server",
      "mobile-simulator",
    ])

    expect(listStoreApps({ query: "anthropic" }).map((app) => app.id)).toEqual(["claude"])
  })

  it("merges access-filtered project apps into the launcher without mutating builtins", () => {
    const projectApp = {
      ...BUILTIN_DEV_APPS[1],
      id: "project-devapp:publication_1",
      name: "Inventory Console",
      launcher: {
        ...BUILTIN_DEV_APPS[1].launcher,
        order: 1,
      },
    }

    expect(listLauncherApps({ additionalApps: [projectApp] }).map((app) => app.id)).toContain(
      projectApp.id,
    )
    expect(BUILTIN_DEV_APPS.map((app) => app.id)).not.toContain(projectApp.id)
  })

  it("looks up manifests by stable id", () => {
    expect(getDevAppById("terminal")?.name).toBe("Terminal")
    expect(getDevAppById("unknown")).toBeUndefined()
  })
})
