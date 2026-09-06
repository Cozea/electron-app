import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { ALL_DEV_APP_CAPABILITIES } from "@shared/devAppCapabilities"
import { partsForPublishedRuntimeKind } from "@shared/devAppParts"

const root = process.cwd()
const schema = fs.readFileSync(path.join(root, "convex/schema/base.ts"), "utf8")
const devApps = fs.readFileSync(path.join(root, "convex/devApps.ts"), "utf8")
const publishedManifest = fs.readFileSync(
  path.join(root, "apps/desktop/src/features/devapps/orgDevAppManifest.ts"),
  "utf8",
)
const releaseTable = schema.slice(
  schema.indexOf("devAppReleases: defineTable"),
  schema.indexOf("devAppArtifactUploads: defineTable"),
)

describe("immutable DevApp release parts", () => {
  it("stores the complete shared capability vocabulary", () => {
    for (const capability of ALL_DEV_APP_CAPABILITIES) {
      expect(schema).toContain(`v.literal("${capability}")`)
    }
  })

  it("requires artifact identity, runtime kind, and parts with no recipe fallback", () => {
    expect(releaseTable).toContain('artifactStorageId: v.id("_storage")')
    expect(releaseTable).toContain("entryPath: v.string()")
    expect(releaseTable).toContain("contentHash: v.string()")
    expect(releaseTable).toContain("parts: devAppPartsValidator")
    expect(releaseTable).not.toContain("devCommand")
    expect(releaseTable).not.toContain("devPort")
    expect(releaseTable).not.toContain("sourceRevision")
    expect(releaseTable).not.toContain("sourceFingerprint")
    expect(devApps).not.toContain("backfillReleaseParts")
    expect(devApps).not.toContain('runtimeKind ?? "static"')
  })

  it("writes parts at publish and consumes those exact stored parts", () => {
    expect(devApps).toContain("parts: reservation.runtimeParts ?? partsForPublishedRuntimeKind(args.runtimeKind)")
    expect(publishedManifest).toContain("parts: entry.activeRelease.parts")
    expect(publishedManifest).not.toContain("partsForLaunchSpec")
  })

  it("represents current static and service artifacts without granting worker powers", () => {
    expect(partsForPublishedRuntimeKind("static")).toEqual({
      view: { source: "package" },
    })
    expect(partsForPublishedRuntimeKind("service")).toEqual({
      view: { source: "package" },
      service: { runtimeKind: "node", network: true },
      runtime: { kind: "container", location: "device", state: "device" },
    })
    expect(partsForPublishedRuntimeKind("service").worker).toBeUndefined()
  })
})
