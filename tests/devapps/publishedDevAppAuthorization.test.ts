import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}))

import { PublishedDevAppApprovalService } from "../../apps/desktop/electron/services/PublishedDevAppApprovalService"
import { PublishedDevAppFolderGrantService } from "../../apps/desktop/electron/services/PublishedDevAppFolderGrantService"
import type { OrgDevAppInstallation } from "../../shared/orgDevAppInstallation"
import type { OrgDevAppInstallationService } from "../../apps/desktop/electron/services/OrgDevAppInstallationService"

const temporaryDirectories: string[] = []

function fixtureInstallation(): OrgDevAppInstallation {
  return {
    ref: "cozea-devapp:publication/org_1/pub_1@1",
    organizationId: "org_1",
    organizationName: "Test org",
    publicationId: "pub_1",
    name: "Contained test",
    description: null,
    logoDataUrl: null,
    active: true,
    installedAt: 1,
    lastUsedAt: 1,
    sizeBytes: 1,
    activeRelease: {
      id: "release_1",
      version: 1,
      framework: "static",
      contentHash: "a".repeat(64),
      entryPath: "index.html",
      runtimeKind: "static",
      manifestVersion: 2,
      platform: null,
      arch: null,
      permissionSetHash: null,
      publisherIdentityKey: null,
      publisherDeviceLabel: null,
      packageManifestDigest: `sha256:${"b".repeat(64)}`,
      runtimeSourceDigest: "c".repeat(64),
      runtimeImage: null,
      parts: {
        worker: { protocolVersion: 1, capabilities: ["project.read"], tools: [] },
        runtime: { kind: "container", location: "device", state: "device" },
      },
    },
  }
}

function installationService(installation: OrgDevAppInstallation): OrgDevAppInstallationService {
  return {
    resolve: (ref: string) => ref === installation.ref ? installation : null,
  } as unknown as OrgDevAppInstallationService
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe("published DevApp authorization stores", () => {
  it("binds worker approval to the exact manifest, workspace, expiry, and agent choice", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-published-approval-"))
    temporaryDirectories.push(root)
    const installation = fixtureInstallation()
    let now = 1_000
    const service = new PublishedDevAppApprovalService(
      () => path.join(root, "approvals"),
      installationService(installation),
      () => now,
    )

    const approved = service.approve({
      ref: installation.ref,
      workspaceId: "workspace_1",
      agentInvocable: true,
      expiresAt: now + 500,
    })
    expect(approved.grant).toEqual({ capabilities: ["project.read"], agentInvocable: true })
    expect(service.get(installation.ref, "workspace_1")?.fingerprint).toBe(approved.fingerprint)
    expect(service.get(installation.ref, "workspace_2")).toBeNull()

    now += 501
    expect(service.get(installation.ref, "workspace_1")).toBeNull()
  })

  it("creates explicit canonical release-bound mounts and never reuses them across releases", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-folder-grant-"))
    const selected = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-granted-folder-"))
    temporaryDirectories.push(root, selected)
    const installation = fixtureInstallation()
    const service = new PublishedDevAppFolderGrantService(
      () => path.join(root, "grants"),
      installationService(installation),
      () => 2_000,
    )

    const grant = service.grant({
      ref: installation.ref,
      hostPath: selected,
      access: "readWrite",
      expiresAt: 2_500,
    })
    expect(grant).toMatchObject({
      publicationId: "pub_1",
      releaseId: "release_1",
      canonicalHostPath: fs.realpathSync.native(selected),
      access: "readWrite",
    })
    expect(grant.guestPath).toBe(`/cozea/grants/${grant.grantId}`)
    expect(service.list(installation.ref)).toEqual([grant])

    installation.activeRelease.id = "release_2"
    expect(service.list(installation.ref)).toEqual([])
    installation.activeRelease.id = "release_1"
    expect(service.revoke(installation.ref, grant.grantId)).toBe(true)
    expect(service.list(installation.ref)).toEqual([])
  })
})
