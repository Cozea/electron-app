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

  it("points a member at their session on another branch", () => {
    const markup = renderToStaticMarkup(<SessionBranchNotice branchName="feature/live" onSwitch={noop} />)
    expect(markup).toContain("feature/live")
    expect(markup).toContain("Switch branch")
  })
})
