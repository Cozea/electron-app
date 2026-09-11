import { describe, expect, it } from "vitest"

import type { ProjectdAutoGitStatus, ProjectdSessionStatus } from "@cozea/projectd-protocol"

import {
  describeAutoGit,
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
    const offBranch = "This folder has main checked out. Switch back to feat/live to keep syncing the session."
    expect(
      describeLiveSessionSync({ ...ATTACHED, status: daemonStatus({ state: "paused", pausedReason: offBranch }) }),
    ).toEqual({ tone: "attention", label: "Paused on this Mac", detail: offBranch })
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

describe("how the session bar describes saving to Git", () => {
  function autoGit(overrides: Partial<ProjectdAutoGitStatus> = {}): ProjectdAutoGitStatus {
    return {
      state: "follower",
      isLeader: false,
      leaderPrincipalId: "p_sam",
      lastCheckpoint: null,
      unsavedChanges: 0,
      saving: false,
      detail: null,
      lastError: null,
      ...overrides,
    }
  }

  it("stays out of the bar outside a Git repository and once syncing stopped", () => {
    expect(describeAutoGit(daemonStatus())).toBeNull()
    expect(describeAutoGit(daemonStatus({ autoGit: null }))).toBeNull()
    expect(describeAutoGit(daemonStatus({ state: "failed", autoGit: autoGit() }))).toBeNull()
  })

  it("says when the session was last saved and which Mac saves it", () => {
    const publishedAt = new Date(2026, 8, 12, 14, 32).getTime()
    const saved = describeAutoGit(
      daemonStatus({ autoGit: autoGit({ lastCheckpoint: { commitOid: "a1b2c3d4e5f6", sessionSeq: 4, publishedAt } }) }),
      "Sam",
    )
    expect(saved).toMatchObject({ tone: "live", label: expect.stringMatching(/^Saved to Git at /), detail: null, canSave: true })
    expect(saved?.title).toBe("Sam's Mac saves the session to Git. Last commit a1b2c3d.")
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "leader", isLeader: true, saving: true }) }))).toMatchObject({
      label: "Saving to Git…",
      title: "This Mac saves the session to Git.",
    })
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit() }))?.label).toBe("Not saved to Git yet")
  })

  it("explains why saving stopped or failed", () => {
    const changed = "feat/live changed on origin outside the session, so AutoGit stopped saving to it rather than overwrite those commits."
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "blocked", detail: changed }) }))).toMatchObject({
      tone: "attention",
      label: "Git saves stopped",
      detail: changed,
      canSave: true,
    })
    const noSignIn = "Git couldn't sign in to origin from the background service."
    expect(
      describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "ineligible", leaderPrincipalId: null, detail: noSignIn }) })),
    ).toMatchObject({ tone: "attention", label: "Not saving to Git", detail: noSignIn, canSave: false })
    const lastError = { code: "REMOTE_UNREACHABLE", message: "Git couldn't reach origin: timed out." }
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "leader", isLeader: true, lastError }) }))?.detail).toBe(
      "The last save didn't finish (Git couldn't reach origin: timed out). It retries on its own.",
    )
  })

  it("offers Save now only where a Mac can push and the member may write", () => {
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "no_leader", leaderPrincipalId: null }) }))?.canSave).toBe(false)
    expect(describeAutoGit(daemonStatus({ role: "viewer", autoGit: autoGit() }))?.canSave).toBe(false)
  })
})
