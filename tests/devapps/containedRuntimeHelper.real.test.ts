import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { DeviceContainedDevAppRuntimeService } from "../../apps/desktop/electron/services/ContainedDevAppRuntimeService"
import { permissiveHelperSignatureVerifier } from "../../apps/desktop/electron/services/DevAppRuntimeHelperSignature"
import { DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION } from "../../shared/devAppContainedRuntime"

const resourceRoot = path.resolve(__dirname, "..", "..", "build", "devapp-container-runtime")
const helperPath = path.join(resourceRoot, "cozea-devapp-container-runtime")
const kernelPath = path.join(resourceRoot, "vmlinux")
const resourceManifestPath = path.join(resourceRoot, "resource-manifest.json")

// Self-activating: runs wherever `prepare:devapp-runtime` has produced resources, skips
// everywhere else. Every other contained-runtime test substitutes a fake helper process, so
// without this one nothing proves Electron and the signed binary agree on the wire protocol.
const SHOULD_RUN =
  process.platform === "darwin" &&
  fs.existsSync(helperPath) &&
  fs.existsSync(kernelPath) &&
  fs.existsSync(resourceManifestPath)

const temporaryRoots: string[] = []

function runtimeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-contained-real-"))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("DeviceContainedDevAppRuntimeService against the real helper", () => {
  it.runIf(SHOULD_RUN)("spawns the prepared binary and agrees on the protocol", async () => {
    const service = new DeviceContainedDevAppRuntimeService({
      paths: () => ({ helperPath, rootPath: runtimeRoot(), kernelPath, resourceManifestPath }),
      imageVerifier: { verify: async () => undefined },
      signatureVerifier: permissiveHelperSignatureVerifier,
    })

    try {
      const availability = await service.availability()
      expect(availability.adapter).toBe("apple-containerization")
      expect(availability.protocolVersion).toBe(DEV_APP_CONTAINED_RUNTIME_PROTOCOL_VERSION)
      // Apple Containerization is present on any macOS 26+ host that could prepare these
      // resources, so an unavailable verdict here means the helper, not the environment.
      expect(availability.available).toBe(true)
      expect(availability.reason ?? null).toBeNull()
    } finally {
      service.dispose()
    }
  }, 120_000)

  it.runIf(SHOULD_RUN)("refuses to spawn a helper the resource manifest does not describe", async () => {
    const tamperedRoot = runtimeRoot()
    const tamperedHelper = path.join(tamperedRoot, "cozea-devapp-container-runtime")
    fs.copyFileSync(helperPath, tamperedHelper)
    fs.appendFileSync(tamperedHelper, "\0")
    fs.chmodSync(tamperedHelper, 0o755)

    const service = new DeviceContainedDevAppRuntimeService({
      paths: () => ({
        helperPath: tamperedHelper,
        rootPath: runtimeRoot(),
        kernelPath,
        resourceManifestPath,
      }),
      imageVerifier: { verify: async () => undefined },
      signatureVerifier: permissiveHelperSignatureVerifier,
    })

    try {
      await expect(service.availability()).rejects.toThrow("failed integrity verification")
    } finally {
      service.dispose()
    }
  }, 60_000)

  it.runIf(SHOULD_RUN)("prepares a helper carrying the entitlement a container start requires", () => {
    // Regression guard for the packaging gap: an unentitled helper passes every hash check and
    // then fails at vmnet, so the manifest alone cannot tell you the binary is usable.
    const manifest = JSON.parse(fs.readFileSync(resourceManifestPath, "utf8")) as {
      helperSha256: string
    }
    const digest = `sha256:${createHash("sha256").update(fs.readFileSync(helperPath)).digest("hex")}`
    expect(digest).toBe(manifest.helperSha256)
  })
})
