import { describe, expect, it } from "vitest"

import {
  areWorkbenchKeepAliveSessionsEqual,
  selectWorkbenchKeepAliveSessions,
  type WorkbenchKeepAliveSession,
} from "@/features/projects/components/workbench/workbenchKeepAlive"

function session(
  scopeKey: string,
  lastActiveAt: number,
  overrides: Partial<WorkbenchKeepAliveSession> = {},
): WorkbenchKeepAliveSession {
  return {
    scopeKey,
    projectId: scopeKey,
    activeLaneId: "collab",
    workspaceId: `${scopeKey}-ws`,
    projectRootPath: `/tmp/${scopeKey}`,
    gitRootPath: `/tmp/${scopeKey}`,
    projectName: scopeKey,
    framework: null,
    storedDevCommand: null,
    storedDevPort: null,
    workbenchSessionKey: `${scopeKey}-session`,
    themeScheme: "dark",
    lastActiveAt,
    ...overrides,
  }
}

describe("selectWorkbenchKeepAliveSessions", () => {
  it("keeps the current session first and retains recent ones", () => {
    const current = session("b", 30)
    const selected = selectWorkbenchKeepAliveSessions(current, [
      session("a", 10),
      session("c", 20),
    ])

    expect(selected.map((entry) => entry.scopeKey)).toEqual(["b", "c", "a"])
  })

  it("evicts the oldest session once the keep-alive cap is reached", () => {
    const current = session("d", 40)
    const selected = selectWorkbenchKeepAliveSessions(
      current,
      [session("a", 10), session("b", 20), session("c", 30)],
      3,
    )

    expect(selected.map((entry) => entry.scopeKey)).toEqual(["d", "c", "b"])
  })

  it("replaces a previously stored current session in place", () => {
    const selected = selectWorkbenchKeepAliveSessions(
      session("a", 50, { projectName: "Renamed" }),
      [session("a", 10, { projectName: "Old" }), session("b", 20)],
    )

    expect(selected).toHaveLength(2)
    expect(selected[0]?.projectName).toBe("Renamed")
    expect(selected.map((entry) => entry.scopeKey)).toEqual(["a", "b"])
  })
})

describe("areWorkbenchKeepAliveSessionsEqual", () => {
  it("ignores lastActiveAt so host updates can bail out", () => {
    const left = session("a", 1)
    const right = session("a", 99)
    expect(areWorkbenchKeepAliveSessionsEqual(left, right)).toBe(true)
  })

  it("detects session-key changes that tiles need", () => {
    const left = session("a", 1)
    const right = session("a", 1, { workbenchSessionKey: "next" })
    expect(areWorkbenchKeepAliveSessionsEqual(left, right)).toBe(false)
  })
})
