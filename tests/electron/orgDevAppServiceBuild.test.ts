import fs from "node:fs"
import { createServer, request as httpRequest } from "node:http"
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
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: Number(url.port),
        path: url.pathname,
        headers: { ...headers, host: url.host },
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on("data", (chunk: Buffer) => chunks.push(chunk))
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        )
      },
    )
    request.on("error", reject)
    request.end()
  })
}

function temporaryRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), label))
  temporaryRoots.push(root)
  return root
}

function writeContainedServiceManifest(projectRoot: string, state: "none" | "device" = "device"): void {
  fs.writeFileSync(
    path.join(projectRoot, "cozea-devapp.json"),
    JSON.stringify({
      manifestVersion: 2,
      name: "Contained service",
      service: { runtimeKind: "node", entry: "service-output/server.js" },
      runtime: { location: "device", state },
    }),
  )
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Service DevApp build adapter", () => {
  it("creates an administrative tile artifact for a worker-only package", async () => {
    const projectRoot = temporaryRoot("cozea-worker-only-")
    const cacheRoot = temporaryRoot("cozea-worker-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    fs.mkdirSync(path.join(projectRoot, "src"))
    fs.writeFileSync(path.join(projectRoot, "src", "worker.ts"), "export const worker = true\n")
    fs.writeFileSync(
      path.join(projectRoot, "cozea-devapp.json"),
      JSON.stringify({
        manifestVersion: 2,
        name: "Background indexer",
        worker: {
          entry: "src/worker.ts",
          protocolVersion: 1,
          capabilities: ["project.read"],
          tools: [],
        },
        runtime: { location: "device", state: "device" },
      }),
    )
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: { build: 'node -e ""' },
      }),
    )

    const packed = await new OrgDevAppArtifactService(() => cacheRoot).buildAndPack(projectRoot)
    const extracted = temporaryRoot("cozea-worker-view-")
    unpackZip(Buffer.from(packed.zip), extracted, orgDevAppArtifactLimits("static"))

    expect(packed.runtimeKind).toBe("static")
    expect(packed.entryPath).toBe("index.html")
    expect(fs.readFileSync(path.join(extracted, "index.html"), "utf8")).toContain("contained background worker")
  })

  it("packages an explicit portable Node service with declared environment", async () => {
    const projectRoot = temporaryRoot("cozea-service-project-")
    const cacheRoot = temporaryRoot("cozea-service-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    writeContainedServiceManifest(projectRoot)
    fs.writeFileSync(
      path.join(projectRoot, "build.cjs"),
      `
      const fs = require("node:fs");
      fs.mkdirSync("service-output", { recursive: true });
      fs.writeFileSync("service-output/server.js", "require('node:http').createServer((_,r)=>r.end('ok')).listen(process.env.PORT, process.env.HOSTNAME)");
      fs.mkdirSync("dist", { recursive: true });
      fs.writeFileSync("dist/index.html", "<!doctype html><p>Static output must not override the declared service.</p>");
    `,
    )
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: { build: "node build.cjs" },
        cozeaDevApp: {
          service: { healthPath: "/" },
          environment: [{ name: "DATABASE_URL", required: true, secret: true, description: "Database connection" }],
        },
      }),
    )

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    const packed = await service.buildAndPack(projectRoot)
    expect(packed.runtimeKind).toBe("service")
    expect(packed.permissionSetHash).toMatch(/^[a-f0-9]{64}$/)

    const extracted = temporaryRoot("cozea-service-extracted-")
    unpackZip(Buffer.from(packed.zip), extracted, orgDevAppArtifactLimits("service"))
    const manifest = parseServiceDevAppManifest(
      JSON.parse(fs.readFileSync(path.join(extracted, "cozea-devapp.json"), "utf8")),
    )
    expect(manifest.runtime.entrypoint).toBe("server/service-output/server.js")
    expect(manifest.environment).toEqual([
      { name: "DATABASE_URL", required: true, secret: true, description: "Database connection" },
    ])
  })

  it("keeps publisher-host native addons out of the signed runtime artifact", async () => {
    const projectRoot = temporaryRoot("cozea-native-service-")
    const cacheRoot = temporaryRoot("cozea-native-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    writeContainedServiceManifest(projectRoot)
    fs.mkdirSync(path.join(projectRoot, "service-output"))
    fs.writeFileSync(path.join(projectRoot, "service-output", "server.js"), "")
    fs.writeFileSync(path.join(projectRoot, "service-output", "binding.node"), "native")
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: { build: 'node -e ""' },
        cozeaDevApp: {
          service: {},
        },
      }),
    )

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    const packed = await service.buildAndPack(projectRoot)
    const extracted = temporaryRoot("cozea-native-extracted-")
    unpackZip(Buffer.from(packed.zip), extracted, orgDevAppArtifactLimits("service"))

    expect(packed.platform).toBe("linux")
    expect(packed.arch).toBe("multi")
    expect(fs.existsSync(path.join(extracted, "server", "service-output", "binding.node"))).toBe(false)
    expect(fs.readFileSync(path.join(extracted, "server", "service-output", "server.js"), "utf8")).toContain(
      "executable bytes are in the signed image",
    )
  })

  it.runIf(process.platform === "darwin" && process.arch === "arm64")(
    "starts through the authenticated release gateway and keeps secrets main-process only",
    async () => {
      const projectRoot = temporaryRoot("cozea-runtime-project-")
      const cacheRoot = temporaryRoot("cozea-runtime-cache-")
      fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
      writeContainedServiceManifest(projectRoot, "none")
      fs.writeFileSync(
        path.join(projectRoot, "build.cjs"),
        `
      const fs = require("node:fs");
      fs.mkdirSync("service-output", { recursive: true });
      fs.writeFileSync("service-output/server.js", "require('node:http').createServer((_,r)=>r.end(process.env.TEST_SECRET === 'correct' ? 'ready' : 'missing')).listen(process.env.PORT, process.env.HOSTNAME)");
    `,
      )
      fs.writeFileSync(
        path.join(projectRoot, "package.json"),
        JSON.stringify({
          scripts: { build: "node build.cjs" },
          cozeaDevApp: {
            service: {},
            environment: [{ name: "TEST_SECRET", required: true, secret: true }],
          },
        }),
      )

      const service = new OrgDevAppArtifactService(() => cacheRoot)
      const upstream = createServer((_request, response) => response.end("ready"))
      const upstreamPort = await new Promise<number>((resolve, reject) => {
        upstream.once("error", reject)
        upstream.listen(0, "127.0.0.1", () => {
          const address = upstream.address()
          resolve(typeof address === "object" && address ? address.port : 0)
        })
      })
      let containedEnvironment: Record<string, string> = {}
      let containedRunning = true
      const stopContained = vi.fn(async () => undefined)
      service.setContainedServiceAdapter({
        start: async (options) => {
          containedEnvironment = options.environment
          return {
            key: "pub_runtime_test",
            state: {
              status: "running",
              guestAddress: "127.0.0.1",
              servicePort: upstreamPort,
              error: null,
            },
            serviceUrl: null,
            serviceToken: null,
            logs: ["contained runtime ready"],
          }
        },
        stop: stopContained,
        release: () => true,
        runtimeState: () =>
          containedRunning
            ? {
                runtimeId: "pub_runtime_test",
                status: "running",
                location: "device",
                state: "none",
                publicationId: "publication_test",
                releaseId: "release_test",
                imageDigest: `sha256:${"a".repeat(64)}`,
                guestAddress: "127.0.0.1",
                servicePort: upstreamPort,
                startedAt: 1,
                exitedAt: null,
                exitCode: null,
                error: null,
              }
            : null,
      })
      const packed = await service.buildAndPack(projectRoot)
      const cacheDir = path.join(cacheRoot, packed.contentHash)
      unpackZip(Buffer.from(packed.zip), cacheDir, orgDevAppArtifactLimits("service"))
      fs.writeFileSync(path.join(cacheDir, ".cozea-ready"), packed.contentHash)
      const publicationId = "publication_test"
      service.approveRuntime(packed.contentHash, publicationId, packed.permissionSetHash!)
      service.setRuntimeEnvironment(packed.contentHash, publicationId, { TEST_SECRET: "correct" })

      type HeaderHook = (
        details: { requestHeaders: Record<string, string> },
        callback: (result: { requestHeaders: Record<string, string> }) => void,
      ) => void
      // Held in an object so the assignment inside the listener is not narrowed away.
      const hook: { current: HeaderHook | null } = { current: null }
      const fakeSession = {
        protocol: { handle: vi.fn() },
        webRequest: {
          onBeforeSendHeaders: (_filter: unknown, listener: HeaderHook) => {
            hook.current = listener
          },
        },
      }
      service.registerProtocolForSession(fakeSession as never, publicationId)
      let gatewayHeaders: Record<string, string> = {}
      hook.current?.({ requestHeaders: {} }, (result) => {
        gatewayHeaders = result.requestHeaders
      })

      const state = await service.startRuntime({
        ref: "cozea-devapp:org/org_test/publication_test@1",
        contentHash: packed.contentHash,
        publicationId,
        permissionSetHash: packed.permissionSetHash!,
        leaseId: "tile_test",
        workspaceId: "workspace_test",
        workspaceRoot: projectRoot,
        gatewayBaseUrl: "https://gateway.test",
        accessToken: "device-token",
        folderGrants: [],
      })
      try {
        expect(state.status).toBe("ready")
        expect(containedEnvironment.TEST_SECRET).toBe("correct")
        expect(state.originUrl).toContain(`${packed.contentHash}.service.localhost`)
        const serviceUrl = new URL(state.originUrl!)
        expect((await requestGateway(serviceUrl, {})).status).toBe(403)
        const response = await requestGateway(serviceUrl, gatewayHeaders)
        expect(response.status).toBe(200)
        expect(response.body).toBe("ready")
        containedRunning = false
        expect(service.getRuntimeState(packed.contentHash, publicationId).status).toBe("stopped")
        expect((await requestGateway(serviceUrl, gatewayHeaders)).status).toBe(404)
      } finally {
        await service.stopRuntime(packed.contentHash, publicationId)
        service.dispose()
        await new Promise<void>((resolve) => upstream.close(() => resolve()))
      }
    },
  )

  it("rejects the removed package.json permission authority", async () => {
    const projectRoot = temporaryRoot("cozea-service-permissions-")
    const cacheRoot = temporaryRoot("cozea-service-permissions-cache-")
    fs.writeFileSync(path.join(projectRoot, "bun.lock"), "")
    writeContainedServiceManifest(projectRoot, "device")
    fs.writeFileSync(
      path.join(projectRoot, "build.cjs"),
      `
      const fs = require("node:fs");
      fs.mkdirSync("service-output", { recursive: true });
      fs.writeFileSync("service-output/server.js", "export {};");
    `,
    )
    fs.writeFileSync(
      path.join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: { build: "node build.cjs" },
        cozeaDevApp: {
          service: {},
          permissions: { network: false, persistentData: false },
        },
      }),
    )

    const service = new OrgDevAppArtifactService(() => cacheRoot)
    await expect(service.buildAndPack(projectRoot)).rejects.toThrow(/unsupported field permissions/)
  })
})
