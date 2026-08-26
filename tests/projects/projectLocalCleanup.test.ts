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
  const deleteProject = vi.fn()
  const forget = vi.fn()
  const listForProject = vi.fn()
  const listSessions = vi.fn()
  const closeSession = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    deleteProject.mockResolvedValue({ success: true })
    forget.mockResolvedValue(undefined)
    listSessions.mockResolvedValue([])
    closeSession.mockResolvedValue(undefined)
    listForProject.mockResolvedValue([
      {
        workspaceId: "workspace_1",
        projectRootPath: "/tmp/cozea-projects/demo",
      },
    ])

    Object.assign(globalThis, {
      window: {
        electronAPI: {
          settings: {
            get: vi.fn().mockResolvedValue({ projectsDirectory: "/tmp/cozea-projects" }),
          },
          workbenchSession: {
            listSessions,
            closeSession,
          },
          storage: {
            deleteProject,
          },
          workspace: {
            listForProject,
            forget,
          },
        },
      },
    })
  })

  it("keeps local folders when keepLocalFiles is true", async () => {
    const { cleanupDeletedProjectLocally } = await import(
      "../../src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", {
      projectName: "Demo",
      projectSlug: "demo",
      managedProjectPaths: ["/tmp/cozea-projects/demo"],
      keepLocalFiles: true,
    })

    expect(deleteProject).not.toHaveBeenCalled()
    expect(forget).toHaveBeenCalledWith("workspace_1")
  })

  it("trashes local folders when keepLocalFiles is false", async () => {
    const { cleanupDeletedProjectLocally } = await import(
      "../../src/features/projects/lib/projectLocalCleanup"
    )

    await cleanupDeletedProjectLocally("project_1", {
      projectName: "Demo",
      projectSlug: "demo",
      managedProjectPaths: ["/tmp/cozea-projects/demo"],
      keepLocalFiles: false,
    })

    expect(deleteProject).toHaveBeenCalledWith({
      projectPath: "/tmp/cozea-projects/demo",
    })
    expect(forget).toHaveBeenCalledWith("workspace_1")
  })
})
