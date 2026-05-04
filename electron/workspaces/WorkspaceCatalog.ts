import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as ServiceMap from "effect/ServiceMap"
import * as SqlClient from "@effect/sql/SqlClient"

import type {
  BindExistingFolderRequest,
  BindExistingFolderResult,
  CloneWorkspaceForProjectRequest,
  CloneWorkspaceForProjectResult,
  CreateWorkspaceForProjectRequest,
  CreateWorkspaceForProjectResult,
  LocalWorkspaceDTO,
  LocalWorkspaceRecord,
  RepoIdentity,
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
  RuntimeIdentityDTO,
  WorkspaceCandidate,
  WorkspaceConflictDTO,
  WorkspaceLaneDTO,
  WorkspaceLaneKind,
  WorkspaceLaneRecord,
  WorkspaceResolutionAction,
  WorkspaceSource,
  WorkspaceVerificationStatus,
} from "../../shared/workspaceTypes.ts"
import { writeWorkspaceMarker } from "./markers.ts"
import { parseRepoIdentity, readGitRepoIdentity, repoIdentitiesMatch } from "./repoIdentity.ts"
import { verifyWorkspacePath } from "./verification.ts"
import { scanForCandidates } from "./candidates.ts"
import { runGitCommand } from "../gitRuntime.ts"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

function now(): number {
  return Date.now()
}

function buildRuntimeSessionId(
  projectId: string,
  workspaceId: string,
  laneId: string,
  workspaceRevision: number,
): string {
  return `rsi_${projectId}_${workspaceId}_${laneId}_v${workspaceRevision}`
}

function buildCollaborationScopeId(projectId: string): string {
  return `project:${projectId}`
}

async function findAvailablePath(baseDir: string, slug: string): Promise<string> {
  let targetPath = path.join(baseDir, slug)
  let n = 1
  while (true) {
    try {
      await fs.access(targetPath)
      n++
      targetPath = path.join(baseDir, `${slug}-${n}`)
    } catch {
      return targetPath
    }
  }
}

function recordToDTO(r: LocalWorkspaceRecord): LocalWorkspaceDTO {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""
  const displayPath = r.projectRootPath.startsWith(home)
    ? `~${r.projectRootPath.slice(home.length)}`
    : r.projectRootPath

  return {
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    label: r.label,
    displayPath,
    rootPath: r.rootPath,
    projectRootRelativePath: r.projectRootRelativePath,
    projectRootPath: r.projectRootPath,
    gitRootPath: r.gitRootPath,
    gitOriginUrl: r.gitOriginUrl,
    gitRepoIdentity: r.gitRepoIdentityJson
      ? (JSON.parse(r.gitRepoIdentityJson) as RepoIdentity)
      : null,
    verificationStatus: r.verificationStatus,
    verificationReason: r.verificationReason,
    verifiedAt: r.verifiedAt,
    source: r.source,
    isActive: r.isActive === 1,
    workspaceRevision: r.workspaceRevision,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastOpenedAt: r.lastOpenedAt,
  }
}

function laneRecordToDTO(r: WorkspaceLaneRecord): WorkspaceLaneDTO {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""
  const displayPath = r.projectRootPath.startsWith(home)
    ? `~${r.projectRootPath.slice(home.length)}`
    : r.projectRootPath

  return {
    laneId: r.laneId,
    workspaceId: r.workspaceId,
    projectId: r.projectId,
    kind: r.kind,
    branch: r.branch,
    sharedBranch: r.sharedBranch,
    displayPath,
    projectRootPath: r.projectRootPath,
    gitRootPath: r.gitRootPath,
    isActive: r.isActive === 1,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastOpenedAt: r.lastOpenedAt,
  }
}

function buildRuntimeIdentity(
  workspace: LocalWorkspaceRecord,
  lane: WorkspaceLaneRecord,
): RuntimeIdentityDTO {
  return {
    runtimeSessionId: buildRuntimeSessionId(
      workspace.projectId,
      workspace.workspaceId,
      lane.laneId,
      workspace.workspaceRevision,
    ),
    projectId: workspace.projectId,
    workspaceId: workspace.workspaceId,
    laneId: lane.laneId,
    workspaceRevision: workspace.workspaceRevision,
  }
}

function defaultResolutionActions(hasWorkspace: boolean): WorkspaceResolutionAction[] {
  const actions: WorkspaceResolutionAction[] = [
    { kind: "clone", label: "Clone repository" },
    { kind: "create", label: "Create local folder" },
    { kind: "locate", label: "Locate existing folder" },
  ]
  if (hasWorkspace) {
    actions.push({ kind: "forget", workspaceId: "", label: "Forget stale binding" })
  }
  return actions
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export interface WorkspaceCatalogInterface {
  readonly resolveProject: (
    req: ResolveProjectWorkspaceRequest,
  ) => Effect.Effect<ResolveProjectWorkspaceResult>

  readonly getActive: (
    projectId: string,
  ) => Effect.Effect<LocalWorkspaceRecord | null>

  readonly listForProject: (
    projectId: string,
  ) => Effect.Effect<LocalWorkspaceRecord[]>

  readonly bindExistingFolder: (
    req: BindExistingFolderRequest,
  ) => Effect.Effect<BindExistingFolderResult>

  readonly createForProject: (
    req: CreateWorkspaceForProjectRequest,
  ) => Effect.Effect<CreateWorkspaceForProjectResult>

  readonly cloneForProject: (
    req: CloneWorkspaceForProjectRequest,
  ) => Effect.Effect<CloneWorkspaceForProjectResult>

  readonly verify: (
    workspaceId: string,
  ) => Effect.Effect<{ status: WorkspaceVerificationStatus; workspace: LocalWorkspaceDTO }>

  readonly getById: (
    workspaceId: string,
  ) => Effect.Effect<LocalWorkspaceDTO | null>

  readonly forget: (workspaceId: string) => Effect.Effect<void>

  readonly listCandidates: (
    projectId: string,
    slug: string,
    roots: string[],
    expectedRepo?: RepoIdentity | null,
  ) => Effect.Effect<WorkspaceCandidate[]>

  readonly setActive: (workspaceId: string, projectId: string) => Effect.Effect<void>

  readonly upsertProjectsCache: (
    projectId: string,
    data: { slug?: string; name?: string },
  ) => Effect.Effect<void>

  readonly getSetting: (key: string) => Effect.Effect<string | null>
  readonly setSetting: (key: string, value: string) => Effect.Effect<void>
}

export class WorkspaceCatalog extends ServiceMap.Service<WorkspaceCatalog, WorkspaceCatalogInterface>()(
  "cozea/workspaces/WorkspaceCatalog",
) {}

// ─── Implementation ───────────────────────────────────────────────────────────

export const WorkspaceCatalogLive = Layer.effect(
  WorkspaceCatalog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // ── Internal helpers ────────────────────────────────────────────────────

    function mapRow(row: Record<string, unknown>): LocalWorkspaceRecord {
      return row as unknown as LocalWorkspaceRecord
    }

    function mapLaneRow(row: Record<string, unknown>): WorkspaceLaneRecord {
      return row as unknown as WorkspaceLaneRecord
    }

    const queryActiveWorkspace = (projectId: string) =>
      sql`
        SELECT * FROM local_workspaces
        WHERE project_id = ${projectId} AND is_active = 1
        LIMIT 1
      `.pipe(
        Effect.map((rows) => (rows.length > 0 ? mapRow(rows[0] as Record<string, unknown>) : null)),
      )

    const queryWorkspaceById = (workspaceId: string) =>
      sql`
        SELECT * FROM local_workspaces
        WHERE workspace_id = ${workspaceId}
        LIMIT 1
      `.pipe(
        Effect.map((rows) => (rows.length > 0 ? mapRow(rows[0] as Record<string, unknown>) : null)),
      )

    const queryActiveLane = (workspaceId: string) =>
      sql`
        SELECT * FROM workspace_lanes
        WHERE workspace_id = ${workspaceId} AND is_active = 1
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows.length > 0 ? mapLaneRow(rows[0] as Record<string, unknown>) : null,
        ),
      )

    const ensureDefaultLane = (workspace: LocalWorkspaceRecord) =>
      Effect.gen(function* () {
        const existing = yield* queryActiveLane(workspace.workspaceId)
        if (existing) return existing

        const laneId = newId("lwl")
        const ts = now()
        yield* sql`
          INSERT INTO workspace_lanes (
            lane_id, workspace_id, project_id, kind,
            branch, shared_branch,
            project_root_relative_path, project_root_path,
            git_root_path, git_dir_path,
            is_active, created_at, updated_at
          ) VALUES (
            ${laneId}, ${workspace.workspaceId}, ${workspace.projectId}, ${"shared"},
            ${null}, ${null},
            ${workspace.projectRootRelativePath}, ${workspace.projectRootPath},
            ${workspace.gitRootPath}, ${workspace.gitDirPath},
            ${1}, ${ts}, ${ts}
          )
        `
        const lane = yield* queryActiveLane(workspace.workspaceId)
        return lane!
      })

    const doSetActive = (workspaceId: string, projectId: string) =>
      Effect.gen(function* () {
        const ts = now()
        yield* sql`
          UPDATE local_workspaces
          SET is_active = 0, updated_at = ${ts}
          WHERE project_id = ${projectId} AND workspace_id != ${workspaceId}
        `
        yield* sql`
          UPDATE local_workspaces
          SET is_active = 1, updated_at = ${ts}, last_opened_at = ${ts}
          WHERE workspace_id = ${workspaceId}
        `
      })

    const updateVerificationStatus = (
      workspaceId: string,
      status: WorkspaceVerificationStatus,
      reason: string | null,
      extra: {
        realPath?: string
        markerWorkspaceId?: string | null
        markerProjectId?: string | null
        markerPath?: string | null
        gitRepoIdentityJson?: string | null
      } = {},
    ) => {
      const ts = now()
      return Effect.gen(function* () {
        yield* sql`
          UPDATE local_workspaces
          SET
            verification_status = ${status},
            verification_reason = ${reason ?? null},
            verified_at = ${ts},
            updated_at = ${ts}
          WHERE workspace_id = ${workspaceId}
        `
        if (extra.realPath !== undefined) {
          yield* sql`UPDATE local_workspaces SET real_path = ${extra.realPath} WHERE workspace_id = ${workspaceId}`
        }
        if (extra.markerWorkspaceId !== undefined) {
          yield* sql`UPDATE local_workspaces SET marker_workspace_id = ${extra.markerWorkspaceId} WHERE workspace_id = ${workspaceId}`
        }
        if (extra.markerProjectId !== undefined) {
          yield* sql`UPDATE local_workspaces SET marker_project_id = ${extra.markerProjectId} WHERE workspace_id = ${workspaceId}`
        }
        if (extra.markerPath !== undefined) {
          yield* sql`UPDATE local_workspaces SET marker_path = ${extra.markerPath} WHERE workspace_id = ${workspaceId}`
        }
        if (extra.gitRepoIdentityJson !== undefined) {
          yield* sql`UPDATE local_workspaces SET git_repo_identity_json = ${extra.gitRepoIdentityJson} WHERE workspace_id = ${workspaceId}`
        }
      })
    }

    const recordConflict = (
      projectId: string | null,
      workspaceId: string | null,
      candidatePath: string,
      existingWorkspaceId: string | null,
      existingProjectId: string | null,
      reason: WorkspaceConflictDTO["reason"],
      details?: Record<string, unknown>,
    ) => {
      const conflictId = newId("wsc")
      const ts = now()
      return sql`
        INSERT INTO workspace_conflicts (
          conflict_id, project_id, workspace_id,
          candidate_path,
          existing_workspace_id, existing_project_id,
          reason, details_json, status, created_at
        ) VALUES (
          ${conflictId}, ${projectId ?? null}, ${workspaceId ?? null},
          ${candidatePath},
          ${existingWorkspaceId ?? null}, ${existingProjectId ?? null},
          ${reason}, ${details ? JSON.stringify(details) : null},
          ${"open"}, ${ts}
        )
      `.pipe(Effect.map(() => conflictId))
    }

    const emitEvent = (
      workspaceId: string | null,
      projectId: string | null,
      eventType: string,
      details?: Record<string, unknown>,
    ) => {
      const eventId = newId("wse")
      const ts = now()
      return sql`
        INSERT INTO workspace_events (
          event_id, workspace_id, project_id, event_type, details_json, created_at
        ) VALUES (
          ${eventId}, ${workspaceId ?? null}, ${projectId ?? null},
          ${eventType},
          ${details ? JSON.stringify(details) : null},
          ${ts}
        )
      `
    }

    // ── resolveProject ──────────────────────────────────────────────────────

    const resolveProject = (
      req: ResolveProjectWorkspaceRequest,
    ): Effect.Effect<ResolveProjectWorkspaceResult> =>
      Effect.gen(function* () {
        const { projectId, expectedRepo, allowCandidateScan = false } = req

        const workspace = yield* queryActiveWorkspace(projectId)

        if (!workspace) {
          return {
            status: "missing-binding" as const,
            projectId,
            actions: defaultResolutionActions(false),
          }
        }

        // Fast verification
        const verification = yield* Effect.tryPromise({
          try: () => verifyWorkspacePath(workspace, expectedRepo ?? null),
          catch: (e) => new Error(`Verification failed: ${String(e)}`),
        })

        if (verification.status !== "verified") {
          // Persist the new status
          yield* updateVerificationStatus(
            workspace.workspaceId,
            verification.status,
            verification.reason ?? null,
          ).pipe(Effect.catch(() => Effect.void))

          const actions: WorkspaceResolutionAction[] = [
            { kind: "locate", label: "Locate moved folder" },
            { kind: "clone", label: "Clone again" },
            {
              kind: "forget",
              workspaceId: workspace.workspaceId,
              label: "Forget stale binding",
            },
          ]

          return {
            status: "broken-binding" as const,
            projectId,
            workspace: recordToDTO(workspace),
            reason: verification.status,
            actions,
          }
        }

        // Persist verified state
        yield* updateVerificationStatus(
          workspace.workspaceId,
          "verified",
          null,
          {
            realPath: verification.realPath,
            markerWorkspaceId: verification.markerWorkspaceId,
            markerProjectId: verification.markerProjectId,
            markerPath: verification.markerPath,
            gitRepoIdentityJson: verification.repoIdentity
              ? JSON.stringify(verification.repoIdentity)
              : null,
          },
        ).pipe(Effect.catch(() => Effect.void))

        const lane = yield* ensureDefaultLane(workspace)

        yield* emitEvent(workspace.workspaceId, projectId, "workspace.opened").pipe(
          Effect.catch(() => Effect.void),
        )

        // Re-read workspace after updates
        const fresh = yield* queryActiveWorkspace(projectId)
        const finalWorkspace = fresh ?? workspace

        return {
          status: "ready" as const,
          projectId,
          workspace: recordToDTO(finalWorkspace),
          lane: laneRecordToDTO(lane),
          runtimeIdentity: buildRuntimeIdentity(finalWorkspace, lane),
          collaborationScopeId: buildCollaborationScopeId(projectId),
        }
      })

    // ── bindExistingFolder ──────────────────────────────────────────────────

    const bindExistingFolder = (
      req: BindExistingFolderRequest,
    ): Effect.Effect<BindExistingFolderResult> =>
      Effect.gen(function* () {
        console.log("[WorkspaceCatalog] bindExistingFolder started:", req)
        const {
          projectId,
          folderPath,
          projectRootRelativePath = ".",
          expectedRepo = null,
          writeMarker: shouldWriteMarker = true,
          setActive = true,
        } = req

        // stat + realpath
                const statResult = yield* Effect.result(
          Effect.tryPromise({ try: () => fs.stat(folderPath), catch: (e) => e }),
        )
        if (statResult._tag === "Failure") {
          return { success: false, error: "Path does not exist or is not accessible" }
        }
        if (!(statResult.success as { isDirectory(): boolean }).isDirectory()) {
          return { success: false, error: "Path is not a directory" }
        }

        const realPathResult = yield* Effect.result(
          Effect.tryPromise({ try: () => fs.realpath(folderPath), catch: (e) => e }),
        )
        if (realPathResult._tag === "Failure") {
          return { success: false, error: "Path does not exist or is not accessible" }
        }
        const realPath = realPathResult.success as string

        const projectRootPath =
          projectRootRelativePath === "."
            ? realPath
            : path.join(realPath, projectRootRelativePath)

        // Check if realPath is already claimed by a different workspace
        const existing = yield* sql`
          SELECT workspace_id, project_id FROM local_workspaces
          WHERE real_path = ${realPath}
            AND project_root_relative_path = ${projectRootRelativePath}
          LIMIT 1
        `.pipe(Effect.map((rows) => rows[0] as { workspace_id: string; project_id: string } | undefined))

        if (existing && existing.project_id !== projectId) {
          const conflictId = yield* recordConflict(
            projectId,
            null,
            folderPath,
            existing.workspace_id,
            existing.project_id,
            "duplicate_path",
          )

          const conflict: WorkspaceConflictDTO = {
            conflictId,
            projectId,
            workspaceId: null,
            candidatePath: folderPath,
            candidateRealPath: realPath,
            existingWorkspaceId: existing.workspace_id,
            existingProjectId: existing.project_id,
            reason: "duplicate_path",
            status: "open",
            createdAt: now(),
            resolvedAt: null,
          }

          return { success: false, conflicts: [conflict] }
        }

        // Read repo identity (non-fatal)
        const repoIdentityResult = yield* Effect.result(
          Effect.tryPromise({ try: () => readGitRepoIdentity(projectRootPath), catch: (e) => e }),
        )
        const repoIdentity: RepoIdentity | null =
          repoIdentityResult._tag === "Success" ? ((repoIdentityResult.success as RepoIdentity | null) ?? null) : null

        // Repo mismatch check
        if (expectedRepo && repoIdentity && !repoIdentitiesMatch(repoIdentity, expectedRepo)) {
          return {
            success: false,
            error: `Repo identity mismatch: expected ${expectedRepo.provider}, found ${repoIdentity.provider}`,
          }
        }

        const workspaceId = newId("lws")
        const ts = now()
        const source: WorkspaceSource = "import"

        const gitDirCandidate = path.join(projectRootPath, ".git")
        const hasGit = yield* Effect.tryPromise({
          try: () => fs.access(gitDirCandidate).then(() => true),
          catch: () => false as const,
        }).pipe(Effect.orElseSucceed(() => false as const))

        yield* sql`
          INSERT INTO local_workspaces (
            workspace_id, project_id, root_path, real_path,
            project_root_relative_path, project_root_path,
            git_root_path, git_dir_path,
            git_origin_url, git_repo_identity_json,
            verification_status, source,
            is_active, workspace_revision, created_at, updated_at
          ) VALUES (
            ${workspaceId}, ${projectId}, ${folderPath}, ${realPath},
            ${projectRootRelativePath}, ${projectRootPath},
            ${hasGit ? projectRootPath : null}, ${hasGit ? gitDirCandidate : null},
            ${null}, ${repoIdentity ? JSON.stringify(repoIdentity) : null},
            ${"untrusted"}, ${source},
            ${setActive ? 1 : 0}, ${1}, ${ts}, ${ts}
          )
        `

        if (setActive) {
          yield* doSetActive(workspaceId, projectId)
        }

        if (shouldWriteMarker) {
          yield* Effect.tryPromise({
            try: () =>
              writeWorkspaceMarker(projectRootPath, {
                version: 1,
                workspaceId,
                projectId,
                createdBy: "cozea",
                createdAt: ts,
              }),
            catch: () => new Error("Failed to write marker"),
          }).pipe(Effect.catch(() => Effect.void))
        }

        yield* emitEvent(workspaceId, projectId, "workspace.imported").pipe(
          Effect.catch(() => Effect.void),
        )

        const record = yield* queryWorkspaceById(workspaceId)
        return { success: true, workspace: record ? recordToDTO(record) : undefined }
      }).pipe(
        Effect.catch((e) =>
          Effect.succeed({ success: false, error: String(e) }),
        ),
      )

    // ── createForProject ────────────────────────────────────────────────────

    const createForProject = (
      req: CreateWorkspaceForProjectRequest,
    ): Effect.Effect<CreateWorkspaceForProjectResult> =>
      Effect.gen(function* () {
        console.log("[WorkspaceCatalog] createForProject started:", req)
        const {
          projectId,
          slug,
          rootPathOverride,
          initGit = false,
          setActive = true,
        } = req

        const baseDir =
          rootPathOverride ??
          path.join(
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".",
            "Developer",
            "Cozea",
          )

        // Find an available folder name
        const targetPath = yield* Effect.tryPromise({
          try: () => findAvailablePath(baseDir, slug),
          catch: (e) => new Error(String(e)),
        })
        console.log("[WorkspaceCatalog] createForProject targetPath resolved:", targetPath)

        yield* Effect.tryPromise({
          try: () => fs.mkdir(targetPath, { recursive: true }),
          catch: (e) => new Error(`Failed to create directory: ${String(e)}`),
        })

        if (initGit) {
          yield* Effect.tryPromise({
            try: async () => {
              await runGitCommand(["init"], { cwd: targetPath })
              await fs.writeFile(
                path.join(targetPath, ".gitignore"),
                "node_modules/\n.env\n",
                "utf-8",
              )
            },
            catch: () => new Error("git init failed"),
          }).pipe(Effect.catch(() => Effect.void))
        }

        const bindResult = yield* bindExistingFolder({
          projectId,
          folderPath: targetPath,
          writeMarker: true,
          setActive,
        })

        if (!bindResult.success) {
          return { success: false, error: bindResult.error ?? "bind failed" }
        }

        yield* emitEvent(bindResult.workspace?.workspaceId ?? null, projectId, "workspace.created").pipe(
          Effect.catch(() => Effect.void),
        )

        console.log("[WorkspaceCatalog] createForProject returning:", bindResult.workspace)
        return { success: true, workspace: bindResult.workspace }
      }).pipe(
        Effect.catch((e) =>
          Effect.succeed({ success: false, error: String(e) }),
        ),
      )

    // ── cloneForProject ─────────────────────────────────────────────────────

    const cloneForProject = (
      req: CloneWorkspaceForProjectRequest,
    ): Effect.Effect<CloneWorkspaceForProjectResult> =>
      Effect.gen(function* () {
        const {
          projectId,
          slug,
          repoUrl,
          branch,
          rootPathOverride,
          setActive = true,
        } = req

        const baseDir =
          rootPathOverride ??
          path.join(
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".",
            "Developer",
            "Cozea",
          )

        const targetPath = yield* Effect.tryPromise({
          try: () => findAvailablePath(baseDir, slug),
          catch: (e) => new Error(String(e)),
        })

        const cloneArgs = ["clone", repoUrl, targetPath]
        if (branch) cloneArgs.push("--branch", branch)

        yield* Effect.tryPromise({
          try: async () => {
            const result = await runGitCommand(cloneArgs, { cwd: baseDir })
            if (!result.success) {
              throw new Error(result.error ?? result.stderr ?? "git clone failed")
            }
          },
          catch: (e) => new Error(`git clone failed: ${String(e)}`),
        })

        // Read actual remote URL after clone (non-fatal)
        const repoIdentityResult = yield* Effect.result(
          Effect.tryPromise({ try: () => readGitRepoIdentity(targetPath), catch: (e) => e }),
        )
        const repoIdentity = repoIdentityResult._tag === "Success" ? (repoIdentityResult.success as RepoIdentity | null) : null

        const bindResult = yield* bindExistingFolder({
          projectId,
          folderPath: targetPath,
          writeMarker: true,
          setActive,
        })

        if (!bindResult.success) {
          return { success: false, error: bindResult.error ?? "bind failed" }
        }

        yield* emitEvent(bindResult.workspace?.workspaceId ?? null, projectId, "workspace.cloned").pipe(
          Effect.catch(() => Effect.void),
        )

        return { success: true, workspace: bindResult.workspace, normalizedRepoUrl: repoUrl }
      }).pipe(
        Effect.catch((e) =>
          Effect.succeed({ success: false, error: String(e) }),
        ),
      )

    // ── verify ──────────────────────────────────────────────────────────────

    const verify = (workspaceId: string) =>
      Effect.gen(function* () {
        const record = yield* queryWorkspaceById(workspaceId)
        if (!record) {
          return { status: "missing" as WorkspaceVerificationStatus, workspace: null as unknown as LocalWorkspaceDTO }
        }

        const result = yield* Effect.tryPromise({
          try: () => verifyWorkspacePath(record),
          catch: (e) => new Error(String(e)),
        })

        yield* updateVerificationStatus(workspaceId, result.status, result.reason ?? null).pipe(
          Effect.catch(() => Effect.void),
        )

        const fresh = yield* queryWorkspaceById(workspaceId)
        return {
          status: result.status,
          workspace: recordToDTO(fresh ?? record),
        }
      })

    // ── forget ───────────────────────────────────────────────────────────────

    const forget = (workspaceId: string) =>
      Effect.gen(function* () {
        yield* sql`DELETE FROM workspace_lanes WHERE workspace_id = ${workspaceId}`
        yield* sql`DELETE FROM local_workspaces WHERE workspace_id = ${workspaceId}`
        yield* emitEvent(workspaceId, null, "workspace.forgotten").pipe(
          Effect.catch(() => Effect.void),
        )
      })

    // ── listCandidates ────────────────────────────────────────────────────────

    const listCandidates = (
      projectId: string,
      slug: string,
      roots: string[],
      expectedRepo?: RepoIdentity | null,
    ) =>
      Effect.tryPromise({
        try: () => scanForCandidates({ roots, projectId, slug, expectedRepo }),
        catch: (e) => new Error(String(e)),
      })

    // ── settings ──────────────────────────────────────────────────────────────

    const getSetting = (key: string) =>
      sql`SELECT value FROM workspace_settings WHERE key = ${key} LIMIT 1`.pipe(
        Effect.map((rows) => (rows.length > 0 ? String((rows[0] as { value: string }).value) : null)),
      )

    const setSetting = (key: string, value: string) => {
      const ts = now()
      return sql`
        INSERT INTO workspace_settings (key, value, updated_at)
        VALUES (${key}, ${value}, ${ts})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `.pipe(Effect.asVoid)
    }

    // ── upsertProjectsCache ───────────────────────────────────────────────────

    const upsertProjectsCache = (
      projectId: string,
      data: { slug?: string; name?: string },
    ) => {
      const ts = now()
      return sql`
        INSERT INTO local_projects_cache (project_id, slug, name, updated_at)
        VALUES (${projectId}, ${data.slug ?? null}, ${data.name ?? null}, ${ts})
        ON CONFLICT(project_id) DO UPDATE SET
          slug = coalesce(excluded.slug, slug),
          name = coalesce(excluded.name, name),
          updated_at = excluded.updated_at
      `.pipe(Effect.asVoid)
    }

    return {
      resolveProject,
      getActive: queryActiveWorkspace,
      listForProject: (projectId) =>
        sql`SELECT * FROM local_workspaces WHERE project_id = ${projectId}`.pipe(
          Effect.map((rows) => rows.map((r) => mapRow(r as Record<string, unknown>))),
        ),
      bindExistingFolder,
      createForProject,
      cloneForProject,
      verify,
      forget,
      listCandidates,
      setActive: doSetActive,
      getById: (workspaceId: string) =>
        Effect.gen(function* () {
          const w = yield* queryWorkspaceById(workspaceId)
          return w ? recordToDTO(w) : null
        }),
      upsertProjectsCache,
      getSetting,
      setSetting,
    }
  }),
)
