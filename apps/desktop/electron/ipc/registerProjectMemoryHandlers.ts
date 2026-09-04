import type { IpcMain } from 'electron'

import type {
  ProjectMemoryGraph,
  ProjectMemoryNodeDetail,
  ProjectMemoryStatus,
} from '../../../../shared/electronApiTypes'
import { ProjectMemoryService } from '../services/ProjectMemoryService'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization.ts'

interface WorkspaceScopedRequest {
  workspaceId: string
  laneId?: string | null
}

const UNAVAILABLE: ProjectMemoryStatus = {
  available: false,
  graphifyInstalled: false,
  projectHasSource: false,
  graphPath: null,
  builtAtCommit: null,
  generatedAt: null,
  nodeCount: 0,
  linkCount: 0,
}

// Read-only access to the project graph agents maintain. Nothing here builds or
// mutates the graph — that stays with whichever agent the user is working with.
export function registerProjectMemoryHandlers(ipcMain: IpcMain): void {
  const service = ProjectMemoryService.getInstance()

  const resolveRoot = async ({ workspaceId, laneId }: WorkspaceScopedRequest) => {
    const access = await resolveAuthorizedWorkspaceAccess({
      workspaceId,
      laneId,
      operation: 'read-file',
      cwd: { kind: 'projectRoot' },
    })
    return access.cwd ?? access.projectRootPath
  }

  ipcMain.handle(
    'projectMemory:getStatus',
    async (_event, request: WorkspaceScopedRequest): Promise<ProjectMemoryStatus> => {
      try {
        return service.getStatus(await resolveRoot(request))
      } catch (error) {
        return {
          ...UNAVAILABLE,
          graphifyInstalled: service.isGraphifyInstalled(),
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )

  ipcMain.handle(
    'projectMemory:getGraph',
    async (_event, request: WorkspaceScopedRequest): Promise<ProjectMemoryGraph | null> => {
      try {
        return service.getGraph(request.workspaceId, await resolveRoot(request))
      } catch {
        return null
      }
    },
  )

  ipcMain.handle(
    'projectMemory:getNodeDetail',
    async (
      _event,
      request: WorkspaceScopedRequest & { nodeId: string },
    ): Promise<ProjectMemoryNodeDetail | null> => {
      try {
        const nodeId = typeof request.nodeId === 'string' ? request.nodeId.trim() : ''
        if (!nodeId) return null
        return service.getNodeDetail(request.workspaceId, await resolveRoot(request), nodeId)
      } catch {
        return null
      }
    },
  )
}
