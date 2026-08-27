import { describe, expect, it } from "vitest"

import {
  buildOrgDevAppUrl,
  evaluateOrgDevAppNavigation,
  isLocalhostUrl,
  parseOrgDevAppUrl,
} from "@shared/orgDevAppProtocol"

const HASH = "a".repeat(64)

describe("org DevApp protocol", () => {
  it("builds and parses a release URL", () => {
    const url = buildOrgDevAppUrl({ contentHash: HASH, entryPath: "index.html" })
    expect(url).toBe(`cozea-devapp://release/${HASH}/index.html`)
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

  it("allows the custom protocol and https APIs", () => {
    expect(
      evaluateOrgDevAppNavigation(buildOrgDevAppUrl({ contentHash: HASH })),
    ).toEqual({ allowed: true, kind: "org-devapp" })
    expect(evaluateOrgDevAppNavigation("https://api.example.com/v1")).toEqual({
      allowed: true,
      kind: "https",
    })
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
