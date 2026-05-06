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
  ImportExistingFolderRequest,
  ImportExistingFolderResult,
  LocalWorkspaceDTO,
  LocalWorkspaceRecord,
  RepoIdentity,
  ResolveProjectWorkspaceRequest,
  ResolveProjectWorkspaceResult,
  RuntimeIdentityDTO,
  WorkspaceCandidate,
  WorkspaceConflictDTO,
  WorkspaceLaneDTO,
  WorkspaceLaneRecord,
  WorkspaceResolutionAction,
  WorkspaceVerificationStatus,
} from "../../shared/workspaceTypes.ts"
import { deleteWorkspaceMarker, readWorkspaceMarker, writeWorkspaceMarker } from "./markers.ts"
import { parseRepoIdentity, readGitRepoIdentity, repoIdentitiesMatch } from "./repoIdentity.ts"
import { verifyWorkspacePath } from "./verification.ts"
import { scanForCandidates } from "./candidates.ts"
import { runGitCommand } from "../gitRuntime.ts"
import {
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from "../services/generatedArtifactFilters.ts"

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RECENT_VERIFICATION_TTL_MS = 30_000

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
  const payload = `${projectId}::${workspaceId}::${laneId}::v${workspaceRevision}`
  const hash = crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16)
  return `rsi_${hash}`
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

function isNestedDirectory(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath)
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function isSameOrNestedDirectory(parentPath: string, childPath: string): boolean {
  return parentPath === childPath || isNestedDirectory(parentPath, childPath)
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function formatWorkspaceCatalogError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (error && typeof error === "object") {
    const record = error as {
      message?: unknown
      cause?: unknown
      error?: unknown
      reason?: unknown
      code?: unknown
    }
    const message = normalizeOptionalString(record.message)
    if (message) {
      const causeMessage = formatWorkspaceCatalogError(record.cause)
      return causeMessage && causeMessage !== String(record.cause)
        ? `${message}: ${causeMessage}`
        : message
    }

    for (const key of ["cause", "error", "reason", "code"] as const) {
      const value = record[key]
      if (value !== undefined && value !== null) {
        const formatted = formatWorkspaceCatalogError(value)
        if (formatted) return formatted
      }
    }
  }

  return String(error)
}

function shouldExcludeImportCopyPath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = path.relative(sourceRoot, sourcePath)
  if (!relativePath) return false

  const normalizedPath = relativePath.replace(/\\/g, "/")
  if (normalizedPath === ".cozea/workspace.json") return true
  if (normalizedPath === ".git/cozea/workspace.json") return true

  const entryName = path.basename(sourcePath)
  if (shouldExcludeGeneratedDirectory(entryName)) return true
  return shouldExcludeGeneratedFile(normalizedPath)
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

function defaultResolutionActions(workspaceId?: string): WorkspaceResolutionAction[] {
  const actions: WorkspaceResolutionAction[] = [
    { kind: "clone", label: "Clone repository" },
    { kind: "create", label: "Create local folder" },
    { kind: "locate", label: "Locate existing folder" },
  ]
  if (workspaceId) {
    actions.push({ kind: "forget", workspaceId, label: "Forget stale binding" })
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

  readonly importExistingFolder: (
    req: ImportExistingFolderRequest,
  ) => Effect.Effect<ImportExistingFolderResult>

  readonly cloneForProject: (
    req: CloneWorkspaceForProjectRequest,
  ) => Effect.Effect<CloneWorkspaceForProjectResult>

  readonly verify: (
    workspaceId: string,
  ) => Effect.Effect<{ status: WorkspaceVerificationStatus; workspace: LocalWorkspaceDTO }>

  readonly getById: (
    workspaceId: string,
  ) => Effect.Effect<LocalWorkspaceDTO | null>

  readonly getLane: (
    workspaceId: string,
    laneId?: string | null,
  ) => Effect.Effect<WorkspaceLaneDTO | null>

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

    const queryLaneById = (laneId: string) =>
      sql`
        SELECT * FROM workspace_lanes
        WHERE lane_id = ${laneId}
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows.length > 0 ? mapLaneRow(rows[0] as Record<string, unknown>) : null,
        ),
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
      candidateRealPath: string | null,
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
          candidate_path, candidate_real_path,
          existing_workspace_id, existing_project_id,
          reason, details_json, status, created_at
        ) VALUES (
          ${conflictId}, ${projectId ?? null}, ${workspaceId ?? null},
          ${candidatePath}, ${candidateRealPath},
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

    const deleteMarkerAtProjectRoot = (projectRootPath: string) =>
      Effect.tryPromise({
        try: () => deleteWorkspaceMarker(projectRootPath),
        catch: (e) => e,
      }).pipe(Effect.catch(() => Effect.void))

    const deleteMarkerForWorkspace = (workspace: LocalWorkspaceRecord) =>
      Effect.tryPromise({
        try: () =>
          deleteWorkspaceMarker(workspace.projectRootPath, {
            projectId: workspace.projectId,
            workspaceId: workspace.workspaceId,
          }),
        catch: (e) => e,
      }).pipe(Effect.catch(() => Effect.void))

    const forgetWorkspaceBinding = (
      workspaceId: string,
      details?: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const record = yield* queryWorkspaceById(workspaceId)
        if (record) {
          yield* deleteMarkerForWorkspace(record)
        }
        yield* sql`DELETE FROM workspace_lanes WHERE workspace_id = ${workspaceId}`
        yield* sql`DELETE FROM local_workspaces WHERE workspace_id = ${workspaceId}`
        yield* emitEvent(workspaceId, record?.projectId ?? null, "workspace.forgotten", details).pipe(
          Effect.catch(() => Effect.void),
        )
      })

    const cleanupMissingWorkspaceBindingsUnderRoot = (rootPath: string) =>
      Effect.gen(function* () {
        const rows = yield* sql`
          SELECT workspace_id, project_root_path, real_path
          FROM local_workspaces
        `

        for (const row of rows as Array<Record<string, unknown>>) {
          const workspaceId = normalizeOptionalString(row.workspace_id ?? row.workspaceId)
          const projectRootPath = normalizeOptionalString(row.project_root_path ?? row.projectRootPath)
          const realPath = normalizeOptionalString(row.real_path ?? row.realPath) ?? projectRootPath
          if (!workspaceId || !projectRootPath || !realPath) continue
          if (!isSameOrNestedDirectory(rootPath, realPath)) continue

          const exists = yield* Effect.tryPromise({
            try: () => fs.access(projectRootPath).then(() => true),
            catch: () => false as const,
          }).pipe(Effect.orElseSucceed(() => false as const))
          if (exists) continue

          yield* forgetWorkspaceBinding(workspaceId, {
            reason: "missing_managed_project_root",
            projectRootPath,
            realPath,
          })
        }
      })

    const resolveLocalRoot = (
      rootId?: string,
      rootPathOverride?: string,
    ) =>
      Effect.gen(function* () {
        if (rootPathOverride) {
          const rootPath = rootPathOverride.trim()
          if (!rootPath) {
            throw new Error("rootPathOverride is required")
          }
          yield* Effect.tryPromise({
            try: () => fs.mkdir(rootPath, { recursive: true }),
            catch: (e) => e,
          })
          const statResult = yield* Effect.result(
            Effect.tryPromise({ try: () => fs.stat(rootPath), catch: (e) => e }),
          )
          if (statResult._tag === "Failure" || !(statResult.success as { isDirectory(): boolean }).isDirectory()) {
            throw new Error("rootPathOverride is not a valid directory")
          }
          const realPathResult = yield* Effect.result(
            Effect.tryPromise({ try: () => fs.realpath(rootPath), catch: (e) => e }),
          )
          if (realPathResult._tag === "Failure") {
            throw new Error("Failed to resolve real path for rootPathOverride")
          }
          const realPath = realPathResult.success as string

          const existingRoot = yield* sql`
            SELECT * FROM local_roots WHERE real_path = ${realPath} LIMIT 1
          `.pipe(Effect.map((rows) => rows[0] as { root_id: string } | undefined))

          if (existingRoot) {
            return { rootId: existingRoot.root_id, realPath }
          }

          const newRootId = newId("lwr")
          const ts = now()
          yield* sql`
            INSERT INTO local_roots (root_id, path, real_path, kind, created_at, updated_at)
            VALUES (${newRootId}, ${rootPath}, ${realPath}, ${"user_added"}, ${ts}, ${ts})
          `
          return { rootId: newRootId, realPath }
        }

        if (rootId) {
          const rootRow = yield* sql`
            SELECT real_path FROM local_roots WHERE root_id = ${rootId} LIMIT 1
          `.pipe(Effect.map((rows) => rows[0] as { real_path: string } | undefined))
          if (rootRow) {
            return { rootId, realPath: rootRow.real_path }
          }
          throw new Error(`Root ${rootId} not found`)
        }

        // Default to settings projectsDirectory
        const settingsProjectsDirectory = yield* sql`
            SELECT value FROM workspace_settings WHERE key = 'projectsDirectory' LIMIT 1
          `.pipe(
            Effect.map((rows) => (rows.length > 0 ? String((rows[0] as { value: string }).value) : null)),
          )
        
        const baseDir =
          settingsProjectsDirectory ??
          path.join(
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".",
            "Developer",
            "Cozea",
          )
        
        const realPathResult = yield* Effect.result(
            Effect.tryPromise({ try: () => fs.realpath(baseDir), catch: (e) => e }),
          )
          if (realPathResult._tag === "Failure") {
            yield* Effect.tryPromise({ try: () => fs.mkdir(baseDir, { recursive: true }), catch: (e) => e })
          }

        const realPath = yield* Effect.tryPromise({ try: () => fs.realpath(baseDir), catch: (e) => new Error(String(e)) })

        const existingRoot = yield* sql`
            SELECT * FROM local_roots WHERE real_path = ${realPath} LIMIT 1
          `.pipe(Effect.map((rows) => rows[0] as { root_id: string } | undefined))

        if (existingRoot) {
          return { rootId: existingRoot.root_id, realPath }
        }

        const newRootId = newId("lwr")
        const ts = now()
        yield* sql`
          INSERT INTO local_roots (root_id, path, real_path, kind, created_at, updated_at)
          VALUES (${newRootId}, ${baseDir}, ${realPath}, ${"default"}, ${ts}, ${ts})
        `
        return { rootId: newRootId, realPath }
      })

    const listCandidateRoots = () =>
      Effect.gen(function* () {
        const roots = new Set<string>()
        const settingsProjectsDirectory = yield* sql`
          SELECT value FROM workspace_settings WHERE key = 'projectsDirectory' LIMIT 1
        `.pipe(
          Effect.map((rows) => (rows.length > 0 ? String((rows[0] as { value: string }).value) : null)),
        )

        if (settingsProjectsDirectory) {
          roots.add(settingsProjectsDirectory)
        }

        const localRootRows = yield* sql`SELECT real_path FROM local_roots`
        for (const row of localRootRows as Array<{ real_path?: string }>) {
          if (row.real_path) roots.add(row.real_path)
        }

        if (roots.size === 0) {
          roots.add(path.join(
            process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".",
            "Developer",
            "Cozea",
          ))
        }

        return Array.from(roots)
      })

    const scanCandidateRoots = (
      projectId: string,
      projectSlug: string,
      expectedRepo?: RepoIdentity | null,
    ) =>
      Effect.gen(function* () {
        const roots = yield* listCandidateRoots()
        return yield* Effect.tryPromise({
          try: () => scanForCandidates({ roots, projectId, slug: projectSlug, expectedRepo: expectedRepo ?? undefined }),
          catch: (e) => new Error(String(e)),
        }).pipe(Effect.orElseSucceed(() => []))
      })

    // ── resolveProject ──────────────────────────────────────────────────────

    const resolveProject = (
      req: ResolveProjectWorkspaceRequest,
    ): Effect.Effect<ResolveProjectWorkspaceResult> =>
      Effect.gen(function* () {
        const { projectId, projectSlug, expectedRepo, preferredWorkspaceId, preferredLaneId, allowCandidateScan = false } = req

        let workspace: LocalWorkspaceRecord | null = null
        if (preferredWorkspaceId) {
          workspace = yield* queryWorkspaceById(preferredWorkspaceId)
          if (workspace && workspace.projectId !== projectId) {
            return {
              status: "broken-binding" as const,
              projectId,
              workspace: recordToDTO(workspace),
              reason: "marker-mismatched-project",
              actions: [
                {
                  kind: "forget",
                  workspaceId: workspace.workspaceId,
                  label: "Forget stale binding",
                },
              ],
            }
          }
        }
        if (!workspace) {
          workspace = yield* queryActiveWorkspace(projectId)
        }

        if (!workspace) {
          const result: ResolveProjectWorkspaceResult = {
            status: "missing-binding" as const,
            projectId,
            actions: defaultResolutionActions(),
          }

          if (allowCandidateScan && projectSlug) {
            const candidates = yield* scanCandidateRoots(projectId, projectSlug, expectedRepo)
            return {
              ...result,
              candidates,
            }
          }

          return result
        }

        const verificationIsRecent =
          !expectedRepo &&
          workspace.verificationStatus === "verified" &&
          typeof workspace.verifiedAt === "number" &&
          now() - workspace.verifiedAt <= RECENT_VERIFICATION_TTL_MS
        const verification = verificationIsRecent
          ? null
          : yield* Effect.tryPromise({
              try: () => verifyWorkspacePath(workspace!, expectedRepo ?? null),
              catch: (e) => new Error(`Verification failed: ${String(e)}`),
            })

        if (verification && verification.status !== "verified") {
          // Persist the new status
          yield* updateVerificationStatus(
            workspace.workspaceId,
            verification.status,
            verification.reason ?? null,
          ).pipe(Effect.catch(() => Effect.void))

          const result: ResolveProjectWorkspaceResult = {
            status: "broken-binding" as const,
            projectId,
            workspace: recordToDTO(workspace),
            reason: verification.status,
            actions: [
              { kind: "locate", label: "Locate moved folder" },
              { kind: "clone", label: "Clone again" },
              {
                kind: "forget",
                workspaceId: workspace.workspaceId,
                label: "Forget stale binding",
              },
            ],
          }

          if (allowCandidateScan && projectSlug) {
            const candidates = yield* scanCandidateRoots(projectId, projectSlug, expectedRepo)
            return {
              ...result,
              candidates,
            }
          }

          return result
        }

        // Persist verified state
        if (verification) {
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
        }

        let lane: WorkspaceLaneRecord | null = null
        if (preferredLaneId) {
          lane = yield* queryLaneById(preferredLaneId)
        }
        if (!lane || lane.workspaceId !== workspace.workspaceId) {
          lane = yield* ensureDefaultLane(workspace)
        }

        yield* emitEvent(workspace.workspaceId, projectId, "workspace.opened").pipe(
          Effect.catch(() => Effect.void),
        )

        // Re-read the same workspace after updates. Do not fall back to the
        // active workspace when the caller asked for a preferred workspace.
        const fresh = yield* queryWorkspaceById(workspace.workspaceId)
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
          forceBind = false,
          source = "import",
        } = req

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

        if (existing) {
          if (existing.project_id !== projectId) {
            if (forceBind) {
              yield* forgetWorkspaceBinding(existing.workspace_id, {
                reason: "force_rebind",
                replacementProjectId: projectId,
              })
            } else {
              const conflictId = yield* recordConflict(
                projectId,
                null,
                folderPath,
                realPath,
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
          } else {
            // P1-08: Same project duplicate bind. Return existing workspace.
            if (setActive) {
              yield* doSetActive(existing.workspace_id, projectId)
            }
            const record = yield* queryWorkspaceById(existing.workspace_id)
            return { success: true, workspace: record ? recordToDTO(record) : undefined }
          }
        }

        // P1-05: Prevent marker overwrite on mismatches
        const existingMarkerResult = yield* Effect.result(
          Effect.tryPromise({ try: () => readWorkspaceMarker(projectRootPath), catch: (e) => e }),
        )
        const existingMarker = existingMarkerResult._tag === "Success" ? existingMarkerResult.success : null

        let workspaceId: string | undefined = undefined

        if (existingMarker) {
          const markerWorkspace = existingMarker.marker.workspaceId
            ? yield* queryWorkspaceById(existingMarker.marker.workspaceId)
            : null
          const markerIsTracked = markerWorkspace?.projectId === existingMarker.marker.projectId

          if (existingMarker.marker.projectId !== projectId) {
            if (forceBind || !markerIsTracked) {
              yield* deleteMarkerAtProjectRoot(projectRootPath)
            } else {
              const conflictId = yield* recordConflict(
                projectId,
                null,
                folderPath,
                realPath,
                existingMarker.marker.workspaceId,
                existingMarker.marker.projectId,
                "marker_mismatch",
              )

              const conflict: WorkspaceConflictDTO = {
                conflictId,
                projectId,
                workspaceId: null,
                candidatePath: folderPath,
                candidateRealPath: realPath,
                existingWorkspaceId: existingMarker.marker.workspaceId,
                existingProjectId: existingMarker.marker.projectId,
                reason: "marker_mismatch",
                status: "open",
                createdAt: now(),
                resolvedAt: null,
              }
              return { success: false, conflicts: [conflict] }
            }
          } else if (existingMarker.marker.workspaceId !== undefined) {
            if (forceBind || !markerIsTracked) {
              yield* deleteMarkerAtProjectRoot(projectRootPath)
            } else {
              const conflictId = yield* recordConflict(
                projectId,
                null,
                folderPath,
                realPath,
                existingMarker.marker.workspaceId,
                projectId,
                "marker_mismatch",
                { markerWorkspaceId: existingMarker.marker.workspaceId },
              )

              const conflict: WorkspaceConflictDTO = {
                conflictId,
                projectId,
                workspaceId: null,
                candidatePath: folderPath,
                candidateRealPath: realPath,
                existingWorkspaceId: existingMarker.marker.workspaceId,
                existingProjectId: projectId,
                reason: "marker_mismatch",
                status: "open",
                createdAt: now(),
                resolvedAt: null,
              }
              return { success: false, conflicts: [conflict] }
            }
          }
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

        if (!workspaceId) {
          workspaceId = newId("lws")
        }
        const ts = now()

        const gitDirCandidate = path.join(projectRootPath, ".git")
        const hasGit = yield* Effect.tryPromise({
          try: () => fs.access(gitDirCandidate).then(() => true),
          catch: () => false as const,
        }).pipe(Effect.orElseSucceed(() => false as const))

        yield* sql`
          INSERT INTO local_workspaces (
            workspace_id, project_id, root_id, root_path, real_path,
            project_root_relative_path, project_root_path,
            git_root_path, git_dir_path,
            git_origin_url, git_repo_identity_json,
            verification_status, source,
            is_active, workspace_revision, created_at, updated_at
          ) VALUES (
            ${workspaceId}, ${projectId}, ${null}, ${folderPath}, ${realPath},
            ${projectRootRelativePath}, ${projectRootPath},
            ${hasGit ? projectRootPath : null}, ${hasGit ? gitDirCandidate : null},
            ${repoIdentity ? repoIdentity.url : null}, ${repoIdentity ? JSON.stringify(repoIdentity) : null},
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
          Effect.succeed({ success: false, error: formatWorkspaceCatalogError(e) }),
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
          rootId,
          rootPathOverride,
          initGit = false,
          setActive = true,
        } = req

        const resolvedRoot = yield* resolveLocalRoot(rootId, rootPathOverride)
        const baseDir = resolvedRoot.realPath
        yield* cleanupMissingWorkspaceBindingsUnderRoot(baseDir).pipe(
          Effect.catch(() => Effect.void),
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
          source: "create",
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
          Effect.succeed({ success: false, error: formatWorkspaceCatalogError(e) }),
        ),
      )

    // ── importExistingFolder ────────────────────────────────────────────────

    const importExistingFolder = (
      req: ImportExistingFolderRequest,
    ): Effect.Effect<ImportExistingFolderResult> =>
      Effect.gen(function* () {
        const {
          projectId,
          sourceFolderPath,
          slug,
          rootId,
          rootPathOverride,
          setActive = true,
        } = req

        const sourceStatResult = yield* Effect.result(
          Effect.tryPromise({ try: () => fs.stat(sourceFolderPath), catch: (e) => e }),
        )
        if (sourceStatResult._tag === "Failure") {
          return { success: false, error: "Source folder does not exist or is not accessible" }
        }
        if (!(sourceStatResult.success as { isDirectory(): boolean }).isDirectory()) {
          return { success: false, error: "Source path is not a directory" }
        }

        const sourceRealPath = yield* Effect.tryPromise({
          try: () => fs.realpath(sourceFolderPath),
          catch: (e) => new Error(String(e)),
        })
        const resolvedRoot = yield* resolveLocalRoot(rootId, rootPathOverride)
        const baseDir = resolvedRoot.realPath

        if (sourceRealPath === baseDir) {
          return { success: false, error: "Choose a project folder, not the Cozea projects directory." }
        }
        yield* cleanupMissingWorkspaceBindingsUnderRoot(baseDir).pipe(
          Effect.catch(() => Effect.void),
        )

        const targetPath = yield* Effect.tryPromise({
          try: () => findAvailablePath(baseDir, slug),
          catch: (e) => new Error(String(e)),
        })

        if (isNestedDirectory(sourceRealPath, targetPath)) {
          return { success: false, error: "Source and imported project folders cannot be nested." }
        }

        yield* Effect.tryPromise({
          try: () =>
            fs.cp(sourceRealPath, targetPath, {
              recursive: true,
              force: false,
              errorOnExist: true,
              filter: (sourcePath) => !shouldExcludeImportCopyPath(sourceRealPath, sourcePath),
            }),
          catch: (e) => new Error(`Failed to copy project folder: ${String(e)}`),
        })

        const bindResult = yield* bindExistingFolder({
          projectId,
          folderPath: targetPath,
          writeMarker: true,
          setActive,
          forceBind: true,
          source: "import",
        })

        if (!bindResult.success) {
          yield* Effect.tryPromise({
            try: () => fs.rm(targetPath, { recursive: true, force: true }),
            catch: () => undefined,
          }).pipe(Effect.catch(() => Effect.void))
          return { success: false, error: bindResult.error ?? "bind failed" }
        }

        yield* emitEvent(bindResult.workspace?.workspaceId ?? null, projectId, "workspace.imported.copy", {
          sourceFolderPath: sourceRealPath,
          targetPath,
        }).pipe(Effect.catch(() => Effect.void))

        return {
          success: true,
          workspace: bindResult.workspace,
          importedFrom: sourceRealPath,
          copiedTo: targetPath,
        }
      }).pipe(
        Effect.catch((e) =>
          Effect.succeed({ success: false, error: formatWorkspaceCatalogError(e) }),
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
          rootId,
          rootPathOverride,
          setActive = true,
        } = req

        const resolvedRoot = yield* resolveLocalRoot(rootId, rootPathOverride)
        const baseDir = resolvedRoot.realPath
        yield* cleanupMissingWorkspaceBindingsUnderRoot(baseDir).pipe(
          Effect.catch(() => Effect.void),
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
        const expectedRepo = repoIdentity ?? parseRepoIdentity(repoUrl)

        const bindResult = yield* bindExistingFolder({
          projectId,
          folderPath: targetPath,
          writeMarker: true,
          setActive,
          source: "clone",
          expectedRepo,
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
          Effect.succeed({ success: false, error: formatWorkspaceCatalogError(e) }),
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
      forgetWorkspaceBinding(workspaceId)

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
      importExistingFolder,
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
      getLane: (workspaceId: string, laneId?: string | null) =>
        Effect.gen(function* () {
          let l = laneId ? yield* queryLaneById(laneId) : yield* queryActiveLane(workspaceId)
          if (!l) {
            const w = yield* queryWorkspaceById(workspaceId)
            if (w) {
              l = yield* ensureDefaultLane(w)
            }
          }
          return l ? laneRecordToDTO(l) : null
        }),
      upsertProjectsCache,
      getSetting,
      setSetting,
    }
  }),
)
