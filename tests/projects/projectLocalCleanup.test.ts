import { beforeEach, describe, expect, it, vi } from "vitest"

const closeRuntime = vi.fn()

vi.mock("@/features/projects/workspaces/useWorkspaceRuntimeStore", () => ({
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
      },
      actions: {
        closeRuntime,
      },
    }),
  },
}))

vi.mock("@/features/projects/hooks/useProjectLaneState", () => ({
  clearCachedProjectLaneState: vi.fn(),
}))

vi.mock("@/features/projects/lib/projectBranchSessionStore", () => ({
  clearProjectBranchSession: vi.fn(),
}))

describe("cleanupDeletedProjectLocally", () => {
  const trashManagedWorkspace = vi.fn()
  const forget = vi.fn()
  const listForProject = vi.fn()
  const listSessions = vi.fn()
  const closeSession = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    trashManagedWorkspace.mockResolvedValue({ success: true, movedToTrash: true })
    forget.mockResolvedValue(undefined)
    listSessions.mockResolvedValue([])
    closeSession.mockResolvedValue(undefined)
    listForProject.mockResolvedValue([
      {
        workspaceId: "workspace_1",
        projectRootPath: "/tmp/cozea-projects/demo",
        storageOwnership: "managed",
      },
    ])

    Object.assign(globalThis, {
      window: {
        electronAPI: {
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

  it("keeps local folders when keepLocalFiles is true", async () => {
    const { cleanupDeletedProjectLocally } = await import(
      "../../apps/desktop/src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", {
      keepLocalFiles: true,
    })

    expect(trashManagedWorkspace).not.toHaveBeenCalled()
    expect(forget).toHaveBeenCalledWith("workspace_1")
  })

  it("trashes local folders when keepLocalFiles is false", async () => {
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
