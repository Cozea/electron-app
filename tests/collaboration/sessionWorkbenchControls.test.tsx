import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { LiveSessionMember } from "@/features/collaboration/live/liveSessionModel"
import {
  SessionBranchNotice,
  SessionWorkbenchControls,
} from "@/features/collaboration/live/SessionWorkbenchControls"

const noop = () => {}
const LIVE = { tone: "live" as const, label: "Live", detail: null }
const MEMBERS: LiveSessionMember[] = [
  { principalId: "p1", displayName: "Kel MacBook", role: "project_manager", status: "active", isSelf: true },
  { principalId: "p2", displayName: "Sam Rivera", role: "developer", status: "active", isSelf: false },
  { principalId: "p3", displayName: "Former Member", role: "developer", status: "left", isSelf: false },
]
const HANDLERS = { onJoin: noop, onLeave: noop, onPause: noop, onResume: noop, onEnd: noop }

describe("P23 session bar", () => {
  it("shows a session manager the branch, sync state, people in the session and their controls", () => {
    const markup = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="ACTIVE"
        sync={LIVE}
        members={MEMBERS}
        membership="active"
        canManage
        {...HANDLERS}
      />,
    )
    expect(markup).toContain("feature/live")
    expect(markup).toContain(">Live<")
    expect(markup).toContain('aria-label="Sam Rivera, developer"')
    expect(markup).toContain('aria-label="Kel MacBook (this device), project manager"')
    expect(markup).not.toContain("Former Member")
    for (const action of [">Pause<", ">Leave<", ">End<"]) expect(markup).toContain(action)
    expect(markup).not.toContain("Join session")
    expect(markup).not.toContain(">Resume<")
  })

  it("offers someone outside the session only the join action, with the reason nothing syncs", () => {
    const markup = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="ACTIVE"
        sync={{ tone: "idle", label: "Not joined", detail: "Join to sync this folder with the session." }}
        members={MEMBERS}
        membership="none"
        canManage={false}
        {...HANDLERS}
      />,
    )
    expect(markup).toContain("Join session")
    expect(markup).toContain("Join to sync this folder with the session.")
    for (const action of [">Pause<", ">Leave<", ">End<"]) expect(markup).not.toContain(action)
  })

  it("offers rejoin after leaving, and resume on a paused session", () => {
    const left = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="ACTIVE"
        sync={LIVE}
        members={MEMBERS}
        membership="left"
        canManage={false}
        {...HANDLERS}
      />,
    )
    expect(left).toContain(">Rejoin<")

    const paused = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="PAUSED"
        sync={{ tone: "idle", label: "Paused", detail: null }}
        members={MEMBERS}
        membership="active"
        canManage
        {...HANDLERS}
      />,
    )
    expect(paused).toContain(">Resume<")
    expect(paused).not.toContain(">Pause<")
  })

  it("shows why the folder stopped syncing", () => {
    const markup = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="ACTIVE"
        sync={{ tone: "attention", label: "Stopped syncing", detail: "2 files differ from the session." }}
        members={MEMBERS}
        membership="active"
        canManage={false}
        {...HANDLERS}
      />,
    )
    expect(markup).toContain("Stopped syncing")
    expect(markup).toMatch(/class="[^"]*text-destructive[^"]*">2 files differ from the session\.</)
  })

  it("offers to add env files to .gitignore when saving waits on them, to members who can edit", () => {
    const autoGit = {
      tone: "attention" as const,
      label: "Git saves on hold",
      detail: ".env is not ignored by Git, so saving is on hold.",
      title: null,
      canSave: true,
      fix: "ignore_env" as const,
    }
    const props = {
      branchName: "feature/live",
      targetBranch: "main",
      lifecycle: "ACTIVE",
      sync: LIVE,
      autoGit,
      members: MEMBERS,
      membership: "active" as const,
      canManage: false,
      onIgnoreEnvironmentFiles: noop,
      ...HANDLERS,
    }
    expect(renderToStaticMarkup(<SessionWorkbenchControls {...props} canEdit />)).toContain("Add to .gitignore")
    expect(renderToStaticMarkup(<SessionWorkbenchControls {...props} canEdit={false} />)).not.toContain("Add to .gitignore")
  })

  it("says how far the branch the session merges into moved, with a check and a dismissal", () => {
    const markup = renderToStaticMarkup(
      <SessionWorkbenchControls
        branchName="feature/live"
        targetBranch="main"
        lifecycle="ACTIVE"
        sync={LIVE}
        members={MEMBERS}
        membership="active"
        canManage={false}
        target={{
          label: "main is 6 commits ahead",
          detail: "Rebase recommended: main changed src/app.ts, which the session changed too.",
          recommended: true,
          tone: "working",
          checking: false,
          title: null,
        }}
        onCheckTarget={noop}
        onDismissTarget={noop}
        {...HANDLERS}
      />,
    )
    expect(markup).toContain("main is 6 commits ahead · Rebase recommended: main changed src/app.ts")
    expect(markup).toContain(">Check main<")
    expect(markup).toContain(">Dismiss<")
  })

  it("offers explicit rebase and merge controls only to active members who can edit a saved session", () => {
    const props = {
      branchName: "feature/live",
      targetBranch: "main",
      lifecycle: "ACTIVE",
      sync: LIVE,
      autoGit: {
        tone: "live" as const,
        label: "Saved to Git",
        detail: null,
        title: null,
        canSave: true,
        fix: null,
      },
      members: MEMBERS,
      membership: "active" as const,
      canManage: false,
      onRebase: noop,
      onMerge: noop,
      ...HANDLERS,
    }
    const editor = renderToStaticMarkup(<SessionWorkbenchControls {...props} canEdit />)
    expect(editor).toContain("Rebase…")
    expect(editor).toContain("Merge…")

    const viewer = renderToStaticMarkup(<SessionWorkbenchControls {...props} canEdit={false} />)
    expect(viewer).not.toContain("Rebase…")
    expect(viewer).not.toContain("Merge…")
  })

  it("points a member at their session on another branch", () => {
    const markup = renderToStaticMarkup(<SessionBranchNotice branchName="feature/live" onSwitch={noop} />)
    expect(markup).toContain("feature/live")
    expect(markup).toContain("Switch branch")
  })
})
