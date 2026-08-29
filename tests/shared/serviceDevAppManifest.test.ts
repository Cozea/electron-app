import { describe, expect, it } from "vitest"

import { parseServiceDevAppManifest, serviceDevAppPermissionSetHash } from "../../shared/serviceDevAppManifest"

function manifest() {
  return {
    schemaVersion: 1,
    kind: "service",
    platform: "darwin",
    arch: "arm64",
    framework: "nextjs",
    runtime: { kind: "node", entrypoint: "server/server.js", args: [] },
    server: { hostEnv: "HOSTNAME", portEnv: "PORT", healthPath: "/health", startupTimeoutMs: 30_000 },
    environment: [{ name: "API_KEY", required: true, secret: true }],
    permissions: { network: true, persistentData: true },
  }
}

describe("Service DevApp manifest", () => {
  it("accepts a bounded standalone Node service", () => {
    expect(parseServiceDevAppManifest(manifest()).runtime.entrypoint).toBe("server/server.js")
  })

  it.each([
    ["path traversal", { runtime: { kind: "node", entrypoint: "../server.js", args: [] } }],
    ["reserved environment", { environment: [{ name: "NODE_OPTIONS", required: true, secret: true }] }],
    ["unknown field", { surprise: true }],
  ])("rejects %s", (_label, patch) => {
    expect(() => parseServiceDevAppManifest({ ...manifest(), ...patch })).toThrow()
  })

  it("hashes permission declarations canonically", () => {
    const parsed = parseServiceDevAppManifest(manifest())
    expect(serviceDevAppPermissionSetHash(parsed)).toMatch(/^[a-f0-9]{64}$/)
    expect(serviceDevAppPermissionSetHash(parsed)).toBe(serviceDevAppPermissionSetHash(parsed))
  })
})
