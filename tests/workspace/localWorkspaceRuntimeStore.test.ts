import { beforeEach, describe, expect, it } from "vitest"

import type { Id } from "../../convex/_generated/dataModel"
import type { WorkbenchSessionSnapshot } from "../../shared/electronApiTypes"
import { useWorkspaceRuntimeStore, type WorkspaceRuntimeConfig } from "@/lib/workspaceRuntimeStore"
import { selectHostedWorkspaceRuntimeRecords } from "@/features/workspace/workspaceRuntimePolicy"

function config(): WorkspaceRuntimeConfig {
  return { projectId: "lpj_" + "a".repeat(32), cloudProjectId: null, cloudActivityEnabled: false,
    principalId: null, displayName: "Local device", workspaceId: "ws_local", workspaceRevision: 1,
    projectSlug: "personal", laneId: "main", gitCwd: "/fixture/personal", lastSyncAt: null,
    collaborationEnabled: false, activeBranch: "main", sharedBranch: "main", documentScopeId: null }
}
function session(input: WorkspaceRuntimeConfig): WorkbenchSessionSnapshot {
  return { sessionKey: "retained-session", projectId: input.projectId!, laneId: input.laneId,
    workspaceId: input.workspaceId, workspaceRevision: 1, lifecycle: "backgroundWarm", pinned: false,
    openedAt: 1, lastFocusedAt: 1, lastBackgroundedAt: 1, terminalBindings: { tile: "pty-1" },
    devServer: { running: true, port: 5173, runId: "run-1" }, hasBrowserSurface: true }
}

beforeEach(() => useWorkspaceRuntimeStore.setState({ runtimes: {}, suppressedProjectIds: {} }))

describe("local workspace runtime retention", () => {
  it("updates cloud association without replacing the retained runtime, PTY or session", () => {
    const input = config()
    const actions = useWorkspaceRuntimeStore.getState().actions
    const runtimeId = actions.ensureRuntime(input)!
    actions.attachRuntime(runtimeId)
    const retained = session(input)
    actions.bindSessionSnapshot(runtimeId, retained)
    const promotedId = actions.ensureRuntime({ ...input, cloudProjectId: "project_shared" as Id<"projects">,
      principalId: "principal" as Id<"devicePrincipals">, cloudActivityEnabled: true })
    expect(promotedId).toBe(runtimeId)
    const record = useWorkspaceRuntimeStore.getState().runtimes[runtimeId]
    expect(Object.keys(useWorkspaceRuntimeStore.getState().runtimes)).toEqual([runtimeId])
    expect(record.routeAttachmentCount).toBe(1)
    expect(record.sessionSnapshot).toBe(retained)
    expect(record.sessionKey).toBe("retained-session")
    expect(record.config.projectId).toBe(input.projectId)
    actions.detachRuntime(runtimeId)
    expect(selectHostedWorkspaceRuntimeRecords([useWorkspaceRuntimeStore.getState().runtimes[runtimeId]])).toHaveLength(1)
  })

  it("does not rewrite runtime state for equivalent absent cloud options", () => {
    const actions = useWorkspaceRuntimeStore.getState().actions
    const input = config()
    actions.ensureRuntime(input)
    const before = useWorkspaceRuntimeStore.getState()
    const { cloudProjectId: _cloud, cloudActivityEnabled: _activity, ...legacyOptions } = input
    actions.ensureRuntime(legacyOptions)
    expect(useWorkspaceRuntimeStore.getState()).toBe(before)
  })
})
