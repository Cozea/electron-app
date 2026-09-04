import { describe, expect, it } from "vitest"

import {
  isSidebarActivityLive,
  mergeSidebarActivity,
  resolveAgentActivity,
  resolveDevServerActivity,
  resolveProjectRowActivity,
  resolveTerminalActivity,
  type SidebarActivity,
} from "@/features/projects/components/sidebar/sidebarActivity"
import { createProjectAgentsActivitySelector } from "@/features/projects/components/sidebar/sidebarActivitySelectors"

describe("sidebar activity engine", () => {
  describe("what counts as executing", () => {
    it("treats a live dev server as running and a stopped one as idle", () => {
      expect(resolveDevServerActivity("starting")).toBe("starting")
      expect(resolveDevServerActivity("ready")).toBe("running")
      // Unhealthy still has a live process behind it.
      expect(resolveDevServerActivity("unhealthy")).toBe("running")

      expect(resolveDevServerActivity("idle")).toBe("idle")
      expect(resolveDevServerActivity("stopped")).toBe("idle")
      expect(resolveDevServerActivity("error")).toBe("idle")
      expect(resolveDevServerActivity(undefined)).toBe("idle")
    })

    it("treats a running agent turn as running and a settled one as idle", () => {
      const gates = { hasPendingApprovals: false, hasPendingUserInput: false }
      expect(resolveAgentActivity({ sessionStatus: "running", ...gates })).toBe("running")
      expect(resolveAgentActivity({ sessionStatus: "connecting", ...gates })).toBe("starting")

      expect(resolveAgentActivity({ sessionStatus: "ready", ...gates })).toBe("idle")
      expect(resolveAgentActivity({ sessionStatus: "stopped", ...gates })).toBe("idle")
      expect(resolveAgentActivity({ sessionStatus: "error", ...gates })).toBe("idle")
      expect(resolveAgentActivity({ sessionStatus: null, ...gates })).toBe("idle")
    })

    it("treats an agent parked on the user as idle even while the session says running", () => {
      // The provider session stays `running` across an approval prompt, so the
      // gates have to win — otherwise a collapsed project row animates while the
      // expanded tile row shows a static 'Pending Approval' dot.
      expect(
        resolveAgentActivity({
          sessionStatus: "running",
          hasPendingApprovals: true,
          hasPendingUserInput: false,
        }),
      ).toBe("idle")

      expect(
        resolveAgentActivity({
          sessionStatus: "running",
          hasPendingApprovals: false,
          hasPendingUserInput: true,
        }),
      ).toBe("idle")
    })

    it("treats a shell at its prompt as idle and one with a foreground process as running", () => {
      expect(
        resolveTerminalActivity({ hasRunningSubprocess: false, isSessionAlive: true }),
      ).toBe("idle")
      expect(
        resolveTerminalActivity({ hasRunningSubprocess: true, isSessionAlive: true }),
      ).toBe("running")
      expect(
        resolveTerminalActivity({ hasRunningSubprocess: true, isSessionAlive: false }),
      ).toBe("idle")
    })
  })

  describe("merging a lane's tiles", () => {
    it("is idle only when every tile is idle", () => {
      expect(mergeSidebarActivity([])).toBe("idle")
      expect(mergeSidebarActivity(["idle", "idle", "idle"])).toBe("idle")
    })

    it("lets the loudest tile win", () => {
      expect(mergeSidebarActivity(["idle", "starting"])).toBe("starting")
      expect(mergeSidebarActivity(["idle", "running"])).toBe("running")
      expect(mergeSidebarActivity(["starting", "running"])).toBe("running")
      expect(mergeSidebarActivity(["running", "starting", "idle"])).toBe("running")
    })
  })

  describe("modalities", () => {
    const laneWith = (...tiles: SidebarActivity[]) => mergeSidebarActivity(tiles)

    it("modality 1: nothing running means no animation anywhere", () => {
      const projectActivity = laneWith("idle", "idle")
      expect(isSidebarActivityLive(projectActivity)).toBe(false)

      for (const isExpanded of [true, false]) {
        expect(
          isSidebarActivityLive(
            resolveProjectRowActivity({ isExpanded, projectActivity, visibleActivity: "idle" }),
          ),
        ).toBe(false)
      }
    })

    it("modality 2: expanded, the tile rows animate and the project row does not", () => {
      const projectActivity = laneWith("idle", "running")
      expect(
        resolveProjectRowActivity({
          isExpanded: true,
          projectActivity,
          visibleActivity: "running",
        }),
      ).toBe("idle")
      // The tile rows read their own activity, which is unaffected by expansion.
      expect(isSidebarActivityLive("running")).toBe(true)
    })

    it("modality 3: collapsed, the project row stands in for its tiles", () => {
      expect(
        resolveProjectRowActivity({
          isExpanded: false,
          projectActivity: laneWith("idle", "running"),
          visibleActivity: "idle",
        }),
      ).toBe("running")
      expect(
        resolveProjectRowActivity({
          isExpanded: false,
          projectActivity: laneWith("starting"),
          visibleActivity: "idle",
        }),
      ).toBe("starting")
    })

    it("keeps carrying work the expanded rows cannot show, such as another lane", () => {
      // The sidebar renders only the active lane, so work elsewhere has no row
      // of its own — expanding must not make the signal disappear.
      expect(
        resolveProjectRowActivity({
          isExpanded: true,
          projectActivity: "running",
          visibleActivity: "idle",
        }),
      ).toBe("running")
    })

    it("animates the project row for a process of any kind, not just agents", () => {
      const cases: Array<[string, SidebarActivity]> = [
        ["agent", resolveAgentActivity({ sessionStatus: "running", hasPendingApprovals: false, hasPendingUserInput: false })],
        ["dev server", resolveDevServerActivity("ready")],
        ["terminal", resolveTerminalActivity({ hasRunningSubprocess: true, isSessionAlive: true })],
      ]

      for (const [label, activity] of cases) {
        const rowActivity = resolveProjectRowActivity({
          isExpanded: false,
          projectActivity: mergeSidebarActivity(["idle", activity]),
          visibleActivity: "idle",
        })
        expect(isSidebarActivityLive(rowActivity), `${label} should animate the row`).toBe(true)
      }
    })
  })
})

describe("project-scoped agent activity", () => {
  // Only the fields createAssistantThreadSelectorById reads to assemble a thread.
  const stateWith = (
    threadIdsByProjectId: Record<string, string[]>,
    sessions: Record<string, string>,
    projectIdByCwd: Record<string, string> = {},
  ) =>
    ({
      projectIdByCwd,
      threadIdsByProjectId,
      threadShellById: Object.fromEntries(
        Object.keys(sessions).map((id) => [id, { id, projectId: "p1" }]),
      ),
      threadSessionById: Object.fromEntries(
        Object.entries(sessions).map(([id, status]) => [id, { status }]),
      ),
      threadTurnStateById: {},
      messageIdsByThreadId: {},
      messageByThreadId: {},
      activityIdsByThreadId: {},
      activityByThreadId: {},
      proposedPlanIdsByThreadId: {},
      proposedPlanByThreadId: {},
      turnDiffIdsByThreadId: {},
      turnDiffSummaryByThreadId: {},
    }) as never

  it("reports a project's running agent without any lane state", () => {
    // The regression this guards: resolving through the active lane made every
    // unfocused project read idle, so only one row could animate at a time.
    const selector = createProjectAgentsActivitySelector({ projectId: "p1", workspaceId: null })
    expect(selector(stateWith({ p1: ["t1"] }, { t1: "running" }))).toBe("running")
  })

  it("stays idle for a project whose threads are all settled", () => {
    const selector = createProjectAgentsActivitySelector({ projectId: "p1", workspaceId: null })
    expect(selector(stateWith({ p1: ["t1", "t2"] }, { t1: "ready", t2: "stopped" }))).toBe("idle")
  })

  it("does not report another project's running agent", () => {
    const selector = createProjectAgentsActivitySelector({ projectId: "p2", workspaceId: null })
    expect(selector(stateWith({ p1: ["t1"] }, { t1: "running" }))).toBe("idle")
  })

  it("resolves the assistant's own project id from the workspace path", () => {
    // The assistant store keys projects by cwd, not by the sidebar's Convex
    // project id. Looking up the Convex id directly finds no threads at all, so
    // the project row silently stopped shimmering for agent work.
    const selector = createProjectAgentsActivitySelector({
      projectId: "convex_abc",
      workspaceId: "/Users/me/code/app",
    })

    expect(
      selector(
        stateWith(
          { assistant_p1: ["t1"] },
          { t1: "running" },
          { "/Users/me/code/app": "assistant_p1" },
        ),
      ),
    ).toBe("running")
  })

  it("falls back to the given id when the workspace has no mapping yet", () => {
    const selector = createProjectAgentsActivitySelector({
      projectId: "p1",
      workspaceId: "/not/mapped",
    })
    expect(selector(stateWith({ p1: ["t1"] }, { t1: "running" }))).toBe("running")
  })
})
