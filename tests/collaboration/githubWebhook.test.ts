import { createHmac } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../../cloudflare/worker/src/types"

const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }))
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { mutation = mutation } }))
import { handleGitHubWebhook } from "../../cloudflare/worker/src/routes/collaborationGitHubSetup"

const secret = "test-webhook-key"
const env = { GITHUB_APP_WEBHOOK_SECRET: secret, CONVEX_URL: "https://example.convex.cloud", AI_GATEWAY_SECRET: "test-gateway-key" } as Env
function request(body: string, event = "installation", signingKey = secret) {
  return new Request("https://gateway.test/collab/github/webhook", { method: "POST", body, headers: {
    "x-github-event": event, "x-hub-signature-256": `sha256=${createHmac("sha256", signingKey).update(body).digest("hex")}`,
  } })
}
beforeEach(() => { mutation.mockReset(); mutation.mockResolvedValue(null) })

describe("signed GitHub installation webhook", () => {
  it("rejects absent, malformed, and incorrect signatures before any backend mutation", async () => {
    const body = JSON.stringify({ action: "deleted", installation: { id: 42 } })
    for (const signature of [null, "sha256=invalid", `sha256=${"0".repeat(64)}`]) {
      const input = request(body)
      if (signature === null) input.headers.delete("x-hub-signature-256")
      else input.headers.set("x-hub-signature-256", signature)
      expect((await handleGitHubWebhook(input, env)).status).toBe(401)
    }
    expect(mutation).not.toHaveBeenCalled()
  })
  it("accepts signed pings and revokes only installation access-change events", async () => {
    expect((await handleGitHubWebhook(request("{}", "ping"), env)).status).toBe(204)
    expect((await handleGitHubWebhook(request('{"action":"created","installation":{"id":42}}'), env)).status).toBe(204)
    expect(mutation).not.toHaveBeenCalled()
    for (const [event, action] of [["installation", "deleted"], ["installation", "suspend"], ["installation_repositories", "removed"]]) {
      expect((await handleGitHubWebhook(request(JSON.stringify({ action, installation: { id: 42 } }), event), env)).status).toBe(204)
      expect(mutation).toHaveBeenLastCalledWith(expect.anything(), { serverSecret: env.AI_GATEWAY_SECRET, installationId: "42" })
    }
    expect(mutation).toHaveBeenCalledTimes(3)
  })
  it("rejects malformed, oversized and invalidly identified signed payloads", async () => {
    for (const body of ["{", "null", "[]", '{"action":"deleted","installation":{"id":"42"}}', '{"action":"deleted"}', " ".repeat(1024 * 1024 + 1)]) {
      expect((await handleGitHubWebhook(request(body), env)).status).toBe(400)
    }
    expect(mutation).not.toHaveBeenCalled()
  })
  it("keeps backend outages retryable and missing configuration unavailable", async () => {
    expect((await handleGitHubWebhook(request("{}", "ping"), { ...env, GITHUB_APP_WEBHOOK_SECRET: undefined })).status).toBe(503)
    mutation.mockRejectedValueOnce(new Error("backend unavailable"))
    await expect(handleGitHubWebhook(request('{"action":"deleted","installation":{"id":42}}'), env)).rejects.toThrow("backend unavailable")
  })
})
