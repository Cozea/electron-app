import { afterEach, describe, expect, it, vi } from "vitest"

import { HostedContainedDevAppRuntimeService } from "../../apps/desktop/electron/services/HostedContainedDevAppRuntimeService"
import type { HostedContainedRuntimeStartRequest } from "../../apps/desktop/electron/services/HostedContainedDevAppRuntimeService"

const request: HostedContainedRuntimeStartRequest = {
  runtimeId: "pub_hosted_runtime",
  identity: {
    organizationId: "org_1",
    publicationId: "pub_1",
    releaseId: "release_1",
    releaseVersion: 1,
    contentHash: "a".repeat(64),
    sourceDigest: "b".repeat(64),
    packageManifestDigest: `sha256:${"c".repeat(64)}`,
  },
  location: "hosted",
  state: "organization",
  environment: {},
  servicePort: 8080,
  network: true,
  resources: {
    cpus: 2,
    memoryBytes: 1024 * 1024 * 1024,
    rootfsBytes: 4 * 1024 * 1024 * 1024,
    writableLayerBytes: 512 * 1024 * 1024,
  },
  gatewayBaseUrl: "https://gateway.example",
  accessToken: "device-access-token",
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("HostedContainedDevAppRuntimeService", () => {
  it("uses the hosted transport for the same worker messages and a capability token for stop", async () => {
    let now = 0
    vi.spyOn(Date, "now").mockImplementation(() => now)
    let pendingEvents = false
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith("/devapps/hosted-runtimes/start")) {
        return Response.json({
          state: {
            runtimeId: request.runtimeId,
            status: "running",
            location: "hosted",
            state: "organization",
            publicationId: "pub_1",
            releaseId: "release_1",
            imageDigest: `sha256:${"d".repeat(64)}`,
            guestAddress: null,
            servicePort: 8080,
            startedAt: 1,
            exitedAt: null,
            exitCode: null,
            error: null,
          },
          transportUrl: "https://transport.preview.example",
          transportToken: "transport-token-that-is-at-least-thirty-two-characters",
          controlToken: "lease-token-that-is-at-least-thirty-two-characters",
          serviceUrl: "https://transport.preview.example",
          serviceToken: "service-token-that-is-at-least-thirty-two-characters",
        })
      }
      if (url.includes("/v1/events?cursor=0")) {
        now = 31_000
        return Response.json({
          cursor: 1,
          events: [{ cursor: 1, envelope: { channel: "host", message: { ready: true } } }],
        })
      }
      if (url.includes("/v1/events?cursor=1")) {
        pendingEvents = true
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
            once: true,
          })
        })
      }
      if (url.endsWith("/devapps/hosted-runtimes/renew")) {
        return new Response(null, { status: 204 })
      }
      if (url.endsWith("/v1/message")) return Response.json({ accepted: true }, { status: 202 })
      if (url.endsWith("/devapps/hosted-runtimes/stop")) {
        return Response.json({ state: { status: "stopped" } })
      }
      throw new Error(`Unexpected fetch ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const service = new HostedContainedDevAppRuntimeService()
    const messages: unknown[] = []
    service.on("message", (event) => messages.push(event.transport.message))

    await expect(service.start(request)).resolves.toMatchObject({ status: "running" })
    expect(service.serviceUrl(request.runtimeId)).toBe("https://transport.preview.example")
    expect(service.serviceToken(request.runtimeId)).toBe("service-token-that-is-at-least-thirty-two-characters")
    await vi.waitFor(() => expect(messages).toEqual([{ ready: true }]))
    await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith("/devapps/hosted-runtimes/renew"))).toBe(true))
    await vi.waitFor(() => expect(pendingEvents).toBe(true))
    await service.sendMessage(request.runtimeId, { channel: "host", message: { ping: true } })
    await service.stop(request.runtimeId)

    const stop = calls.find((call) => call.url.endsWith("/devapps/hosted-runtimes/stop"))
    const stopHeaders = new Headers(stop?.init?.headers)
    expect(stopHeaders.get("authorization")).toBeNull()
    expect(stopHeaders.get("x-cozea-hosted-runtime-token")).toBe("lease-token-that-is-at-least-thirty-two-characters")
    expect(JSON.parse(String(stop?.init?.body))).not.toHaveProperty("environment")
    expect(fetchMock).toHaveBeenCalledWith(
      "https://transport.preview.example/v1/message",
      expect.objectContaining({ method: "POST" }),
    )
    service.dispose()
  })
})
