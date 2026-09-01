import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { OrgDevAppInstallationService } from "../../apps/desktop/electron/services/OrgDevAppInstallationService"
import type { OrgDevAppArtifactService } from "../../apps/desktop/electron/services/OrgDevAppArtifactService"
import type { OrgDevAppInstallRequest } from "../../shared/orgDevAppInstallation"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function request(version: number, contentHash = String(version).repeat(64)): OrgDevAppInstallRequest {
  return {
    downloadUrl: `https://example.test/release-${version}.zip`,
    installation: {
      ref: `cozea-devapp:org_1/pub_1@${version}`,
      publicationId: "pub_1",
      organizationId: "org_1",
      organizationName: "Test organization",
      name: "Test DevApp",
      description: "An installed app",
      logoDataUrl: null,
      activeRelease: {
        id: `release_${version}`,
        version,
        framework: "vite",
        entryPath: "index.html",
        contentHash,
        runtimeKind: "static",
        manifestVersion: 1,
        platform: null,
        arch: null,
        permissionSetHash: null,
        publisherIdentityKey: null,
        publisherDeviceLabel: null,
        parts: { view: { source: "package" } },
      },
    },
  }
}

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-installations-"))
  roots.push(root)
  let protectedHashes: (() => ReadonlySet<string>) | null = null
  const artifacts = {
    setProtectedContentHashes: vi.fn((provider: () => ReadonlySet<string>) => {
      protectedHashes = provider
    }),
    prepareArtifact: vi.fn(async (input) => ({
      contentHash: input.contentHash,
      entryPath: input.entryPath ?? "index.html",
      originUrl: `cozea-devapp://${input.contentHash}/index.html`,
      cacheDir: path.join(root, input.contentHash),
      runtimeKind: input.runtimeKind ?? "static",
    })),
    prepareCachedArtifact: vi.fn((input) => ({
      contentHash: input.contentHash,
      entryPath: input.entryPath ?? "index.html",
      originUrl: `cozea-devapp://${input.contentHash}/index.html`,
      cacheDir: path.join(root, input.contentHash),
      runtimeKind: input.runtimeKind ?? "static",
    })),
    getPreparedArtifactSize: vi.fn(() => 4096),
    removePreparedArtifact: vi.fn(),
    stopRuntime: vi.fn(),
  } as unknown as OrgDevAppArtifactService
  const service = new OrgDevAppInstallationService(
    () => path.join(root, "installations.json"),
    artifacts,
  )
  return { service, artifacts, protectedHashes: () => protectedHashes?.() ?? new Set() }
}

describe("organization DevApp installations", () => {
  it("pins exact releases and changes the active release only after an explicit update", async () => {
    const { service, protectedHashes } = makeService()
    const first = await service.install(request(1))
    expect(first.ref).toBe("cozea-devapp:org_1/pub_1@1")
    expect(service.resolve("cozea-devapp:org_1/pub_1")?.activeRelease.version).toBe(1)

    await service.install(request(2))
    expect(service.resolve("cozea-devapp:org_1/pub_1")?.activeRelease.version).toBe(2)
    expect(service.resolve("cozea-devapp:org_1/pub_1@1")?.activeRelease.version).toBe(1)
    expect(service.list()).toHaveLength(2)
    expect(protectedHashes()).toEqual(new Set(["1".repeat(64), "2".repeat(64)]))
  })

  it("prepares an installed release without a download URL", async () => {
    const { service, artifacts } = makeService()
    await service.install(request(1))
    const prepared = await service.prepare("cozea-devapp:org_1/pub_1@1")
    expect(prepared.originUrl).toContain("1".repeat(64))
    expect(artifacts.prepareCachedArtifact).toHaveBeenCalledOnce()
  })

  it("removes versions and only deletes an artifact after its last install reference", async () => {
    const { service, artifacts } = makeService()
    const sharedHash = "a".repeat(64)
    await service.install(request(1, sharedHash))
    await service.install(request(2, sharedHash))
    expect(service.removeVersion("cozea-devapp:org_1/pub_1@1")).toBe(true)
    expect(artifacts.removePreparedArtifact).not.toHaveBeenCalled()
    expect(service.uninstallPublication("pub_1")).toBe(1)
    expect(artifacts.removePreparedArtifact).toHaveBeenCalledWith(sharedHash)
    expect(service.list()).toEqual([])
  })

  it("rejects latest aliases and mismatched release identities at the install boundary", async () => {
    const { service } = makeService()
    await expect(service.install({
      ...request(1),
      installation: { ...request(1).installation, ref: "cozea-devapp:org_1/pub_1" },
    })).rejects.toThrow(/exact release reference/)
  })
})
