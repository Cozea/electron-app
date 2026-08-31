import { describe, expect, it } from "vitest"

import { BUILTIN_DEV_APPS } from "@/features/devapps/registry"
import {
  derivableSurfaces,
  partsForLaunchSpec,
  type DevAppParts,
} from "@/features/devapps/registry/parts"
import { partsForPublishedRuntimeKind } from "@shared/devAppParts"
import type { DevAppLaunchSpec } from "@/features/devapps/registry/types"

const PUBLISHED_STATIC: DevAppLaunchSpec = {
  kind: "publishedDevApp",
  tileType: "orgDevApp",
  publicationId: "pub_1",
  organizationId: "org_1",
  organizationName: "Cozea",
  releaseId: "rel_1",
  releaseVersion: 1,
  name: "Docs",
  framework: "vite-react",
  contentHash: "a".repeat(64),
  entryPath: "index.html",
  runtimeKind: "static",
}

describe("DevApp parts — expressing what ships today", () => {
  // The point of the decomposition: if a real DevApp cannot be described as parts, the
  // model is wrong, and this is where that must surface.
  it("expresses every built-in as a composition of parts", () => {
    for (const manifest of BUILTIN_DEV_APPS) {
      const parts = manifest.parts
      expect(parts, `${manifest.id} produced no parts`).toBeTruthy()
      expect(
        Boolean(parts.view || parts.worker || parts.service),
        `${manifest.id} produced an empty composition`,
      ).toBe(true)
      expect(parts, `${manifest.id} drifted from its compatibility launch spec`).toEqual(
        partsForLaunchSpec(manifest.launch),
      )
    }
  })

  it("gives every built-in a tile surface, since each one renders", () => {
    for (const manifest of BUILTIN_DEV_APPS) {
      const surfaces = derivableSurfaces(manifest.parts)
      expect(surfaces, `${manifest.id} lost its tile surface`).toContain("tile")
    }
  })

  it("marks native views as native and package views as package", () => {
    const browser = BUILTIN_DEV_APPS.find((app) => app.id === "browser")!
    expect(browser.parts.view).toEqual({ source: "native", rendererId: "browser" })
    expect(partsForPublishedRuntimeKind("static").view).toEqual({ source: "package" })
  })

  it("splits a terminal into unprivileged chrome over a privileged worker", () => {
    const terminal = BUILTIN_DEV_APPS.find((app) => app.id === "terminal")!
    const parts = terminal.parts
    expect(parts.view?.source).toBe("native")
    expect(parts.worker?.capabilities).toContain("terminal.spawn")
    // The view itself must never hold capability — that is the whole boundary.
    expect(parts.view).not.toHaveProperty("capabilities")
  })
})

describe("DevApp parts — published releases", () => {
  it("maps a static release to a view with no running process", () => {
    const parts = partsForPublishedRuntimeKind("static")
    expect(parts).toEqual({ view: { source: "package" } })
    expect(parts.service).toBeUndefined()
  })

  it("maps a service release to a view plus an unprivileged service", () => {
    const parts = partsForPublishedRuntimeKind("service")
    expect(parts.view).toEqual({ source: "package" })
    expect(parts.service).toEqual({ runtimeKind: "node", location: "device" })
    // A published service holds no capabilities; that is what separates it from a worker.
    expect(parts.worker).toBeUndefined()
  })

  it("preserves the singleton constraint the Dev Server depends on", () => {
    const devServer = BUILTIN_DEV_APPS.find((app) => app.id === "dev-server")!
    expect(devServer.parts.service?.singleton).toBe(true)
  })

  it("refuses to reconstruct published parts from the launch adapter", () => {
    expect(() => partsForLaunchSpec(PUBLISHED_STATIC)).toThrow(
      "Published DevApp parts must come from the immutable release record",
    )
  })
})

describe("DevApp surfaces — derived, never declared", () => {
  it("offers no agent surface to a view-only app", () => {
    // Browser and Dev Server tiles are view-first, so there is nothing callable to
    // expose. That is the correct outcome rather than a gap to paper over.
    expect(derivableSurfaces({ view: { source: "package" } })).toEqual(["tile"])
  })

  it("offers an agent surface only when a worker exposes tools", () => {
    const silent: DevAppParts = { worker: { capabilities: ["git.read"] } }
    const speaking: DevAppParts = { worker: { capabilities: ["git.read"], exposesTools: true } }
    expect(derivableSurfaces(silent)).not.toContain("agentTool")
    expect(derivableSurfaces(speaking)).toContain("agentTool")
  })

  it("offers a background surface to anything with a long-lived process", () => {
    expect(derivableSurfaces({ service: { runtimeKind: "node", location: "device" } }))
      .toContain("backgroundService")
    expect(derivableSurfaces({ worker: { capabilities: [] } })).toContain("backgroundService")
  })

  it("offers no background surface to a static service, which is only files", () => {
    expect(derivableSurfaces({ view: { source: "package" }, service: { runtimeKind: "static", location: "device" } }))
      .toEqual(["tile"])
  })

  it("supports a headless worker with no tile at all", () => {
    // The shape today's closed union cannot express: an app with no view.
    expect(derivableSurfaces({ worker: { capabilities: ["git.read"], exposesTools: true } }))
      .toEqual(["agentTool", "backgroundService"])
  })
})

describe("Registry surface resolution", () => {
  it("lists every built-in on the tile surface", async () => {
    const { listAppsForSurface } = await import("@/features/devapps/registry")
    expect(listAppsForSurface("tile")).toHaveLength(BUILTIN_DEV_APPS.length)
  })

  it("lists no built-in on the agent surface yet", async () => {
    // Nothing shipping declares tools, so the agent surface is correctly empty rather
    // than being populated by apps that have nothing callable to expose.
    const { listAppsForSurface } = await import("@/features/devapps/registry")
    expect(listAppsForSurface("agentTool")).toEqual([])
  })

  it("lists only the apps that keep a process on the background surface", async () => {
    const { listAppsForSurface } = await import("@/features/devapps/registry")
    const ids = listAppsForSurface("backgroundService").map((app) => app.id)
    expect(ids).toContain("dev-server")
    expect(ids).toContain("terminal")
    // A browser tile holds nothing that outlives it.
    expect(ids).not.toContain("browser")
  })
})

describe("Packages resolve through the same parts model as installed apps", () => {
  const parsePackage = async (value: unknown) => {
    const { parseDevAppPackage } = await import("@shared/devAppPackage")
    const result = parseDevAppPackage(JSON.stringify(value))
    expect(result.manifest).not.toBeNull()
    return result.manifest!
  }

  it("gives a view-only package exactly the tile surface", async () => {
    const { partsForPackage } = await import("@/features/devapps/registry/parts")
    const parts = partsForPackage(
      await parsePackage({ manifestVersion: 1, name: "A", view: { entry: "index.html" } }),
    )
    expect(parts).toEqual({ view: { source: "package" } })
    expect(derivableSurfaces(parts)).toEqual(["tile"])
  })

  it("never lets an authored package claim a native view", async () => {
    // `native` means a component compiled into Cozea. A package that could claim it
    // would be asking to be rendered as first-party chrome.
    const { partsForPackage } = await import("@/features/devapps/registry/parts")
    const parts = partsForPackage(
      await parsePackage({
        manifestVersion: 1,
        name: "A",
        // `source` is not a manifest field. The point is that writing it changes nothing.
        view: { entry: "index.html", source: "native" },
      }),
    )
    expect(parts.view?.source).toBe("package")
  })

  it("derives the agent surface from the package's own exposesTools", async () => {
    const { partsForPackage } = await import("@/features/devapps/registry/parts")
    const speaking = partsForPackage(
      await parsePackage({
        manifestVersion: 1,
        name: "A",
        worker: { entry: "w.js", capabilities: ["project.read"], exposesTools: true },
      }),
    )
    expect(derivableSurfaces(speaking)).toEqual(["agentTool", "backgroundService"])
  })

  it("carries a package's capabilities through unchanged", async () => {
    const { partsForPackage } = await import("@/features/devapps/registry/parts")
    const parts = partsForPackage(
      await parsePackage({
        manifestVersion: 1,
        name: "A",
        worker: { entry: "w.js", capabilities: ["project.read", "git.read"] },
      }),
    )
    expect(parts.worker?.capabilities).toEqual(["project.read", "git.read"])
    expect(parts.worker?.protocolVersion).toBe(1)
  })

  it("gives a static-service package no background surface, matching a published one", async () => {
    const { partsForPackage } = await import("@/features/devapps/registry/parts")
    const parts = partsForPackage(
      await parsePackage({
        manifestVersion: 1,
        name: "A",
        view: { entry: "index.html" },
        service: { runtimeKind: "static" },
      }),
    )
    expect(derivableSurfaces(parts)).toEqual(["tile"])
    expect(derivableSurfaces(partsForPublishedRuntimeKind("static"))).toEqual(["tile"])
  })
})
