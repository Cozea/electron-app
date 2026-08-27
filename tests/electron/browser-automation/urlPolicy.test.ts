import { describe, expect, it } from "vitest"

import {
  evaluateAutomationNavigateUrl,
  isLoopbackHostname,
  normalizeAutomationUrlInput,
} from "../../../apps/desktop/electron/browser-automation/urlPolicy"

describe("browser automation url policy", () => {
  it("accepts loopback http(s) URLs", () => {
    expect(evaluateAutomationNavigateUrl("http://localhost:5173/").allowed).toBe(true)
    expect(evaluateAutomationNavigateUrl("https://127.0.0.1:3000/app").allowed).toBe(true)
    expect(evaluateAutomationNavigateUrl("http://[::1]:8080/").allowed).toBe(true)
  })

  it("normalizes schemeless localhost", () => {
    expect(normalizeAutomationUrlInput("localhost:5173")).toBe("http://localhost:5173")
    const decision = evaluateAutomationNavigateUrl("localhost:5173/foo")
    expect(decision.allowed).toBe(true)
    expect(decision.normalizedUrl).toContain("http://localhost:5173/foo")
  })

  it("rejects public hosts and non-http schemes", () => {
    expect(evaluateAutomationNavigateUrl("https://example.com").allowed).toBe(false)
    expect(evaluateAutomationNavigateUrl("file:///tmp/x").allowed).toBe(false)
    expect(evaluateAutomationNavigateUrl("")).toMatchObject({ allowed: false })
  })

  it("recognizes loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true)
    expect(isLoopbackHostname("127.0.0.1")).toBe(true)
    expect(isLoopbackHostname("example.com")).toBe(false)
  })
})
