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

export interface EnsureSessionWorkbenchParams {
  projectId: ProjectId
  sessionId: SessionId
  branchName: BranchName
  baseBranch?: BranchName | null
  createBranch?: boolean
  title: string
  sourceRepoUrl?: string | null
  sourceRootPath?: string | null
  includeDirtyChanges?: boolean
  workspaceId?: WorkspaceId
  rootPath?: string
  setActive?: boolean
}

export interface EnsureSessionWorkbenchResult {
  workbench: LocalProjectWorkbench
  rootPath: string
  reused: boolean
}

function safePathSegment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${label} cannot be used as a workspace path segment`)
  }
  return value
}

function copyWorkingTreeSnapshot(sourceRootPath: string, destinationRootPath: string): void {
  const source = fs.realpathSync(sourceRootPath)
  const destination = fs.realpathSync(destinationRootPath)
  if (source === destination) {
    throw new Error("Session workspace must be different from the source workspace")
  }

  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    fs.rmSync(path.join(destination, entry.name), { recursive: true, force: true })
  }

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".git") continue
    fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      force: true,
      preserveTimestamps: true,
      dereference: false,
      filter: (candidate) => path.basename(candidate) !== ".git",
    })
  }
}

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
    return path.join(
      this.collabReposDir,
      safePathSegment(String(projectId), "projectId"),
      safePathSegment(String(sessionId), "sessionId"),
      "repo",
    )
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
   * Idempotently provisions the dedicated repository used by one collaboration
   * session and returns its persistent local Session Workbench. Re-running this
   * after an interrupted clone/start reuses the same folder and workbench.
   *
   * The caller may supply the desktop workspace catalog's workspaceId/rootPath;
   * projectd then records that same identity rather than creating a second local
   * workspace identity for the folder.
   */
  async ensureSessionWorkbench(params: EnsureSessionWorkbenchParams): Promise<EnsureSessionWorkbenchResult> {
    const existing = (await this.store.listByProject(params.projectId)).find(
      (candidate) =>
        candidate.kind === "collaboration" && candidate.collaborationSessionId === params.sessionId,
    )
    if (existing) {
      if (existing.branchName !== params.branchName) {
        throw new Error(
          `Session '${params.sessionId}' is already bound to branch '${existing.branchName ?? "unknown"}'`,
        )
      }
      const workspace = await this.workspaceRegistry.get(existing.workspaceId)
      const rootPath = workspace?.rootPath ?? params.rootPath ?? this.getSessionWorkspacePath(params.projectId, params.sessionId)
      if (params.setActive && existing.lifecycle !== "active") {
        const switched = await this.store.setActive(params.projectId, existing.workbenchId)
        return { workbench: switched.activated, rootPath, reused: true }
      }
      return { workbench: existing, rootPath, reused: true }
    }

    const sessionRepoPath = path.resolve(
      params.rootPath ?? this.getSessionWorkspacePath(params.projectId, params.sessionId),
    )
    await this.ensureSessionRepository(sessionRepoPath, params)

    const sessionWorkspaceId = params.workspaceId ?? asWorkspaceId(`ws_collab_${params.sessionId}`)
    await this.workspaceRegistry.registerWorkspace({
      workspaceId: sessionWorkspaceId,
      projectId: params.projectId,
      rootPath: sessionRepoPath,
      projectRootPath: sessionRepoPath,
      gitRootPath: sessionRepoPath,
      gitOriginUrl: params.sourceRepoUrl ?? null,
      source: "collab_managed_session",
      storageOwnership: "managed",
    })

    const workbench = createSessionWorkbench({
      projectId: params.projectId,
      workspaceId: sessionWorkspaceId,
      branchName: params.branchName,
      sessionId: params.sessionId,
      title: params.title,
      lifecycle: "idle",
    })
    await this.store.save(workbench)
    if (params.setActive) {
      const switched = await this.store.setActive(params.projectId, workbench.workbenchId)
      return { workbench: switched.activated, rootPath: sessionRepoPath, reused: false }
    }
    return { workbench, rootPath: sessionRepoPath, reused: false }
  }

  private async ensureSessionRepository(
    sessionRepoPath: string,
    params: EnsureSessionWorkbenchParams,
  ): Promise<void> {
    fs.mkdirSync(path.dirname(sessionRepoPath), { recursive: true })
    const gitDir = path.join(sessionRepoPath, ".git")

    if (!fs.existsSync(gitDir)) {
      const source = params.sourceRepoUrl?.trim() || params.sourceRootPath?.trim() || null
      if (source && this.gitService) {
        fs.mkdirSync(sessionRepoPath, { recursive: true })
        const entries = fs.readdirSync(sessionRepoPath)
        if (entries.length > 0) {
          throw new Error(`Session workspace '${sessionRepoPath}' is not empty and is not a Git repository`)
        }
        const cloneArgs = [
          "clone",
          ...(params.baseBranch ? ["--branch", String(params.baseBranch)] : []),
          ...(params.sourceRootPath && !params.sourceRepoUrl ? ["--no-hardlinks"] : []),
          "--",
          source,
          ".",
        ]
        await this.gitService.process.execute(cloneArgs, { cwd: sessionRepoPath })
      } else {
        fs.mkdirSync(sessionRepoPath, { recursive: true })
        if (this.gitService) {
          await this.gitService.initRepo(sessionRepoPath, String(params.branchName))
        }
      }
    }

    if (this.gitService && fs.existsSync(gitDir)) {
      await this.ensureSessionBranch(sessionRepoPath, params)
    }

    if (params.includeDirtyChanges) {
      if (!params.sourceRootPath) {
        throw new Error("Including existing changes requires the source workspace path")
      }
      copyWorkingTreeSnapshot(params.sourceRootPath, sessionRepoPath)
    }
  }

  private async ensureSessionBranch(sessionRepoPath: string, params: EnsureSessionWorkbenchParams): Promise<void> {
    if (!this.gitService) return
    const branch = String(params.branchName)
    const local = await this.gitService.process.execute(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: sessionRepoPath,
      allowNonZeroExit: true,
    })
    if (local.success) {
      await this.gitService.checkoutBranch(sessionRepoPath, branch)
      return
    }

    const remote = await this.gitService.process.execute(
      ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`],
      { cwd: sessionRepoPath, allowNonZeroExit: true },
    )
    if (remote.success && !params.createBranch) {
      await this.gitService.process.execute(["checkout", "-b", branch, "--track", `origin/${branch}`], {
        cwd: sessionRepoPath,
      })
      return
    }

    const baseBranch = String(params.baseBranch ?? params.branchName)
    const baseCandidates = [baseBranch, `origin/${baseBranch}`, "HEAD"]
    let startPoint: string | null = null
    for (const candidate of baseCandidates) {
      const resolved = await this.gitService.process.execute(["rev-parse", "--verify", `${candidate}^{commit}`], {
        cwd: sessionRepoPath,
        allowNonZeroExit: true,
      })
      if (resolved.success) {
        startPoint = candidate
        break
      }
    }

    if (!startPoint) {
      // An unborn repository created specifically for this session already has
      // HEAD pointing at branchName via `git init -b`.
      const symbolic = await this.gitService.process.execute(["symbolic-ref", "--short", "HEAD"], {
        cwd: sessionRepoPath,
        allowNonZeroExit: true,
      })
      if (symbolic.success && symbolic.stdout.trim() === branch) return
      throw new Error(`Git could not find a starting point for session branch '${branch}'`)
    }

    await this.gitService.process.execute(["checkout", "-b", branch, startPoint], { cwd: sessionRepoPath })
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
