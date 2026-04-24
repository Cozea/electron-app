import { describe, expect, it } from "vitest"

import {
  hasHostableWorkspaceRuntime,
  hasImmediateWorkspaceRuntimeHost,
  selectHostedWorkspaceRuntimeRecords,
} from "@/features/projects/workspaces/workspaceRuntimePolicy"
import type {
  WorkspaceRuntimeLifecycle,
  WorkspaceRuntimeRecord,
  WorkspaceRuntimeSignals,
} from "@/features/projects/workspaces/useWorkspaceRuntimeStore"

const baseSignals: WorkspaceRuntimeSignals = {
  hasConnectedCollab: false,
  hasSyncActivity: false,
  hasRunningTerminals: false,
  hasRunningDevServer: false,
  hasVisibleBrowserSurface: false,
  hasNativePreview: false,
  pendingSyncStatus: null,
  lastActivityAt: null,
  lifecycleReason: "test",
}

function createRuntime(
  workspaceId: string,
  input: {
    createdAt?: number
    lifecycle?: WorkspaceRuntimeLifecycle
    localPath?: string | null
    signals?: Partial<WorkspaceRuntimeSignals>
  } = {},
): WorkspaceRuntimeRecord {
  const createdAt = input.createdAt ?? 1
  return {
    workspaceId,
    config: {
      workspaceId,
      projectId: "project-id" as WorkspaceRuntimeRecord["config"]["projectId"],
      userId: "user-id" as WorkspaceRuntimeRecord["config"]["userId"],
      userName: "Test User",
      projectSlug: "project",
      laneId: "main",
      localPath: input.localPath === undefined ? `/tmp/${workspaceId}` : input.localPath,
      gitCwd: null,
      lastSyncAt: null,
      collaborationEnabled: true,
      activeBranch: "main",
      sharedBranch: "main",
      documentScopeId: "project-id",
    },
    syncContext: null,
    yjsContext: {} as WorkspaceRuntimeRecord["yjsContext"],
    routeAttachmentCount: input.lifecycle === "focused" ? 1 : 0,
    lifecycle: input.lifecycle ?? "background-warm",
    signals: {
      ...baseSignals,
      lastActivityAt: createdAt,
      ...input.signals,
    },
    sessionKey: null,
    sessionSnapshot: null,
    createdAt,
    lastAttachedAt: input.lifecycle === "focused" ? createdAt : null,
    lastDetachedAt: input.lifecycle === "focused" ? null : createdAt,
  }
}

describe("workspaceRuntimePolicy", () => {
  it("always hosts focused and critical background workspaces", () => {
    const selected = selectHostedWorkspaceRuntimeRecords([
      createRuntime("focused", { lifecycle: "focused", createdAt: 10 }),
      createRuntime("syncing", {
        lifecycle: "background-hot",
        createdAt: 9,
        signals: { hasSyncActivity: true },
      }),
      createRuntime("terminal", {
        lifecycle: "background-hot",
        createdAt: 8,
        signals: { hasRunningTerminals: true },
      }),
      createRuntime("devserver", {
        lifecycle: "background-hot",
        createdAt: 7,
        signals: { hasRunningDevServer: true },
      }),
      createRuntime("native-preview", {
        lifecycle: "background-hot",
        createdAt: 6,
        signals: { hasNativePreview: true },
      }),
    ])

    expect(selected.map((record) => record.workspaceId)).toEqual([
      "focused",
      "syncing",
      "terminal",
      "devserver",
      "native-preview",
    ])
  })

  it("caps passive warm hosts to the most recent workspaces", () => {
    const selected = selectHostedWorkspaceRuntimeRecords([
      createRuntime("warm-old", { createdAt: 1 }),
      createRuntime("warm-mid", { createdAt: 2 }),
      createRuntime("warm-new", { createdAt: 3 }),
    ])

    expect(selected.map((record) => record.workspaceId)).toEqual(["warm-mid", "warm-new"])
  })

  it("caps passive collaboration and browser hosts without dropping critical work", () => {
    const selected = selectHostedWorkspaceRuntimeRecords([
      createRuntime("critical-terminal", {
        createdAt: 1,
        lifecycle: "background-hot",
        signals: { hasRunningTerminals: true },
      }),
      createRuntime("collab-old", {
        createdAt: 2,
        lifecycle: "background-hot",
        signals: { hasConnectedCollab: true },
      }),
      createRuntime("collab-mid", {
        createdAt: 3,
        lifecycle: "background-hot",
        signals: { hasConnectedCollab: true },
      }),
      createRuntime("collab-new", {
        createdAt: 4,
        lifecycle: "background-hot",
        signals: { hasConnectedCollab: true },
      }),
      createRuntime("browser-old", {
        createdAt: 5,
        signals: { hasVisibleBrowserSurface: true },
      }),
      createRuntime("browser-mid", {
        createdAt: 6,
        signals: { hasVisibleBrowserSurface: true },
      }),
      createRuntime("browser-new", {
        createdAt: 7,
        signals: { hasVisibleBrowserSurface: true },
      }),
    ])

    expect(selected.map((record) => record.workspaceId)).toEqual([
      "critical-terminal",
      "collab-mid",
      "collab-new",
      "browser-mid",
      "browser-new",
    ])
  })

  it("does not host closed, frozen, or unbound workspaces", () => {
    const records = [
      createRuntime("closed", { lifecycle: "closed" }),
      createRuntime("frozen", { lifecycle: "background-frozen" }),
      createRuntime("missing-path", { localPath: null }),
    ]

    expect(selectHostedWorkspaceRuntimeRecords(records)).toEqual([])
    expect(hasHostableWorkspaceRuntime(records)).toBe(false)
  })

  it("treats focused and critical workspaces as immediate hosts", () => {
    expect(
      hasImmediateWorkspaceRuntimeHost([
        createRuntime("warm", { lifecycle: "background-warm" }),
      ]),
    ).toBe(false)
    expect(
      hasImmediateWorkspaceRuntimeHost([
        createRuntime("focused", { lifecycle: "focused" }),
      ]),
    ).toBe(true)
    expect(
      hasImmediateWorkspaceRuntimeHost([
        createRuntime("terminal", {
          lifecycle: "background-hot",
          signals: { hasRunningTerminals: true },
        }),
      ]),
    ).toBe(true)
  })
})
