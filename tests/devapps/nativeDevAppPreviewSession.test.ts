import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { DevAppDevelopmentTrustStore } from "@shared/devAppDevelopmentTrust"
import type { DevAppAuthoringManifestV3 } from "@shared/devAppManifestV3"
import { NativeDevAppPreviewSession } from "../../apps/desktop/electron/services/NativeDevAppPreviewSession"
import type { NativeDevAppBuildService } from "../../apps/desktop/electron/services/NativeDevAppBuildService"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

function createPackage(): { root: string; manifest: DevAppAuthoringManifestV3 } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-native-preview-"))
  temporaryRoots.push(root)
  const manifest: DevAppAuthoringManifestV3 = {
    manifestVersion: 3,
    id: "dev.cozea.tests.preview",
    name: "Preview Test",
    version: "1.0.0",
    engines: { cozea: ">=0.3.0 <0.4.0", nativeApi: 1 },
    rendererModules: { main: { entry: "src/index.tsx" } },
    permissions: { required: [], optional: [] },
    contributes: {
      surfaces: [
        {
          id: "main",
          title: "Preview Test",
          default: true,
          renderer: { kind: "native-react", module: "main", component: "Main" },
        },
      ],
    },
  }
  fs.mkdirSync(path.join(root, "src"))
  fs.writeFileSync(path.join(root, "src/index.tsx"), "export default null\n")
  fs.writeFileSync(path.join(root, "cozea-devapp.json"), JSON.stringify(manifest))
  return { root, manifest }
}

function fakeBuildService(manifest: DevAppAuthoringManifestV3) {
  const buildDevelopment = vi.fn(async ({ generation }: { generation: number }) => ({
    manifest,
    release: {
      releaseManifestVersion: 1 as const,
      appId: manifest.id,
      appVersion: manifest.version,
      nativeApi: 1,
      rendererModules: {
        main: { entry: "renderer/main.mjs", contentHash: "0".repeat(64) },
      },
      permissions: { required: [], optional: [] },
      contributes: manifest.contributes,
    },
    outputRoot: "/tmp/output",
    view: {
      kind: "nativeReact" as const,
      appId: manifest.id,
      appVersion: manifest.version,
      surfaceId: "main",
      component: "Main",
      moduleUrl: `cozea-native-devapp://0123456789abcdef0123456789abcdef/renderer/main.mjs?generation=g${generation}`,
    },
  }))
  const releaseDevelopment = vi.fn()
  const diagnostics = vi.fn(() => [])
  return {
    value: { buildDevelopment, releaseDevelopment, diagnostics } as unknown as NativeDevAppBuildService,
    buildDevelopment,
    releaseDevelopment,
  }
}

describe("NativeDevAppPreviewSession", () => {
  it("requires explicit trust before loading same-renderer React code", async () => {
    const { root, manifest } = createPackage()
    const build = fakeBuildService(manifest)
    const session = new NativeDevAppPreviewSession(
      build.value,
      new DevAppDevelopmentTrustStore(() => 1_000),
    )

    const pending = await session.open({
      sourceId: "0123456789abcdef0123456789abcdef",
      sourcePath: root,
      workspaceId: "workspace-1",
      workspaceRoot: root,
      leaseId: "lease-1",
    })

    expect(pending.status).toBe("needsApproval")
    if (pending.status !== "needsApproval") throw new Error("expected approval")
    expect(pending.nativeExecution).toBe(true)
    expect(build.buildDevelopment).not.toHaveBeenCalled()

    const running = await session.approve(
      pending.sourceId,
      pending.approvalFingerprint,
    )
    expect(running?.status).toBe("running")
    if (running?.status !== "running") throw new Error("expected running preview")
    expect(running.view.kind).toBe("nativeReact")
    expect(build.buildDevelopment).toHaveBeenCalledTimes(1)
  })

  it("rebuilds into a new generation and releases the build after the final lease", async () => {
    const { root, manifest } = createPackage()
    const build = fakeBuildService(manifest)
    const session = new NativeDevAppPreviewSession(
      build.value,
      new DevAppDevelopmentTrustStore(() => 1_000),
    )

    const pending = await session.open({
      sourceId: "fedcba9876543210fedcba9876543210",
      sourcePath: root,
      workspaceId: "workspace-1",
      workspaceRoot: root,
      leaseId: "lease-1",
    })
    if (pending.status !== "needsApproval") throw new Error("expected approval")
    const running = await session.approve(pending.sourceId, pending.approvalFingerprint)
    if (running?.status !== "running") throw new Error("expected running preview")
    const firstToken = running.reloadToken

    const reloaded = await session.reload(pending.sourceId)
    expect(reloaded?.status).toBe("running")
    if (reloaded?.status !== "running") throw new Error("expected reloaded preview")
    expect(reloaded.reloadToken).toBeGreaterThan(firstToken)
    expect(build.buildDevelopment).toHaveBeenCalledTimes(2)

    expect(session.close(pending.sourceId, "lease-1")).toBe(true)
    expect(build.releaseDevelopment).toHaveBeenCalledWith(pending.sourceId)
  })
})
