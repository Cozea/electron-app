import { describe, expect, it } from "vitest"

import {
  buildOrgDevAppUrl,
  buildOrgDevAppServiceUrl,
  evaluateOrgDevAppNavigation,
  getOrgDevAppNavigationScope,
  isOrgDevAppServiceUrl,
  isLocalhostUrl,
  parseOrgDevAppUrl,
} from "@shared/orgDevAppProtocol"

const HASH = "a".repeat(64)

describe("org DevApp protocol", () => {
  it("builds and parses a release URL", () => {
    const url = buildOrgDevAppUrl({ contentHash: HASH, entryPath: "index.html" })
    expect(url).toBe(`cozea-devapp://${HASH}.release/index.html`)
    expect(parseOrgDevAppUrl(url)).toEqual({
      contentHash: HASH,
      assetPath: "index.html",
    })
  })

  it("rejects localhost URLs", () => {
    expect(isLocalhostUrl("http://localhost:5173")).toBe(true)
    expect(isLocalhostUrl("http://127.0.0.1:3000/app")).toBe(true)
    expect(isLocalhostUrl("http://[::1]/")).toBe(true)
    expect(evaluateOrgDevAppNavigation("http://localhost:5173")).toEqual({
      allowed: false,
      reason: "localhost",
    })
    expect(evaluateOrgDevAppNavigation("https://127.0.0.1")).toEqual({
      allowed: false,
      reason: "localhost",
    })
  })

  it("allows only the immutable custom-protocol release as top-level navigation", () => {
    expect(
      evaluateOrgDevAppNavigation(buildOrgDevAppUrl({ contentHash: HASH })),
    ).toEqual({ allowed: true, kind: "org-devapp" })
    expect(evaluateOrgDevAppNavigation("https://api.example.com/v1")).toEqual({
      allowed: false,
      reason: "external-https",
    })
  })

  it("allows release-scoped Service DevApp localhost origins", () => {
    const url = buildOrgDevAppServiceUrl(HASH, 43123)
    expect(isOrgDevAppServiceUrl(url)).toBe(true)
    expect(evaluateOrgDevAppNavigation(url)).toEqual({ allowed: true, kind: "org-devapp" })
    const scope = getOrgDevAppNavigationScope(url)
    expect(scope).toBe(`service:${HASH}:43123`)
    expect(evaluateOrgDevAppNavigation(buildOrgDevAppServiceUrl("b".repeat(64), 43123), scope)).toEqual({
      allowed: false,
      reason: "cross-release",
    })
    expect(evaluateOrgDevAppNavigation(buildOrgDevAppServiceUrl(HASH, 43124), scope)).toEqual({
      allowed: false,
      reason: "cross-release",
    })
    expect(isOrgDevAppServiceUrl("http://localhost:43123")).toBe(false)
  })

  it("gives distinct releases distinct browser origins", () => {
    const otherHash = "b".repeat(64)
    expect(new URL(buildOrgDevAppUrl({ contentHash: HASH })).hostname).not.toBe(
      new URL(buildOrgDevAppUrl({ contentHash: otherHash })).hostname,
    )
  })

  it("blocks other schemes", () => {
    expect(evaluateOrgDevAppNavigation("file:///tmp/index.html")).toEqual({
      allowed: false,
      reason: "blocked-scheme",
    })
    expect(evaluateOrgDevAppNavigation("http://example.com")).toEqual({
      allowed: false,
      reason: "blocked-scheme",
    })
  })
})
