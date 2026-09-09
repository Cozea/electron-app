import { describe, expect, it } from "vitest"
import { artifactMediaRefreshDelay } from "@/features/assistant/artifacts/artifactMediaRefresh"

describe("artifact media refresh scheduling", () => {
  const now = 1_000_000

  it("fetches missing URLs immediately and renews cached URLs before expiry", () => {
    expect(artifactMediaRefreshDelay(undefined, undefined, now)).toBe(0)
    expect(artifactMediaRefreshDelay(now + 90_000, undefined, now)).toBe(60_000)
    expect(artifactMediaRefreshDelay(now + 30_000, undefined, now)).toBe(0)
  })

  it("backs off failed renewals even while retaining an expired cached URL", () => {
    const expiresAt = now - 1
    const retryAt = now + 30_000
    expect(artifactMediaRefreshDelay(expiresAt, retryAt, now)).toBe(30_000)
    expect(artifactMediaRefreshDelay(expiresAt, retryAt, retryAt - 1)).toBe(1)
    expect(artifactMediaRefreshDelay(expiresAt, retryAt, retryAt)).toBe(0)
  })

  it("backs off missing URLs and does not renew a still-fresh URL prematurely", () => {
    expect(artifactMediaRefreshDelay(undefined, now + 30_000, now)).toBe(30_000)
    expect(artifactMediaRefreshDelay(now + 90_000, now + 30_000, now)).toBe(60_000)
  })
})
