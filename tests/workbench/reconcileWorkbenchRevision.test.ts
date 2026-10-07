import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SerializedDockview } from "dockview-react"
import type { LocalProjectId, ProjectOperationDTO } from "../../shared/localProjectTypes"
import { desktopPersistenceClient } from "@/app/model/persistence/desktopPersistenceClient"
import { useProjectWorkbenchStore, selectProjectWorkbench } from "@/lib/workbenchStore"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import { reconcileWorkbenchRevision } from "@/features/workbench/model/reconcileWorkbenchRevision"
import { peekPersistedWorkbenchLayout, writePersistedWorkbenchLayout } from "@/features/workbench/model/workbenchLayoutPersistence"

vi.mock("@/app/model/persistence/desktopPersistenceClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/model/persistence/desktopPersistenceClient")>()
  return { ...actual, desktopPersistenceClient: new actual.DesktopPersistenceClient(() => ({
    load: async () => ({ records: [] }),
    commit: async () => ({ status: "committed", committedRevisions: {} }),
    flush: async () => ({ status: "flushed", flushedRevision: 1 }),
  }), async () => {}) }
})

const projectId = "lpj_local" as LocalProjectId
const workspaceId = "workspace"
const laneId = "collab"
const scopeKey = buildWorkbenchScopeKey(projectId, laneId, workspaceId)
const repair: ProjectOperationDTO = {
  operationId: "repair", projectId, kind: "repair", state: "completed", stage: "completed",
  details: { workspaceId, sourceFolder: "/moved", previousFolder: "/original", expectedWorkspaceRevision: "1" },
  requestDetails: {}, revision: 4, lastError: null, createdAt: 1, updatedAt: 2,
}
const layout = { grid: { orientation: "VERTICAL" }, panels: {} } as SerializedDockview
const getWorkbench = () => selectProjectWorkbench(projectId, laneId, workspaceId)(useProjectWorkbenchStore.getState())!

beforeEach(() => {
  useProjectWorkbenchStore.setState({ workbenches: {}, lastActiveScopeKey: null })
  const actions = useProjectWorkbenchStore.getState().actions
  actions.ensureWorkbench(projectId, laneId, workspaceId)
  actions.bindWorkspaceRevision(projectId, laneId, workspaceId, 1)
  actions.addTile(projectId, laneId, "assistantChat", undefined, workspaceId)
  writePersistedWorkbenchLayout(scopeKey, getWorkbench().layoutResetKey, layout, 1)
})

function input() {
  return { projectId, workspaceId, rootPath: "/moved", scopeKey, layoutResetKey: getWorkbench().layoutResetKey,
    previousRevision: 1, currentRevision: 2, projects: { getCompletedRepair: vi.fn().mockResolvedValue(repair) },
    isCurrent: () => true,
    commit: (confirmed: ProjectOperationDTO | undefined) => useProjectWorkbenchStore.getState().actions.bindWorkspaceRevision(projectId, laneId, workspaceId, 2, confirmed),
  }
}

describe("workbench ownership after a completed repair", () => {
  it("keeps exact tile identities, selection and split reset key while durably updating layout revision", async () => {
    const before = getWorkbench()
    const request = input()
    await reconcileWorkbenchRevision(request)
    const after = getWorkbench()
    expect(request.projects.getCompletedRepair).toHaveBeenCalledWith(workspaceId, null, "/moved", 1)
    expect(after.workspaceRevision).toBe(2)
    expect(after.tiles).toBe(before.tiles)
    expect(after.order).toBe(before.order)
    expect(after.activeTileId).toBe(before.activeTileId)
    expect(after.layoutResetKey).toBe(before.layoutResetKey)
    expect(peekPersistedWorkbenchLayout(scopeKey, before.layoutResetKey, 2)).toEqual(layout)
    await desktopPersistenceClient.flush()
  })

  it("keeps ordinary unproven binding changes isolated from private tiles", async () => {
    const before = getWorkbench()
    const request = input()
    request.projects.getCompletedRepair.mockResolvedValue(null)
    await reconcileWorkbenchRevision(request)
    expect(getWorkbench().workspaceRevision).toBe(2)
    expect(getWorkbench().tiles).not.toBe(before.tiles)
    expect(Object.values(getWorkbench().tiles).some((tile) => tile.type === "assistantChat")).toBe(false)
  })

  it("preserves the old state when catalog confirmation is unavailable or belongs to another project", async () => {
    const before = getWorkbench()
    const request = input()
    request.projects.getCompletedRepair.mockRejectedValueOnce(new Error("reply lost"))
    await expect(reconcileWorkbenchRevision(request)).rejects.toThrow("reply lost")
    expect(getWorkbench()).toBe(before)
    request.projects.getCompletedRepair.mockResolvedValue({ ...repair, projectId: "foreign" })
    await expect(reconcileWorkbenchRevision(request)).rejects.toThrow("no longer matches")
    expect(getWorkbench()).toBe(before)
  })

  it("does not apply a stale asynchronous reply after navigation supersedes its binding", async () => {
    const before = getWorkbench()
    const request = input()
    request.isCurrent = () => false
    await reconcileWorkbenchRevision(request)
    expect(getWorkbench()).toBe(before)
  })
})
