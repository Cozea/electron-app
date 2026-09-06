/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import fs from "node:fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { mintGitHubInstallationCredential } from "../../cloudflare/worker/src/lib/githubApp"
import { handleCollaborationRepositoryCredential, handleVerifyCollaborationPush, RepositoryAuthenticationError } from "../../cloudflare/worker/src/routes/collaborationRepositories"
import type { Env } from "../../cloudflare/worker/src/types"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), active: vi.fn() }))
vi.mock("../../cloudflare/worker/src/lib/jwt", () => ({ verifyDeviceAccessToken: mocks.auth }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({ requireActiveDeviceAccessInConvex: mocks.active }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })

describe("repository gateway credential safeguards", () => {
  it.each(["http://api.github.com", "file:///tmp/token", "https://name:password@api.github.com", "https://api.github.com/?query=1"])("rejects %s before sending a GitHub credential", async (baseUrl) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    await expect(mintGitHubInstallationCredential({ GITHUB_API_BASE_URL: baseUrl } as Env, { installationId: "1", repositoryNumericId: "2", operation: "read" })).rejects.toThrow(/HTTPS/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects unsafe numeric repository IDs before signing or sending", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch)
    await expect(mintGitHubInstallationCredential({} as Env, { installationId: "1", repositoryNumericId: "9007199254740993", operation: "write" })).rejects.toThrow(/safe integer/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([handleVerifyCollaborationPush, handleCollaborationRepositoryCredential])("classifies absent/expired tokens as authentication errors", async (handler) => {
    await expect(handler(new Request("https://gateway.test/", { method: "POST" }), {} as Env)).rejects.toBeInstanceOf(RepositoryAuthenticationError)
    mocks.auth.mockRejectedValue(new Error("expired"))
    await expect(handler(new Request("https://gateway.test/", { method: "POST", headers: { authorization: "Bearer expired" } }), {} as Env)).rejects.toBeInstanceOf(RepositoryAuthenticationError)
    const index = fs.readFileSync("cloudflare/worker/src/index.ts", "utf8")
    expect(index.match(/error instanceof RepositoryAuthenticationError/g)).toHaveLength(2)
    expect(index).toContain("protocolError('DEVICE_AUTH_REJECTED', error.message, { status: 401 }")
  })

  it("never caches issued repository credentials", () => {
    const source = fs.readFileSync("cloudflare/worker/src/routes/collaborationRepositories.ts", "utf8")
    expect(source).toContain("return jsonResponse(result, { headers: { 'cache-control': 'no-store' } })")
  })
})
