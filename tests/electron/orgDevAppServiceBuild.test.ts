import fs from "node:fs"
import { request as httpRequest } from "node:http"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  net: { fetch: globalThis.fetch },
  protocol: { handle: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}))

import { OrgDevAppArtifactService } from "../../apps/desktop/electron/services/OrgDevAppArtifactService"
import { unpackZip } from "../../apps/desktop/electron/services/orgDevAppZip"
import { orgDevAppArtifactLimits } from "@shared/orgDevAppLimits"
import { parseServiceDevAppManifest } from "@shared/serviceDevAppManifest"

const temporaryRoots: string[] = []

async function requestGateway(url: URL, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return await new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: Number(url.port),
      path: url.pathname,
      headers: { ...headers, host: url.host },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => chunks.push(chunk))
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }))
    })
    request.on("error", reject)
    request.end()
  })
}

function temporaryRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label))
  temporaryRoots.push(root)
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Service DevApp build adapter", () => {
  it("packages an explicit portable Node service with declared environment", async () => {
    const projectRoot = temporaryRoot("cozea-service-project-")
    const cacheRoot = temporaryRoot("cozea-service-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    fs.writeFileSync(path.join(projectRoot, "build.cjs"), `
      const fs = require("node:fs");
      fs.mkdirSync("service-output", { recursive: true });
      fs.writeFileSync("service-output/server.js", "require('node:http').createServer((_,r)=>r.end('ok')).listen(process.env.PORT, process.env.HOSTNAME)");
    `)
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      scripts: { build: "node build.cjs" },
      cozeaDevApp: {
        service: { outputDir: "service-output", entrypoint: "server.js", healthPath: "/" },
        environment: [{ name: "DATABASE_URL", required: true, secret: true, description: "Database connection" }],
        permissions: { network: true, persistentData: true },
      },
    }))

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    const packed = await service.buildAndPack(projectRoot)
    expect(packed.runtimeKind).toBe("service")
    expect(packed.permissionSetHash).toMatch(/^[a-f0-9]{64}$/)

    const extracted = temporaryRoot("cozea-service-extracted-")
    unpackZip(Buffer.from(packed.zip), extracted, orgDevAppArtifactLimits("service"))
    const manifest = parseServiceDevAppManifest(JSON.parse(fs.readFileSync(path.join(extracted, "cozea-devapp.json"), "utf8")))
    expect(manifest.runtime.entrypoint).toBe("server/server.js")
    expect(manifest.environment).toEqual([{ name: "DATABASE_URL", required: true, secret: true, description: "Database connection" }])
  })

  it("rejects native addons from an explicit service output", async () => {
    const projectRoot = temporaryRoot("cozea-native-service-")
    const cacheRoot = temporaryRoot("cozea-native-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    fs.mkdirSync(path.join(projectRoot, "service-output"))
    fs.writeFileSync(path.join(projectRoot, "service-output", "server.js"), "")
    fs.writeFileSync(path.join(projectRoot, "service-output", "binding.node"), "native")
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      scripts: { build: "node -e \"\"" },
      cozeaDevApp: {
        service: { outputDir: "service-output", entrypoint: "server.js" },
      },
    }))

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    await expect(service.buildAndPack(projectRoot)).rejects.toThrow(/unsupported native code/)
  })

  it.runIf(process.platform === "darwin" && process.arch === "arm64")("starts through the authenticated release gateway and keeps secrets main-process only", async () => {
    const projectRoot = temporaryRoot("cozea-runtime-project-")
    const cacheRoot = temporaryRoot("cozea-runtime-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    fs.writeFileSync(path.join(projectRoot, "build.cjs"), `
      const fs = require("node:fs");
      fs.mkdirSync("service-output", { recursive: true });
      fs.writeFileSync("service-output/server.js", "require('node:http').createServer((_,r)=>r.end(process.env.TEST_SECRET === 'correct' ? 'ready' : 'missing')).listen(process.env.PORT, process.env.HOSTNAME)");
    `)
    fs.writeFileSync(path.join(projectRoot, "package.json"), JSON.stringify({
      scripts: { build: "node build.cjs" },
      cozeaDevApp: {
        service: { outputDir: "service-output", entrypoint: "server.js" },
        environment: [{ name: "TEST_SECRET", required: true, secret: true }],
        permissions: { network: true, persistentData: false },
      },
    }))

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    const packed = await service.buildAndPack(projectRoot)
    const cacheDir = path.join(cacheRoot, packed.contentHash)
    unpackZip(Buffer.from(packed.zip), cacheDir, orgDevAppArtifactLimits("service"))
    fs.writeFileSync(path.join(cacheDir, ".cozea-ready"), packed.contentHash)
    const publicationId = "publication_test"
    service.approveRuntime(packed.contentHash, publicationId, packed.permissionSetHash!)
    service.setRuntimeEnvironment(packed.contentHash, publicationId, { TEST_SECRET: "correct" })

    let beforeSendHeaders: ((details: { requestHeaders: Record<string, string> }, callback: (result: { requestHeaders: Record<string, string> }) => void) => void) | null = null
    const fakeSession = {
      protocol: { handle: vi.fn() },
      webRequest: {
        onBeforeSendHeaders: (_filter: unknown, listener: typeof beforeSendHeaders) => { beforeSendHeaders = listener },
      },
    }
    service.registerProtocolForSession(fakeSession as never, publicationId)
    let gatewayHeaders: Record<string, string> = {}
    beforeSendHeaders?.({ requestHeaders: {} }, (result) => { gatewayHeaders = result.requestHeaders })

    const state = await service.startRuntime(packed.contentHash, publicationId, packed.permissionSetHash, "tile_test")
    try {
      expect(state.status).toBe("ready")
      expect(state.originUrl).toContain(`${packed.contentHash}.service.localhost`)
      const serviceUrl = new URL(state.originUrl!)
      expect((await requestGateway(serviceUrl, {})).status).toBe(403)
      const response = await requestGateway(serviceUrl, gatewayHeaders)
      expect(response.status).toBe(200)
      expect(response.body).toBe("ready")
    } finally {
      service.stopRuntime(packed.contentHash, publicationId)
      service.dispose()
    }
  })
})
