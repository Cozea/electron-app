/**
 * Registers projectd IPC handlers in Electron Main.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 */

import path from "node:path"

import { app, dialog, ipcMain, type WebContents } from "electron"
import * as Effect from "effect/Effect"
import {
  projectdSessionTopic,
  type ProjectdEnsureSessionWorkbenchParams,
  type ProjectdMergeStrategy,
  type ProjectdSessionAttachParams,
  type ProjectdSessionTicket,
} from "@cozea/projectd-protocol"
import { getSharedProjectdClient } from "./ProjectdClient"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../workspaces/WorkspaceCatalog"
import { waitForWorkspaceCatalogRuntime } from "../workspaces/WorkspaceCatalogRuntime"
import { notifyWorkspaceCatalogChanged } from "../workspaces/CatalogSnapshot"
import { authorizeBackgroundCollaborationIdentity } from "../collabKeys"
import { getTrustedDeviceGatewayBaseUrl } from "../services/DeviceGatewayPolicy"

declare const __COZEA_CONVEX_URL__: string

const SESSION_EVENT_CHANNEL = "projectd:sessions:event"
const PUBLIC_SESSION_ID_PATTERN = /^czs_[a-f0-9]{16}$/

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

function safePathSegment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

async function runWorkspaceCatalog<A>(
  operation: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>,
): Promise<A> {
  const runtime = await waitForWorkspaceCatalogRuntime()
  return runtime.runPromise(
    Effect.flatMap(Effect.service(WorkspaceCatalog), operation) as Effect.Effect<A, never, WorkspaceCatalog>,
  )
}

export interface EnsureDesktopSessionWorkbenchRequest {
  projectId: string
  publicSessionId: string
  branchName: string
  baseBranch?: string | null
  createBranch?: boolean
  title: string
  sourceRepoUrl?: string | null
  /** Opaque desktop WorkspaceCatalog ID. Main resolves its path. */
  sourceWorkspaceId?: string | null
  includeDirtyChanges?: boolean
  setActive?: boolean
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
  ipcMain.handle("projectd:workbenches:ensureSession", async (_event, req: EnsureDesktopSessionWorkbenchRequest) => {
    try {
      const projectId = safePathSegment(req.projectId, "projectId")
      const publicSessionId = safePathSegment(req.publicSessionId, "publicSessionId")
      if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) {
        throw new Error("A valid collaboration session ID (czs_…) is required")
      }
      if (!req.branchName?.trim() || !req.title?.trim()) {
        throw new Error("branchName and title are required")
      }

      let sourceRootPath: string | null = null
      if (req.sourceWorkspaceId) {
        const sourceWorkspace = await runWorkspaceCatalog((catalog) => catalog.getById(req.sourceWorkspaceId!))
        if (!sourceWorkspace || sourceWorkspace.projectId !== projectId) {
          throw new Error("The source workspace does not belong to this project on this device")
        }
        sourceRootPath = sourceWorkspace.projectRootPath
      }
      if (req.includeDirtyChanges && !sourceRootPath) {
        throw new Error("Including existing changes requires a source workspace")
      }

      const collaborationRoot = process.env.COZEA_COLLAB_REPOS_DIR || path.join(app.getPath("userData"), "Collaboration")
      const managedRootPath = path.join(collaborationRoot, projectId, publicSessionId)
      const rootPath = path.join(managedRootPath, "repo")
      const workspaceId = `ws_collab_${publicSessionId}`
      const convexUrl = typeof __COZEA_CONVEX_URL__ === "string" ? __COZEA_CONVEX_URL__ : process.env.VITE_CONVEX_URL
      if (!convexUrl) throw new Error("The background Convex service is not configured")
      await authorizeBackgroundCollaborationIdentity()

      const daemonParams: ProjectdEnsureSessionWorkbenchParams = {
        background: { gatewayUrl: getTrustedDeviceGatewayBaseUrl(), convexUrl },
        projectId,
        publicSessionId,
        branchName: req.branchName.trim(),
        baseBranch: req.baseBranch?.trim() || null,
        createBranch: req.createBranch === true,
        title: req.title.trim(),
        sourceRepoUrl: req.sourceRepoUrl ?? null,
        sourceRootPath,
        includeDirtyChanges: req.includeDirtyChanges === true,
        workspaceId,
        rootPath,
        setActive: req.setActive === true,
      }
      const ensured = await getSharedProjectdClient().ensureSessionWorkbench(daemonParams)

      const registered = await runWorkspaceCatalog((catalog) =>
        catalog.registerManagedSessionWorkspace({
          projectId,
          workspaceId: ensured.workbench.workspaceId,
          folderPath: ensured.rootPath,
          managedRootPath,
        }),
      )
      if (!registered.success || !registered.workspace) {
        throw new Error(registered.error ?? "The Session Workspace could not be registered")
      }
      if (req.setActive) {
        await runWorkspaceCatalog((catalog) => catalog.setActive(registered.workspace!.workspaceId, projectId))
      }
      notifyWorkspaceCatalogChanged()

      return { success: true, ...ensured, workspace: registered.workspace }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:attach", async (event, params: ProjectdSessionAttachParams) => {
    try {
      if (params.workspaceId !== `ws_collab_${params.publicSessionId}`) {
        throw new Error("Collaboration requires this session's dedicated workspace")
      }
      const workspace = await runWorkspaceCatalog((catalog) => catalog.getById(params.workspaceId))
      if (!workspace || workspace.projectId !== params.projectId || workspace.projectRootPath !== params.rootPath) {
        throw new Error("The session folder does not match this device's workspace catalog")
      }
      const convexUrl = typeof __COZEA_CONVEX_URL__ === "string" ? __COZEA_CONVEX_URL__ : process.env.VITE_CONVEX_URL
      if (!convexUrl) throw new Error("The background Convex service is not configured")
      await authorizeBackgroundCollaborationIdentity()
      await forwardSessionEvents(params.publicSessionId, event.sender)
      const status = await getSharedProjectdClient().attachSession({
        ...params,
        background: { gatewayUrl: getTrustedDeviceGatewayBaseUrl(), convexUrl },
      })
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

  ipcMain.handle("projectd:sessions:recovery:list", async () => {
    try { return { success: true, entries: await getSharedProjectdClient().listSessionRecovery() } } catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:recovery:preview", async (_event, publicSessionId: string, afterCursor?: string, limit?: number) => {
    try {
      if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) throw new Error("Invalid session ID")
      return { success: true, preview: await getSharedProjectdClient().previewSessionRecovery(publicSessionId, afterCursor, limit) }
    } catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:recovery:export", async (_event, publicSessionId: string, source: "local" | "cloud" = "local", projectId?: string) => {
    try {
      if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) throw new Error("Invalid session ID")
      if (source !== "local" && source !== "cloud") throw new Error("Invalid recovery source")
      const choice = await dialog.showOpenDialog({ title: source === "cloud" ? "Export cloud session files" : "Export retained session files",
        message: "Choose a folder for recovered files. Newer workspace edits are not included.",
        properties: ["openDirectory", "createDirectory"] })
      if (choice.canceled || !choice.filePaths[0]) return { success: true, canceled: true }
      let cloudContext: { projectId: string; background: { gatewayUrl: string; convexUrl: string } } | undefined
      if (source === "cloud") {
        if (typeof projectId !== "string" || !projectId) throw new Error("A project is required for cloud recovery")
        const convexUrl = typeof __COZEA_CONVEX_URL__ === "string" ? __COZEA_CONVEX_URL__ : process.env.VITE_CONVEX_URL
        if (!convexUrl) throw new Error("The background Convex service is not configured")
        await authorizeBackgroundCollaborationIdentity()
        cloudContext = { projectId, background: { gatewayUrl: getTrustedDeviceGatewayBaseUrl(), convexUrl } }
      }
      const result = await getSharedProjectdClient().exportSessionRecovery(publicSessionId, choice.filePaths[0], source, cloudContext)
      return { success: true, canceled: false, result }
    } catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:status", async (_event, publicSessionId: string) => {
    try {
      return { success: true, status: await getSharedProjectdClient().getSessionStatus(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:recovery:shareKeys", async (_event, publicSessionId: string, projectId: string) => {
    try {
      if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) throw new Error("Invalid session ID")
      if (typeof projectId !== "string" || !projectId) throw new Error("A project is required for recovery key sharing")
      const convexUrl = typeof __COZEA_CONVEX_URL__ === "string" ? __COZEA_CONVEX_URL__ : process.env.VITE_CONVEX_URL
      if (!convexUrl) throw new Error("The background Convex service is not configured")
      await authorizeBackgroundCollaborationIdentity()
      const result = await getSharedProjectdClient().shareSessionRecoveryKeys(publicSessionId,
        { projectId, background: { gatewayUrl: getTrustedDeviceGatewayBaseUrl(), convexUrl } })
      return { success: true, shared: result.shared }
    } catch (err) { return toFailure(err) }
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

  ipcMain.handle("projectd:sessions:prepareLeave", async (_event, publicSessionId: string) => {
    try {
      return { success: true, ...await getSharedProjectdClient().prepareSessionLeave(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:pause", async (_event, publicSessionId: string) => {
    try {
      return { success: true, ...await getSharedProjectdClient().pauseSession(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle("projectd:sessions:prepareClose", async (_event, publicSessionId: string) => {
    try {
      return { success: true, review: await getSharedProjectdClient().prepareSessionClose(publicSessionId) }
    } catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:close", async (_event, publicSessionId: string, choice: import("@cozea/projectd-protocol").ProjectdCloseChoice) => {
    try {
      return { success: true, ...await getSharedProjectdClient().closeSession(publicSessionId, choice) }
    } catch (err) { return toFailure(err) }
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

  ipcMain.handle("projectd:sessions:rebaseRecovery", async (_event, publicSessionId: string, request: import("@cozea/projectd-protocol").ProjectdRebaseRecoveryRequest) => {
    try { return { success: true, response: await getSharedProjectdClient().manageRebaseRecovery(publicSessionId, request) } }
    catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:binaryConflicts", async (_event, publicSessionId: string, request: import("@cozea/projectd-protocol").ProjectdBinaryConflictRequest) => {
    try {
      if (request?.action === "export") throw new Error("Choose an export folder through the export dialog.")
      return { success: true, response: await getSharedProjectdClient().manageBinaryConflicts(publicSessionId, request) }
    }
    catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:exportBinaryVersion", async (_event, publicSessionId: string, request: { fileId: string; revisionId: string; fingerprint: string }) => {
    try {
      if (!PUBLIC_SESSION_ID_PATTERN.test(publicSessionId)) throw new Error("Invalid session ID")
      const choice = await dialog.showOpenDialog({ title: "Export file version", message: "Choose a folder outside the session workspace. A new folder will hold the exported copy.", properties: ["openDirectory", "createDirectory"] })
      if (choice.canceled || !choice.filePaths[0]) return { success: true, canceled: true }
      return { success: true, canceled: false, response: await getSharedProjectdClient().manageBinaryConflicts(publicSessionId, {
        fileId: request.fileId, revisionId: request.revisionId, fingerprint: request.fingerprint,
        action: "export", destinationDirectory: choice.filePaths[0],
      }) }
    } catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:structuralConflicts", async (_event, publicSessionId: string, request: import("@cozea/projectd-protocol").ProjectdStructuralConflictRequest) => {
    try { return { success: true, response: await getSharedProjectdClient().manageStructuralConflicts(publicSessionId, request) } }
    catch (err) { return toFailure(err) }
  })

  ipcMain.handle("projectd:sessions:previewMerge", async (_event, publicSessionId: string) => {
    try {
      return { success: true, preview: await getSharedProjectdClient().previewSessionMerge(publicSessionId) }
    } catch (err) {
      return toFailure(err)
    }
  })

  ipcMain.handle(
    "projectd:sessions:merge",
    async (_event, req: { publicSessionId: string; strategy: ProjectdMergeStrategy; checkpointOid: string; targetOid: string }) => {
      try {
        const result = await getSharedProjectdClient().mergeSession(req.publicSessionId, req.strategy, req.checkpointOid, req.targetOid)
        return { success: true, result }
      } catch (err) {
        return toFailure(err)
      }
    },
  )

  ipcMain.handle("projectd:sessions:createPullRequest", async (_event, req: { publicSessionId: string; checkpointOid: string; targetOid: string }) => {
    try {
      return { success: true, result: await getSharedProjectdClient().createSessionPullRequest(req.publicSessionId, req.checkpointOid, req.targetOid) }
    } catch (err) { return toFailure(err) }
  })

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
