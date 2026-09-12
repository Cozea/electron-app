/**
 * Registers projectd IPC handlers in Electron Main.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 */

import { ipcMain, type WebContents } from "electron"
import {
  projectdSessionTopic,
  type ProjectdMergeStrategy,
  type ProjectdSessionAttachParams,
  type ProjectdSessionTicket,
} from "@cozea/projectd-protocol"
import { getSharedProjectdClient } from "./ProjectdClient"

const SESSION_EVENT_CHANNEL = "projectd:sessions:event"

interface SessionEventForwarding {
  readonly senders: Set<WebContents>
  unsubscribe: (() => void) | null
}

// Windows that attached each session; the daemon's events for it are relayed to them.
const sessionForwarding = new Map<string, SessionEventForwarding>()

function toFailure(err: unknown): { success: false; error: string; code?: string } {
  return {
    success: false,
    error: err instanceof Error ? err.message : String(err),
    code: (err as { code?: string } | null)?.code,
  }
}

async function forwardSessionEvents(publicSessionId: string, sender: WebContents): Promise<void> {
  let forwarding = sessionForwarding.get(publicSessionId)
  if (!forwarding) {
    const created: SessionEventForwarding = { senders: new Set(), unsubscribe: null }
    sessionForwarding.set(publicSessionId, created)
    forwarding = created
    try {
      created.unsubscribe = await getSharedProjectdClient().subscribe(
        projectdSessionTopic(publicSessionId),
        (event) => {
          for (const target of created.senders) {
            if (target.isDestroyed()) {
              created.senders.delete(target)
              continue
            }
            target.send(SESSION_EVENT_CHANNEL, { publicSessionId, event: event.event, payload: event.payload })
          }
        },
      )
    } catch (error) {
      sessionForwarding.delete(publicSessionId)
      throw error
    }
  }
  if (!forwarding.senders.has(sender)) {
    forwarding.senders.add(sender)
    sender.once("destroyed", () => stopForwarding(publicSessionId, sender))
  }
}

function stopForwarding(publicSessionId: string, sender?: WebContents): void {
  const forwarding = sessionForwarding.get(publicSessionId)
  if (!forwarding) return
  if (sender) forwarding.senders.delete(sender)
  else forwarding.senders.clear()
  if (forwarding.senders.size === 0) {
    forwarding.unsubscribe?.()
    sessionForwarding.delete(publicSessionId)
  }
}

export function registerProjectdHandlers(): void {
  ipcMain.handle("projectd:sessions:attach", async (event, params: ProjectdSessionAttachParams) => {
    try {
      await forwardSessionEvents(params.publicSessionId, event.sender)
      const status = await getSharedProjectdClient().attachSession(params)
      return { success: true, status }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:detach", async (_event, publicSessionId: string) => {
    try {
      const { detached } = await getSharedProjectdClient().detachSession(publicSessionId)
      stopForwarding(publicSessionId)
      return { success: true, detached }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:status", async (_event, publicSessionId: string) => {
    try {
      return { success: true, status: await getSharedProjectdClient().getSessionStatus(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle(
    "projectd:sessions:updateTicket",
    async (_event, req: { publicSessionId: string; ticket: ProjectdSessionTicket }) => {
      try {
        const status = await getSharedProjectdClient().updateSessionTicket(req.publicSessionId, req.ticket)
        return { success: true, status }
      } catch (err) {
        return toFailure(err)
      }
    },
  )

  ipcMain.handle("projectd:sessions:checkpointNow", async (_event, publicSessionId: string) => {
    try {
      return { success: true, result: await getSharedProjectdClient().checkpointSession(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:ignoreEnvironmentFiles", async (_event, publicSessionId: string) => {
    try {
      const { paths } = await getSharedProjectdClient().ignoreSessionEnvironmentFiles(publicSessionId)
      return { success: true, paths }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:checkTarget", async (_event, publicSessionId: string) => {
    try {
      return { success: true, target: await getSharedProjectdClient().checkSessionTarget(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:dismissTarget", async (_event, publicSessionId: string) => {
    try {
      return { success: true, target: await getSharedProjectdClient().dismissSessionTarget(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle(
    "projectd:sessions:rebase",
    async (_event, req: { publicSessionId: string; allowConflicts: boolean }) => {
      try {
        const result = await getSharedProjectdClient().rebaseSession(req.publicSessionId, req.allowConflicts === true)
        return { success: true, result }
      } catch (err) {
        return toFailure(err)
      }
    },
  )

  ipcMain.handle("projectd:sessions:previewMerge", async (_event, publicSessionId: string) => {
    try {
      return { success: true, preview: await getSharedProjectdClient().previewSessionMerge(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle(
    "projectd:sessions:merge",
    async (_event, req: { publicSessionId: string; strategy: ProjectdMergeStrategy; checkpointOid: string }) => {
      try {
        const result = await getSharedProjectdClient().mergeSession(req.publicSessionId, req.strategy, req.checkpointOid)
        return { success: true, result }
      } catch (err) {
        return toFailure(err)
      }
    },
  )

  ipcMain.handle("projectd:health", async () => {
    const client = getSharedProjectdClient()
    try {
      const health = await client.health()
      return { success: true, health }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:connect", async () => {
    const client = getSharedProjectdClient()
    try {
      await client.connect()
      const health = await client.health()
      return { success: true, health }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:disconnect", async () => {
    const client = getSharedProjectdClient()
    client.disconnect()
    return { success: true }
  })

  ipcMain.handle("projectd:workbenches:list", async (_event, projectId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workbenches = await client.listWorkbenches(projectId)
      return { success: true, workbenches }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:workbenches:get", async (_event, workbenchId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workbench = await client.getWorkbench(workbenchId)
      return { success: true, workbench }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle(
    "projectd:workbenches:activate",
    async (_event, req: { projectId: string; workbenchId: string }) => {
      const client = getSharedProjectdClient()
      try {
        const result = await client.activateWorkbench(req.projectId, req.workbenchId)
        return { success: true, result }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  ipcMain.handle(
    "projectd:workbenches:idle",
    async (_event, req: { projectId: string; workbenchId: string }) => {
      const client = getSharedProjectdClient()
      try {
        const result = await client.idleWorkbench(req.projectId, req.workbenchId)
        return { success: true, result }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  ipcMain.handle("projectd:workspaces:list", async (_event, projectId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workspaces = await client.listWorkspaces(projectId)
      return { success: true, workspaces }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:workspaces:get", async (_event, workspaceId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workspace = await client.getWorkspace(workspaceId)
      return { success: true, workspace }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })
}
