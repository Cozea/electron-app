import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DevAppInstallationService } from "../../apps/desktop/electron/services/DevAppInstallationService"
import type { DevAppModuleRegistry } from "../../apps/desktop/electron/services/DevAppInstallationService"

const roots: string[] = []

function moduleRegistry(): DevAppModuleRegistry {
  const registrations = new Map<string, { generation: string; root: string }>()
  return {
    registerBuild: ({ registrationId, generation, root }) => {
      registrations.set(registrationId, { generation, root })
    },
    releaseBuild: (registrationId, generation) => {
      const current = registrations.get(registrationId)
      if (!current || (generation && current.generation !== generation)) return false
      return registrations.delete(registrationId)
    },
    buildAssetUrl: (registrationId, generation, assetPath) => {
      const current = registrations.get(registrationId)
      if (!current || current.generation !== generation) throw new Error("not registered")
      return `cozea-native-devapp://${registrationId}/${assetPath}?generation=${generation}`
    },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(version: string, label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-install-fixture-"))
  roots.push(root)
  fs.mkdirSync(path.join(root, "src"), { recursive: true })
  fs.writeFileSync(
    path.join(root, "cozea-devapp.json"),
    JSON.stringify({
      manifestVersion: 3,
      id: "dev.cozea.tests.installation",
      name: "Installed counter",
      version,
      description: label,
      engines: { cozea: ">=0.3.0 <0.4.0", nativeApi: 1 },
      rendererModules: { main: { entry: "src/index.tsx" } },
      contributes: {
        surfaces: [
          {
            id: "main",
            title: "Counter",
            default: true,
            renderer: { kind: "native-react", module: "main", component: "Counter" },
          },
        ],
      },
    }),
  )
  fs.writeFileSync(
    path.join(root, "src/index.tsx"),
    `import { defineNativeDevApp } from "@cozea/devapp-api/native";\n` +
      `function Counter(){ return ${JSON.stringify(label)} }\n` +
      `export default defineNativeDevApp({ components: { Counter } });\n`,
  )
  return root
}

describe("DevAppInstallationService", () => {
  it("installs, prepares, rolls back, restores and uninstalls native releases", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-install-data-"))
    roots.push(dataRoot)
    const modules = moduleRegistry()
    const service = new DevAppInstallationService(() => dataRoot, modules)

    const first = await service.installDevelopment({
      workspaceId: "workspace-1",
      relativePath: ".",
      packageRoot: fixture("1.0.0", "first"),
    })
    const second = await service.installDevelopment({
      workspaceId: "workspace-1",
      relativePath: ".",
      packageRoot: fixture("1.1.0", "second"),
    })

    expect(second.installationId).toBe(first.installationId)
    expect(second.releases).toHaveLength(2)
    expect(service.prepareSurface(second.installationId, "main")).toMatchObject({
      kind: "nativeReact",
      appVersion: "1.1.0",
      component: "Counter",
    })

    const rolledBack = service.activateRelease(second.installationId, first.activeReleaseId)
    expect(rolledBack.activeReleaseId).toBe(first.activeReleaseId)
    expect(service.prepareSurface(second.installationId).appVersion).toBe("1.0.0")

    service.dispose()
    const restored = new DevAppInstallationService(
      () => dataRoot,
      moduleRegistry(),
    )
    expect(restored.list()).toHaveLength(1)
    expect(restored.prepareSurface(second.installationId)).toMatchObject({
      kind: "nativeReact",
      appVersion: "1.0.0",
    })
    expect(restored.uninstall(second.installationId)).toBe(true)
    expect(restored.list()).toEqual([])
  })

  it("derives different identities for the same app installed from different workspaces", async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-install-data-"))
    roots.push(dataRoot)
    const service = new DevAppInstallationService(
      () => dataRoot,
      moduleRegistry(),
    )
    const packageRoot = fixture("1.0.0", createHash("sha256").update("fixture").digest("hex"))
    const left = await service.installDevelopment({
      workspaceId: "workspace-left",
      relativePath: ".",
      packageRoot,
    })
    const right = await service.installDevelopment({
      workspaceId: "workspace-right",
      relativePath: ".",
      packageRoot,
    })
    expect(left.installationId).not.toBe(right.installationId)
  })
})
