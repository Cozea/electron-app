import { beforeEach, describe, expect, it, vi } from "vitest"

const clearCachedProjectLaneState = vi.fn()
const clearDrafts = vi.fn()
const clearLastWorkbenchRoutesForProject = vi.fn()
const clearPersistedProjectSidebarEntry = vi.fn()
const clearPersistedWorkbenchLayoutsForProject = vi.fn()
const clearProjectBranchSession = vi.fn()
const clearRecentProjectOpenSync = vi.fn()
const clearSyncFeedSeen = vi.fn()
const closeRuntime = vi.fn()
const collectAssistantProjectIdsForDeletion = vi.fn(() => ["assistant-project-1"])
const deleteAssistantProjectsForDeletedWorkspace = vi.fn(async () => undefined)
const releaseDevServerSurfaceLease = vi.fn()
const removeLocalProjectDevApp = vi.fn()
const removeProjectWorkbench = vi.fn()
const resetDevServerRuns = vi.fn()
const resetTerminalProject = vi.fn()
const resetThread = vi.fn()
const clearQueryCache = vi.fn()
const removeProjectDrafts = vi.fn(async () => undefined)
const forgetHistoryProject = vi.fn()

vi.mock("@/features/assistant/history/assistantDraftRepository", () => ({
  assistantDrafts: { removeProject: removeProjectDrafts, load: async () => {}, store: { getState: () => ({ drafts: {} }) } },
}))
vi.mock("@/features/assistant/history/assistantHistoryStore", () => ({
  useAssistantHistoryStore: { getState: () => ({ projects: {}, conversations: {}, forgetProject: forgetHistoryProject }) },
}))

vi.mock("@/features/devapps/localProjectDevAppStore", () => ({
  removeLocalProjectDevApp,
}))

vi.mock("@/features/assistant/chat/composerDraftStore", () => ({
  useAssistantComposerDraftStore: {
    getState: () => ({ clearDrafts }),
  },
}))

vi.mock("@/features/projects/ui/sidebar/projectSidebarState", () => ({
  clearPersistedProjectSidebarEntry,
}))

vi.mock("@/features/dev-server/devServerRunStore", () => ({
  clearDevServerRunsForWorkspace: resetDevServerRuns,
}))

vi.mock("@/features/dev-server/devServerSurfaceController", () => ({
  releaseDevServerSurfaceLease,
}))

vi.mock("@/features/workbench/hooks/useProjectLaneState", () => ({
  clearCachedProjectLaneState,
}))

vi.mock("@/features/assistant/services/assistantProjectDeletion", () => ({
  collectAssistantProjectIdsForDeletion,
  deleteAssistantProjectsForDeletedWorkspace,
}))

vi.mock("@/features/workbench/model/lastWorkbenchRoute", () => ({
  clearLastWorkbenchRoutesForProject,
}))

vi.mock("@/features/source-control/model/projectBranchSessionStore", () => ({
  clearProjectBranchSession,
}))

vi.mock("@/features/projects/lib/recentProjectOpenSync", () => ({
  clearRecentProjectOpenSync,
}))

vi.mock("@/features/workbench/model/workbenchLayoutPersistence", () => ({
  clearPersistedWorkbenchLayoutsForProject,
}))

vi.mock("@/features/source-control/syncFeedSeen", () => ({
  clearSyncFeedSeen,
}))

vi.mock("@/lib/workspaceRuntimeStore", () => ({
  useWorkspaceRuntimeStore: {
    getState: () => ({
      runtimes: {
        "runtime-1": {
          runtimeId: "runtime-1",
          config: {
            projectId: "project_1",
            workspaceId: "workspace_1",
          },
        },
        "runtime-unbound": {
          runtimeId: "runtime-unbound",
          config: {
            projectId: "project_1",
            workspaceId: null,
          },
        },
        "runtime-other": {
          runtimeId: "runtime-other",
          config: {
            projectId: "project_2",
            workspaceId: "workspace_2",
          },
        },
      },
      actions: {
        closeRuntime,
      },
    }),
  },
}))

const mockWorkbenchStore = {
  useProjectWorkbenchStore: {
    getState: () => ({
      workbenches: {
        "project_1::lane-1::workspace_1": {
          projectId: "project_1",
          workspaceId: "workspace_1",
          laneId: "lane-1",
          tiles: {
            "assistant-tile-1": {
              id: "assistant-tile-1",
              type: "assistantChat",
              assistantProjectId: "assistant-project-1",
              threadId: "thread-1",
            },
            "dev-server-tile-1": {
              id: "dev-server-tile-1",
              type: "devServer",
            },
          },
        },
      },
      actions: { removeProject: removeProjectWorkbench },
    }),
  },
}

vi.mock("@/lib/workbenchStore", () => mockWorkbenchStore)
vi.mock("@/lib/workbenchStore", () => mockWorkbenchStore)

vi.mock("@/app/model/queryCache", () => ({
  useQueryCache: {
    getState: () => ({ clear: clearQueryCache }),
  },
}))

vi.mock("@/features/terminal/model/terminalStore", () => ({
  useTerminalStore: {
    getState: () => ({ actions: { resetProject: resetTerminalProject } }),
  },
}))

vi.mock("@/features/assistant/model/threadDetailStore", () => ({
  useThreadDetailStore: {
    getState: () => ({ resetThread }),
  },
}))

describe("cleanupDeletedProjectLocally", () => {
  const trashManagedWorkspace = vi.fn()
  const forget = vi.fn()
  const listForProject = vi.fn()
  const listSessions = vi.fn()
  const closeSession = vi.fn()
  const stopDevServer = vi.fn()
  const removeLocalStorageItem = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    trashManagedWorkspace.mockResolvedValue({ success: true, movedToTrash: true })
    forget.mockResolvedValue(undefined)
    closeSession.mockResolvedValue({ success: true })
    stopDevServer.mockResolvedValue({ success: true })
    listSessions.mockResolvedValue([
      {
        sessionKey: "session-bound",
        projectId: "project_1",
        laneId: "lane-1",
        workspaceId: "workspace_1",
      },
      {
        sessionKey: "session-unbound",
        projectId: "project_1",
        laneId: "collab",
        workspaceId: null,
      },
      {
        sessionKey: "session-other",
        projectId: "project_2",
        laneId: "collab",
        workspaceId: "workspace_2",
      },
    ])
    listForProject.mockResolvedValue([
      {
        workspaceId: "workspace_1",
        projectRootPath: "/tmp/cozea-projects/demo",
        storageOwnership: "managed",
      },
    ])

    Object.assign(globalThis, {
      window: {
        localStorage: {
          removeItem: removeLocalStorageItem,
        },
        electronAPI: {
          devServer: {
            stop: stopDevServer,
          },
          workbenchSession: {
            listSessions,
            closeSession,
          },
          workspace: {
            listForProject,
            forget,
            trashManagedWorkspace,
          },
        },
      },
    })
  })

  it("keeps attached state on disk while removing every app-owned project record", async () => {
    const { cleanupDeletedProjectLocally } = await import(
      "../../apps/desktop/src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", {
      keepLocalFiles: true,
      projectSlug: "demo",
    })

    expect(trashManagedWorkspace).not.toHaveBeenCalled()
    expect(forget).toHaveBeenCalledWith("workspace_1")
    expect(stopDevServer).toHaveBeenCalledWith({ workspaceId: "workspace_1", laneId: "lane-1" })
    expect(stopDevServer).toHaveBeenCalledWith({ workspaceId: "workspace_1", laneId: "collab" })
    expect(closeSession).toHaveBeenCalledTimes(2)
    expect(closeSession).toHaveBeenCalledWith(expect.objectContaining({ sessionKey: "session-unbound" }))
    expect(closeRuntime).toHaveBeenCalledWith("runtime-1")
    expect(closeRuntime).toHaveBeenCalledWith("runtime-unbound")
    expect(closeRuntime).not.toHaveBeenCalledWith("runtime-other")
    expect(deleteAssistantProjectsForDeletedWorkspace).toHaveBeenCalledWith({
      assistantProjectIds: ["assistant-project-1"],
      workspaceRoots: new Set(["/tmp/cozea-projects/demo"]),
    })
    expect(clearDrafts).toHaveBeenCalledWith([
      "assistant-tile-1",
      "dev-server-tile-1",
      "thread-1",
    ])
    expect(resetThread).toHaveBeenCalledWith("thread-1")
    expect(removeProjectWorkbench).toHaveBeenCalledWith("project_1")
    expect(removeProjectDrafts).toHaveBeenCalledWith("project_1")
    expect(forgetHistoryProject).toHaveBeenCalledWith("project_1")
    expect(clearPersistedWorkbenchLayoutsForProject).toHaveBeenCalledWith("project_1")
    expect(removeLocalProjectDevApp).toHaveBeenCalledWith("project_1")
    expect(clearPersistedProjectSidebarEntry).toHaveBeenCalledWith("project_1")
    expect(clearLastWorkbenchRoutesForProject).toHaveBeenCalledWith("project_1")
    expect(clearRecentProjectOpenSync).toHaveBeenCalledWith("project_1")
    expect(clearSyncFeedSeen).toHaveBeenCalledWith("demo")
    expect(resetDevServerRuns).toHaveBeenCalledWith("workspace_1")
    expect(resetTerminalProject).toHaveBeenCalledWith("workspace_1")
    expect(clearQueryCache).toHaveBeenCalled()
  })

  it("trashes only managed folders when local file removal is selected", async () => {
    const { cleanupDeletedProjectLocally } = await import(
      "../../apps/desktop/src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", {
      keepLocalFiles: false,
    })

    expect(trashManagedWorkspace).toHaveBeenCalledWith("workspace_1")
    expect(forget).toHaveBeenCalledWith("workspace_1")
  })

  it("never trashes an attached folder", async () => {
    listForProject.mockResolvedValueOnce([
      {
        workspaceId: "workspace_attached",
        projectRootPath: "/tmp/cozea-projects/user-owned",
        storageOwnership: "attached",
      },
    ])
    const { cleanupDeletedProjectLocally } = await import(
      "../../apps/desktop/src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", { keepLocalFiles: false })

    expect(trashManagedWorkspace).not.toHaveBeenCalled()
    expect(forget).toHaveBeenCalledWith("workspace_attached")
  })
})
