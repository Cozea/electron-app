import { describe, expect, it } from "vitest"

import type { ProjectdAutoGitStatus, ProjectdSessionStatus, ProjectdTargetStatus } from "@cozea/projectd-protocol"

import {
  describeAutoGit,
  describeLiveSessionNotices,
  describeLiveSessionSync,
  describeTarget,
  resolveMembership,
  type LiveSessionMember,
  type LiveSessionRepositoryStatus,
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
    pendingBinaryVersions: 0,
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
    ).toMatch(/^2 files stay outside synchronization/)
  })

  it("shows locally retained binary uploads even when there are no outbound batches", () => {
    expect(describeLiveSessionSync({ ...ATTACHED, status: daemonStatus({ pendingBinaryVersions: 2 }) })).toMatchObject({
      tone: "working", label: "Uploads pending", detail: "2 binary versions are retained on this Mac, waiting to upload.",
    })
    expect(describeLiveSessionSync({ ...ATTACHED, status: daemonStatus({ state: "reconnecting", pendingBinaryVersions: 1 }) })).toMatchObject({
      label: "Offline · local changes pending", detail: "1 binary version is retained on this Mac, waiting to upload.",
    })
  })

  it("explains why a folder stopped syncing", () => {
    expect(describeLiveSessionSync({ ...ATTACHED, phase: "waiting_for_key", error: "Retry to retrieve the current key." }).detail)
      .toBe("Retry to retrieve the current key.")
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

  it("sends a member on another folder of the session's branch to the session's Workbench", () => {
    // An invitee whose setup failed opens the project's usual folder; the daemon never syncs it.
    const elsewhere = { ...ATTACHED, phase: "off" as const, status: null, inSessionWorkbench: false }
    expect(describeLiveSessionSync(elsewhere)).toMatchObject({ tone: "attention", label: "Not syncing this folder", fix: "open_workbench" })
    // Joining and removal still come first, and an unknown workspace is just loading.
    expect(describeLiveSessionSync({ ...elsewhere, membership: "none" })).toMatchObject({ label: "Not joined" })
    expect(describeLiveSessionSync({ ...elsewhere, inSessionWorkbench: undefined })).toMatchObject({ label: "Waiting for the project folder" })
    expect(describeLiveSessionSync({ ...ATTACHED, inSessionWorkbench: true }).fix).toBeUndefined()

    const notices = describeLiveSessionNotices({
      session: { publicSessionId: "czs_a" }, otherSessions: [], membership: "active", canEdit: true,
      sync: describeLiveSessionSync(elsewhere), autoGit: null, target: null,
    })
    expect(notices).toMatchObject([{ title: "Not syncing this folder", action: { label: "Open Workbench", run: "open_workbench" } }])
  })

  it("shows progress while the daemon connects or waits for the session key", () => {
    expect(describeLiveSessionSync({ ...ATTACHED, phase: "connecting", status: null })).toMatchObject({
      label: "Connecting…",
    })
    expect(describeLiveSessionSync({ ...ATTACHED, phase: "waiting_for_key", status: null })).toMatchObject({
      tone: "working",
      label: "Waiting for access",
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
    const notSetUp = "Saving to Git isn't set up for team/app."
    expect(
      describeAutoGit(daemonStatus({
        autoGit: autoGit({ state: "ineligible", leaderPrincipalId: null, detail: notSetUp, detailCode: "NOT_AUTHORIZED" }),
      })),
    ).toMatchObject({ tone: "attention", label: "Saving to Git isn't set up", detail: notSetUp, canSave: false })
    const lastError = { code: "REMOTE_UNREACHABLE", message: "Git couldn't reach origin: timed out." }
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "leader", isLeader: true, lastError }) }))?.detail).toBe(
      "The last save didn't finish (Git couldn't reach origin: timed out). It retries on its own.",
    )
  })

  it("offers Save now only where a Mac can push and the member may write", () => {
    expect(describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "no_leader", leaderPrincipalId: null }) }))?.canSave).toBe(false)
    expect(describeAutoGit(daemonStatus({ role: "viewer", autoGit: autoGit() }))?.canSave).toBe(false)
  })

  it("says why saving waits, and offers the fix a member can make", () => {
    const hold =
      ".env isn't ignored by Git, so saving the session to Git is on hold rather than commit it. Add it to .gitignore to resume."
    const held = autoGit({ state: "blocked", detail: hold, detailCode: "ENV_NOT_IGNORED" })
    expect(describeAutoGit(daemonStatus({ autoGit: held }))).toMatchObject({
      tone: "attention",
      label: "Git saves on hold",
      detail: hold,
      fix: "ignore_env",
    })
    expect(describeAutoGit(daemonStatus({ role: "viewer", autoGit: held }))?.fix).toBeNull()
    expect(
      describeAutoGit(daemonStatus({ autoGit: autoGit({ state: "blocked", detail: "Resolve…", detailCode: "CONFLICT_MARKERS" }) })),
    ).toMatchObject({ label: "Git saves wait on conflicts", fix: null })
  })
})

describe("how the header describes the branch the session merges into", () => {
  function target(overrides: Partial<ProjectdTargetStatus> = {}): ProjectdTargetStatus {
    return {
      branch: "main",
      behind: 0,
      ahead: 2,
      changedPathCount: 0,
      overlappingPaths: [],
      recommended: false,
      reason: null,
      checkedAt: new Date(2026, 8, 12, 9, 5).getTime(),
      checking: false,
      error: null,
      ...overrides,
    }
  }

  it("stays out of the bar until the target has been checked", () => {
    expect(describeTarget(null)).toBeNull()
    expect(describeTarget(target({ checkedAt: null }))).toBeNull()
    expect(describeTarget(target({ checkedAt: null, checking: true }))).toMatchObject({ label: "Checking main…" })
  })

  it("says how far the target moved, and explains a recommended rebase", () => {
    expect(describeTarget(target())).toMatchObject({ label: "Up to date with main", recommended: false })
    expect(describeTarget(target({ behind: 3 }))).toMatchObject({
      label: "main is 3 commits ahead",
      detail: null,
      recommended: false,
    })
    const reason = "main changed src/app.ts, which the session changed too."
    const view = describeTarget(target({ behind: 6, recommended: true, reason, overlappingPaths: ["src/app.ts"] }))
    expect(view).toMatchObject({
      label: "main is 6 commits ahead",
      detail: `Rebase recommended: ${reason}`,
      recommended: true,
    })
    expect(view?.title).toContain("Both changed: src/app.ts.")
  })

  it("shows why the check failed", () => {
    const error = "Git couldn't fetch main from origin: timed out"
    expect(describeTarget(target({ error }))).toMatchObject({ tone: "attention", label: "Couldn't check main", detail: error })
  })
})

describe("which live-session situations become toasts", () => {
  const LIVE = { tone: "live" as const, label: "Live", detail: null }
  const base = {
    session: { publicSessionId: "czs_a" },
    otherSessions: [],
    membership: "active" as const,
    canEdit: true,
    sync: LIVE,
    autoGit: null,
    target: null,
  }
  const autoGitView = { title: null, canSave: false, fix: null }

  it("stays quiet while the session is healthy", () => {
    expect(describeLiveSessionNotices(base)).toEqual([])
  })

  it("points at the session on another branch, with a way to switch", () => {
    const notices = describeLiveSessionNotices({
      ...base,
      session: null,
      sync: null,
      otherSessions: [{ publicSessionId: "czs_b", branchName: "feat/live" }],
    })
    expect(notices).toMatchObject([
      { key: "other:czs_b", title: "You're in the live session on feat/live", action: { run: "switch" } },
    ])
  })

  it("explains why saving to Git stopped, offering the fix only to members who can edit", () => {
    const envHold = {
      ...autoGitView, tone: "attention" as const, label: "Git saves on hold",
      detail: ".env isn't ignored.", fix: "ignore_env" as const,
    }
    expect(describeLiveSessionNotices({ ...base, autoGit: envHold })).toMatchObject([
      { type: "warning", title: "Git saves on hold", description: ".env isn't ignored.", action: { run: "ignore_env" } },
    ])
    expect(describeLiveSessionNotices({ ...base, canEdit: false, autoGit: envHold })[0]?.action).toBeNull()
    // A new reason is a new toast, so one the user closed doesn't hide the next.
    const notSetUp = { ...envHold, label: "Saving to Git isn't set up", detail: "Install the app.", fix: null }
    expect(describeLiveSessionNotices({ ...base, autoGit: notSetUp })[0]?.key)
      .not.toBe(describeLiveSessionNotices({ ...base, autoGit: envHold })[0]?.key)
  })

  it("offers the GitHub step that gets saving set up, and only to people who can link", () => {
    const notSetUp = {
      ...autoGitView, tone: "attention" as const, label: "Saving to Git isn't set up",
      detail: "Saving to Git isn't set up for Team/App.", needsGitHubSetup: true,
    }
    const repository: LiveSessionRepositoryStatus = {
      repository: { owner: "Team", name: "App" }, linked: false, installation: null, account: null, canLink: true,
    }
    const actionFor = (overrides: Partial<LiveSessionRepositoryStatus> | null) =>
      describeLiveSessionNotices({ ...base, autoGit: notSetUp, repository: overrides === null ? null : { ...repository, ...overrides } })[0]?.action

    expect(actionFor({})).toEqual({ label: "Install on GitHub", run: "github_link" })
    expect(actionFor({ account: { login: "team" } })).toEqual({ label: "Install on GitHub", run: "github_link" })
    // Someone else's account: they have to install it.
    expect(actionFor({ account: { login: "kel" } })).toEqual({ label: "Copy install link", run: "github_copy_link" })
    expect(actionFor({ account: { login: "kel" }, installation: { accountLogin: "Team" } }))
      .toEqual({ label: "Link repository", run: "github_link" })
    expect(actionFor({ canLink: false })).toBeNull()
    expect(actionFor(null)).toBeNull()

    // The toast says the next step in a line, not the daemon's full explanation.
    const descriptionFor = (overrides: Partial<LiveSessionRepositoryStatus> | null) =>
      describeLiveSessionNotices({ ...base, autoGit: notSetUp, repository: overrides === null ? null : { ...repository, ...overrides } })[0]?.description
    expect(descriptionFor({ account: { login: "kel" } })).toBe("Only Team can install the Cozea GitHub App. Send them the link.")
    expect(descriptionFor({})).toBe("Install the Cozea GitHub App on Team.")
    expect(descriptionFor({ installation: { accountLogin: "Team" } })).toBe("Link Team/App so this session can save to it.")
    expect(descriptionFor(null)).toBe("Saving to Git isn't set up for Team/App.")

    // Once the app is installed the way forward changes, and so does the toast.
    const before = describeLiveSessionNotices({ ...base, autoGit: notSetUp, repository: { ...repository, account: { login: "kel" } } })
    const after = describeLiveSessionNotices({
      ...base, autoGit: notSetUp, repository: { ...repository, account: { login: "kel" }, installation: { accountLogin: "Team" } },
    })
    expect(after[0]?.key).not.toBe(before[0]?.key)
  })

  it("leaves joining to the header's button, but says why a member's folder doesn't sync", () => {
    const notJoined = { tone: "idle" as const, label: "Not joined", detail: "Join to sync this folder with the session." }
    expect(describeLiveSessionNotices({ ...base, membership: "none", sync: notJoined })).toEqual([])
    const paused = { tone: "idle" as const, label: "Paused", detail: "Nothing syncs until it resumes." }
    expect(describeLiveSessionNotices({ ...base, sync: paused })).toMatchObject([{ type: "info", title: "Paused" }])
    const reconnecting = { tone: "working" as const, label: "Reconnecting…", detail: "Room went away" }
    expect(describeLiveSessionNotices({ ...base, sync: reconnecting })).toEqual([])
  })

  it("recommends a rebase once, and offers a retry when checking the target failed", () => {
    const targetView = { checking: false, title: null }
    expect(describeLiveSessionNotices({
      ...base,
      target: { ...targetView, tone: "working", label: "main is 3 commits ahead", detail: "Rebase recommended: both changed a.ts", recommended: true },
    })).toMatchObject([{ type: "info", dismissesTarget: true, action: null }])
    expect(describeLiveSessionNotices({
      ...base,
      target: { ...targetView, tone: "attention", label: "Couldn't check main", detail: "offline", recommended: false },
    })).toMatchObject([{ type: "warning", action: { run: "check_target" }, dismissesTarget: false }])
    expect(describeLiveSessionNotices({
      ...base,
      membership: "left",
      target: { ...targetView, tone: "attention", label: "Couldn't check main", detail: "offline", recommended: false },
    })).toEqual([])
  })
})
