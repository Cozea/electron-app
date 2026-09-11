/**
 * Local Project Workbench Manager.
 *
 * Master Specification: Section 5.1 - 5.4, 7.1, 7.3
 * Invariants:
 * - C02: Session Workbench is local device state.
 * - C08: workbenchId != workspaceId.
 * - C29: Exactly one active Workbench per project on one device.
 * - C30: Switching local Workbench idles locally and preserves background sync.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  asWorkspaceId,
  createOrdinaryWorkbench,
  createSessionWorkbench,
  type BranchName,
  type LocalProjectWorkbench,
  type ProjectId,
  type SessionId,
  type SetActiveWorkbenchResult,
  type WorkbenchId,
  type WorkspaceId,
} from "@shared/collaboration"

import type { SqliteWorkbenchStore } from "./SqliteWorkbenchStore"
import type { WorkspaceRegistry } from "../workspaces/WorkspaceRegistry"
import type { GitService } from "../git/GitService"

export function getDefaultCollaborationReposDir(): string {
  if (process.env.COZEA_COLLAB_REPOS_DIR) {
    return process.env.COZEA_COLLAB_REPOS_DIR
  }
  return path.join(os.homedir(), "Library/Application Support/Cozea/Collaboration")
}

export class WorkbenchManager {
  readonly store: SqliteWorkbenchStore
  readonly workspaceRegistry: WorkspaceRegistry
  readonly gitService?: GitService
  readonly collabReposDir: string

  constructor(options: {
    store: SqliteWorkbenchStore
    workspaceRegistry: WorkspaceRegistry
    gitService?: GitService
    collabReposDir?: string
  }) {
    this.store = options.store
    this.workspaceRegistry = options.workspaceRegistry
    this.gitService = options.gitService
    this.collabReposDir = options.collabReposDir ?? getDefaultCollaborationReposDir()
  }

  /**
   * Section 7.1: Returns isolated standalone session workspace path.
   */
  getSessionWorkspacePath(projectId: ProjectId, sessionId: SessionId): string {
    return path.join(this.collabReposDir, String(projectId), String(sessionId), "repo")
  }

  /**
   * Creates an ordinary local Workbench for an attached or managed workspace.
   */
  async createOrdinaryWorkbench(params: {
    projectId: ProjectId
    workspaceId: WorkspaceId
    branchName?: BranchName | null
    title: string
    setActive?: boolean
  }): Promise<LocalProjectWorkbench> {
    const ws = await this.workspaceRegistry.get(params.workspaceId)
    if (!ws) {
      throw new Error(`Workspace '${params.workspaceId}' not found in registry`)
    }

    const workbench = createOrdinaryWorkbench({
      projectId: params.projectId,
      workspaceId: params.workspaceId,
      branchName: params.branchName ?? null,
      title: params.title,
      lifecycle: params.setActive ? "active" : "idle",
    })

    if (params.setActive) {
      await this.store.save({ ...workbench, lifecycle: "idle" })
      const res = await this.store.setActive(params.projectId, workbench.workbenchId)
      return res.activated
    }

    return this.store.save(workbench)
  }

  /**
   * Section 5.3 & 7.1: Provisions dedicated managed session workspace and creates Session Workbench.
   */
  async createSessionWorkbench(params: {
    projectId: ProjectId
    sessionId: SessionId
    branchName: BranchName
    title: string
    sourceRepoUrl?: string
    setActive?: boolean
  }): Promise<LocalProjectWorkbench> {
    const sessionRepoPath = this.getSessionWorkspacePath(params.projectId, params.sessionId)
    fs.mkdirSync(sessionRepoPath, { recursive: true })

    const sessionWorkspaceId = asWorkspaceId(`ws_collab_${params.sessionId}`)

    // Register dedicated managed session workspace in registry
    await this.workspaceRegistry.registerWorkspace({
      workspaceId: sessionWorkspaceId,
      projectId: params.projectId,
      rootPath: sessionRepoPath,
      projectRootPath: sessionRepoPath,
      source: "collab_managed_session",
      storageOwnership: "managed",
    })

    if (this.gitService) {
      try {
        if (!fs.existsSync(path.join(sessionRepoPath, ".git"))) {
          await this.gitService.initRepo(sessionRepoPath, String(params.branchName))
        }
      } catch (err) {
        console.warn("[WorkbenchManager] Git init for session clone warning:", err)
      }
    }

    const workbench = createSessionWorkbench({
      projectId: params.projectId,
      workspaceId: sessionWorkspaceId,
      branchName: params.branchName,
      sessionId: params.sessionId,
      title: params.title,
      lifecycle: params.setActive ? "active" : "idle",
    })

    if (params.setActive) {
      await this.store.save({ ...workbench, lifecycle: "idle" })
      const res = await this.store.setActive(params.projectId, workbench.workbenchId)
      return res.activated
    }

    return this.store.save(workbench)
  }

  /**
   * Switches active Workbench for a project (Section 5.2).
   */
  async switchActiveWorkbench(
    projectId: ProjectId,
    workbenchId: WorkbenchId,
  ): Promise<SetActiveWorkbenchResult> {
    return this.store.setActive(projectId, workbenchId)
  }

  async listWorkbenches(projectId: ProjectId): Promise<LocalProjectWorkbench[]> {
    return this.store.listByProject(projectId)
  }

  async getActiveWorkbench(projectId: ProjectId): Promise<LocalProjectWorkbench | null> {
    return this.store.getActive(projectId)
  }
}
