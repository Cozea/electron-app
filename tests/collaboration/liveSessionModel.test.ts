import { describe, expect, it } from "vitest"

import type { ProjectdSessionStatus } from "@cozea/projectd-protocol"

import {
  describeLiveSessionSync,
  resolveMembership,
  type LiveSessionMember,
} from "@/features/collaboration/live/liveSessionModel"

function daemonStatus(overrides: Partial<ProjectdSessionStatus> = {}): ProjectdSessionStatus {
  return {
    publicSessionId: "czs_0123456789abcdef",
    workspaceId: "ws_demo",
    rootPath: "/Users/tester/demo",
    state: "live",
    role: "developer",
    lastAppliedSessionSeq: 3,
    pendingBatches: 0,
    fileCount: 2,
    skippedPaths: [],
    lastError: null,
    updatedAt: 0,
    ...overrides,
  }
}

const ATTACHED = {
  lifecycle: "ACTIVE",
  membership: "active" as const,
  daemonEnabled: true,
  phase: "attached" as const,
  status: daemonStatus(),
  error: null,
}

const SELF_LEFT: LiveSessionMember[] = [
  { principalId: "p1", displayName: "This Mac", role: "developer", status: "left", isSelf: true },
]

describe("live session membership", () => {
  it("takes the session record's answer, and the member list only when the record has none", () => {
    expect(resolveMembership("active", [])).toBe("active")
    expect(resolveMembership("revoked", SELF_LEFT)).toBe("revoked")
    expect(resolveMembership(null, SELF_LEFT)).toBe("none")
    expect(resolveMembership(undefined, SELF_LEFT)).toBe("left")
    expect(resolveMembership(undefined, [])).toBe("none")
  })
})

describe("how the session bar describes syncing", () => {
  it("says a session is live, and when changes are still on their way", () => {
    expect(describeLiveSessionSync(ATTACHED)).toEqual({ tone: "live", label: "Live", detail: null })
    expect(describeLiveSessionSync({ ...ATTACHED, status: daemonStatus({ pendingBatches: 2 }) })).toMatchObject({
      tone: "working",
      label: "Sending changes…",
    })
    expect(
      describeLiveSessionSync({ ...ATTACHED, status: daemonStatus({ skippedPaths: ["a.png", "b.zip"] }) }).detail,
    ).toMatch(/^2 files stay on this Mac/)
  })

  it("explains why a folder stopped syncing", () => {
    const conflict = "1 file in /Users/tester/demo differs from the session and holds changes Git does not have."
    expect(
      describeLiveSessionSync({
        ...ATTACHED,
        status: daemonStatus({ state: "failed", lastError: { code: "WORKSPACE_CONFLICT", message: conflict } }),
      }),
    ).toEqual({ tone: "attention", label: "Stopped syncing", detail: conflict })
    expect(
      describeLiveSessionSync({ ...ATTACHED, phase: "unavailable", status: null, error: "connect ENOENT" }),
    ).toMatchObject({ tone: "attention", label: "Not syncing", detail: expect.stringContaining("connect ENOENT") })
    expect(
      describeLiveSessionSync({
        ...ATTACHED,
        status: daemonStatus({ state: "reconnecting", lastError: { code: "SOCKET_CLOSED", message: "Room went away" } }),
      }),
    ).toEqual({ tone: "working", label: "Reconnecting…", detail: "Room went away" })
  })

  it("tells people who are not syncing what to do", () => {
    expect(describeLiveSessionSync({ ...ATTACHED, membership: "none" })).toMatchObject({ label: "Not joined" })
    expect(describeLiveSessionSync({ ...ATTACHED, membership: "left" }).detail).toMatch(/Rejoin/)
    expect(describeLiveSessionSync({ ...ATTACHED, membership: "revoked" })).toMatchObject({ label: "Removed" })
    expect(describeLiveSessionSync({ ...ATTACHED, lifecycle: "PAUSED" })).toMatchObject({ tone: "idle", label: "Paused" })
  })

  it("shows progress while the daemon connects or waits for the session key", () => {
    expect(describeLiveSessionSync({ ...ATTACHED, phase: "connecting", status: null })).toMatchObject({
      label: "Connecting…",
    })
    expect(describeLiveSessionSync({ ...ATTACHED, phase: "waiting_for_key", status: null })).toMatchObject({
      tone: "working",
      label: "Waiting for access",
    })
    expect(describeLiveSessionSync({ ...ATTACHED, daemonEnabled: false, phase: "off", status: null })).toMatchObject({
      tone: "live",
    })
  })
})
