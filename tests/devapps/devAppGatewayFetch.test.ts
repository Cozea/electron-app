import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchDevAppGateway } from "../../apps/desktop/electron/services/devAppGatewayFetch"

const URL_UNDER_TEST = "https://api.cozea.app/devapps/runtime-builds"

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubFetch(behaviour: () => Promise<Response>) {
  const spy = vi.fn(behaviour)
  vi.stubGlobal("fetch", spy)
  return spy
}

describe("fetchDevAppGateway", () => {
  it("passes a successful response straight through", async () => {
    const response = new Response("{}", { status: 200 })
    stubFetch(async () => response)
    await expect(fetchDevAppGateway(URL_UNDER_TEST, {}, "DevApp builder")).resolves.toBe(response)
  })

  it("returns error responses untouched so callers keep their status handling", async () => {
    const response = new Response("{}", { status: 503 })
    stubFetch(async () => response)
    const result = await fetchDevAppGateway(URL_UNDER_TEST, {}, "DevApp builder")
    expect(result.status).toBe(503)
  })

  it("names the host a connection failure could not reach", async () => {
    // Node reports DNS failure as a bare `fetch failed`, which identifies nothing.
    stubFetch(async () => {
      throw new TypeError("fetch failed")
    })
    await expect(fetchDevAppGateway(URL_UNDER_TEST, {}, "DevApp builder")).rejects.toThrow(
      "Could not reach the DevApp builder at https://api.cozea.app: fetch failed",
    )
  })

  it("distinguishes a timeout from an unreachable host", async () => {
    stubFetch(async () => {
      const error = new Error("The operation timed out.")
      error.name = "TimeoutError"
      throw error
    })
    await expect(fetchDevAppGateway(URL_UNDER_TEST, {}, "DevApp builder")).rejects.toThrow(
      "The DevApp builder at https://api.cozea.app did not respond in time.",
    )
  })

  it("keeps the raw target when it cannot be parsed as a URL", async () => {
    stubFetch(async () => {
      throw new TypeError("fetch failed")
    })
    await expect(fetchDevAppGateway("not-a-url", {}, "DevApp builder")).rejects.toThrow(
      "at not-a-url",
    )
  })
})
