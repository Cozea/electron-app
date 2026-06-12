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
  WorkspaceCatalogSnapshotEntry,
  WorkspaceConflictDTO,
  WorkspaceLaneDTO,
  WorkspaceLaneRecord,
  WorkspaceResolutionAction,
  WorkspaceVerificationStatus,
} from "../../shared/workspaceTypes.ts"
import { readWorkspaceMarker, writeWorkspaceMarker } from "./markers.ts"
import { parseRepoIdentity, readGitRepoIdentity, repoIdentitiesMatch } from "./repoIdentity.ts"
import { verifyWorkspacePath } from "./verification.ts"
import { scanForCandidates } from "./candidates.ts"
import { runGitCommand } from "../gitRuntime.ts"

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

function toDisplayPath(projectRootPath: string): string {
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""
  // Require a separator after the prefix so /Users/adminx doesn't render as ~x.
  if (home && (projectRootPath === home || projectRootPath.startsWith(home + path.sep))) {
    return `~${projectRootPath.slice(home.length)}`
  }
  return projectRootPath
}

function recordToDTO(r: LocalWorkspaceRecord): LocalWorkspaceDTO {
  const displayPath = toDisplayPath(r.projectRootPath)

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
  const displayPath = toDisplayPath(r.projectRootPath)

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

  readonly cloneForProject: (
    req: CloneWorkspaceForProjectRequest,
  ) => Effect.Effect<CloneWorkspaceForProjectResult>

  readonly verify: (
    workspaceId: string,
  ) => Effect.Effect<{ status: WorkspaceVerificationStatus; workspace: LocalWorkspaceDTO | null }>

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

  /** Read-only: one entry per project with an active workspace. */
  readonly buildSnapshotEntries: () => Effect.Effect<WorkspaceCatalogSnapshotEntry[]>

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

const EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const EVENT_RETENTION_MAX_ROWS = 5_000

export const WorkspaceCatalogLive = Layer.effect(
  WorkspaceCatalog,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // Bounded event log: prune by age and count once per runtime start.
    yield* sql`
      DELETE FROM workspace_events WHERE created_at < ${Date.now() - EVENT_RETENTION_MS}
    `.pipe(Effect.catch(() => Effect.void))
    yield* sql`
      DELETE FROM workspace_events
      WHERE event_id NOT IN (
        SELECT event_id FROM workspace_events
        ORDER BY created_at DESC
        LIMIT ${EVENT_RETENTION_MAX_ROWS}
      )
    `.pipe(Effect.catch(() => Effect.void))

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
        ORDER BY created_at ASC
        LIMIT 1
      `.pipe(
        Effect.map((rows) =>
          rows.length > 0 ? mapLaneRow(rows[0] as Record<string, unknown>) : null,
        ),
      )

    const ensureDefaultLane = (workspace: LocalWorkspaceRecord) =>
      sql
        .withTransaction(
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
          }),
        )
        .pipe(
          // A concurrent resolve can win the insert; the unique active-lane
          // index rejects ours — the winner's lane is the right answer.
          Effect.catch(() =>
            Effect.flatMap(queryActiveLane(workspace.workspaceId), (lane) =>
              lane ? Effect.succeed(lane) : Effect.die("ensureDefaultLane: no active lane after conflict"),
            ),
          ),
        )

    const doSetActive = (workspaceId: string, projectId: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const ts = now()
          yield* sql`
            UPDATE local_workspaces
            SET is_active = 0, updated_at = ${ts}
            WHERE project_id = ${projectId} AND workspace_id != ${workspaceId} AND is_active != 0
          `
          yield* sql`
            UPDATE local_workspaces
            SET is_active = 1, updated_at = ${ts}, last_opened_at = ${ts}
            WHERE workspace_id = ${workspaceId}
          `
        }),
      )

    const updateVerificationStatus = (
      workspaceId: string,
      status: WorkspaceVerificationStatus,
      reason: string | null,
    ) => {
      const ts = now()
      return sql`
        UPDATE local_workspaces
        SET
          verification_status = ${status},
          verification_reason = ${reason ?? null},
          verified_at = ${ts},
          updated_at = ${ts}
        WHERE workspace_id = ${workspaceId}
      `.pipe(Effect.asVoid)
    }

    const recordVerifiedState = (
      workspaceId: string,
      extra: {
        realPath?: string
        markerWorkspaceId: string | null
        markerProjectId: string | null
        markerPath: string | null
        gitRepoIdentityJson: string | null
      },
    ) => {
      const ts = now()
      return sql`
        UPDATE local_workspaces
        SET
          verification_status = ${"verified"},
          verification_reason = ${null},
          verified_at = ${ts},
          updated_at = ${ts},
          real_path = coalesce(${extra.realPath ?? null}, real_path),
          marker_workspace_id = ${extra.markerWorkspaceId},
          marker_project_id = ${extra.markerProjectId},
          marker_path = ${extra.markerPath},
          git_repo_identity_json = ${extra.gitRepoIdentityJson}
        WHERE workspace_id = ${workspaceId}
      `.pipe(Effect.asVoid)
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

    const recordAndBuildConflict = (args: {
      projectId: string
      candidatePath: string
      candidateRealPath: string | null
      existingWorkspaceId: string | null
      existingProjectId: string | null
      reason: WorkspaceConflictDTO["reason"]
      details?: Record<string, unknown>
    }) =>
      Effect.gen(function* () {
        const conflictId = yield* recordConflict(
          args.projectId,
          null,
          args.candidatePath,
          args.candidateRealPath,
          args.existingWorkspaceId,
          args.existingProjectId,
          args.reason,
          args.details,
        )
        const conflict: WorkspaceConflictDTO = {
          conflictId,
          projectId: args.projectId,
          workspaceId: null,
          candidatePath: args.candidatePath,
          candidateRealPath: args.candidateRealPath,
          existingWorkspaceId: args.existingWorkspaceId,
          existingProjectId: args.existingProjectId,
          reason: args.reason,
          status: "open",
          createdAt: now(),
          resolvedAt: null,
        }
        return conflict
      })

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

    // Find-or-create a local_roots row keyed by real_path. Transactional so a
    // concurrent caller cannot double-insert the same root.
    const upsertLocalRoot = (rawPath: string, realPath: string, kind: string) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const existingRoot = yield* sql`
            SELECT * FROM local_roots WHERE real_path = ${realPath} LIMIT 1
          `.pipe(Effect.map((rows) => rows[0] as { rootId: string } | undefined))

          if (existingRoot) {
            return { rootId: existingRoot.rootId, realPath }
          }

          const newRootId = newId("lwr")
          const ts = now()
          yield* sql`
            INSERT INTO local_roots (root_id, path, real_path, kind, created_at, updated_at)
            VALUES (${newRootId}, ${rawPath}, ${realPath}, ${kind}, ${ts}, ${ts})
          `
          return { rootId: newRootId, realPath }
        }),
      )

    const resolveLocalRoot = (
      rootId?: string,
      rootPathOverride?: string,
    ) =>
      Effect.gen(function* () {
        if (rootPathOverride) {
          const statResult = yield* Effect.result(
            Effect.tryPromise({ try: () => fs.stat(rootPathOverride), catch: (e) => e }),
          )
          if (statResult._tag === "Failure" || !(statResult.success as { isDirectory(): boolean }).isDirectory()) {
            throw new Error("rootPathOverride is not a valid directory")
          }
          const realPathResult = yield* Effect.result(
            Effect.tryPromise({ try: () => fs.realpath(rootPathOverride), catch: (e) => e }),
          )
          if (realPathResult._tag === "Failure") {
            throw new Error("Failed to resolve real path for rootPathOverride")
          }
          const realPath = realPathResult.success as string

          return yield* upsertLocalRoot(rootPathOverride, realPath, "user_added")
        }

        if (rootId) {
          const rootRow = yield* sql`
            SELECT real_path FROM local_roots WHERE root_id = ${rootId} LIMIT 1
          `.pipe(Effect.map((rows) => rows[0] as { realPath: string } | undefined))
          if (rootRow) {
            return { rootId, realPath: rootRow.realPath }
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

        return yield* upsertLocalRoot(baseDir, realPath, "default")
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
        for (const row of localRootRows as Array<{ realPath?: string }>) {
          if (row.realPath) roots.add(row.realPath)
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
          ).pipe(Effect.catch(() => Effect.void)) // status persist is best-effort

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
          yield* recordVerifiedState(workspace.workspaceId, {
            realPath: verification.realPath,
            markerWorkspaceId: verification.markerWorkspaceId ?? null,
            markerProjectId: verification.markerProjectId ?? null,
            markerPath: verification.markerPath ?? null,
            gitRepoIdentityJson: verification.repoIdentity
              ? JSON.stringify(verification.repoIdentity)
              : null,
          }).pipe(Effect.catch(() => Effect.void))
        }

        let lane: WorkspaceLaneRecord | null = null
        if (preferredLaneId) {
          lane = yield* queryLaneById(preferredLaneId)
        }
        if (!lane || lane.workspaceId !== workspace.workspaceId) {
          lane = yield* ensureDefaultLane(workspace)
        }

        // No event here: resolution is a read path that runs once per sidebar
        // row and once per layout mount — logging it ballooned workspace_events.

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

        // stat + realpath (all fs work stays outside the DB transaction below)
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

        // Read the marker before touching the DB. Cross-project markers are
        // hard conflicts; same-project markers carry the durable workspace
        // identity we adopt (P1-05 without the forget→re-import dead end).
        const existingMarkerResult = yield* Effect.result(
          Effect.tryPromise({ try: () => readWorkspaceMarker(projectRootPath), catch: (e) => e }),
        )
        const existingMarker = existingMarkerResult._tag === "Success" ? existingMarkerResult.success : null

        // Cross-project markers conflict — but only after the DB row check in
        // the transaction below, so a folder already bound to another project
        // reports the more actionable duplicate_path.
        const markerProjectMismatch = Boolean(
          existingMarker && existingMarker.marker.projectId !== projectId,
        )

        // Same-project marker: reuse its workspaceId so identity survives a
        // catalog reset or forget. forceBind opts out and mints a fresh id.
        const markerWorkspaceId =
          !forceBind &&
          existingMarker &&
          existingMarker.marker.projectId === projectId &&
          typeof existingMarker.marker.workspaceId === "string" &&
          existingMarker.marker.workspaceId.length > 0
            ? existingMarker.marker.workspaceId
            : null

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

        const gitDirCandidate = path.join(projectRootPath, ".git")
        const hasGit = yield* Effect.tryPromise({
          try: () => fs.access(gitDirCandidate).then(() => true),
          catch: () => false as const,
        }).pipe(Effect.orElseSucceed(() => false as const))

        // All catalog mutations are one transaction: the duplicate check, the
        // insert/heal, and the active swap commit or roll back together.
        const txOutcome = yield* sql.withTransaction(
          Effect.gen(function* () {
            const ts = now()

            const existing = yield* sql`
              SELECT workspace_id, project_id FROM local_workspaces
              WHERE real_path = ${realPath}
                AND project_root_relative_path = ${projectRootRelativePath}
              LIMIT 1
            `.pipe(Effect.map((rows) => rows[0] as { workspaceId: string; projectId: string } | undefined))

            if (existing) {
              if (existing.projectId !== projectId) {
                const conflict = yield* recordAndBuildConflict({
                  projectId,
                  candidatePath: folderPath,
                  candidateRealPath: realPath,
                  existingWorkspaceId: existing.workspaceId,
                  existingProjectId: existing.projectId,
                  reason: "duplicate_path",
                })
                return { kind: "conflict" as const, conflict }
              }
              // P1-08: Same project duplicate bind. Reuse the existing row.
              if (setActive) {
                yield* doSetActive(existing.workspaceId, projectId)
              }
              return { kind: "existing" as const, workspaceId: existing.workspaceId }
            }

            if (markerProjectMismatch && existingMarker) {
              const conflict = yield* recordAndBuildConflict({
                projectId,
                candidatePath: folderPath,
                candidateRealPath: realPath,
                existingWorkspaceId: existingMarker.marker.workspaceId ?? null,
                existingProjectId: existingMarker.marker.projectId,
                reason: "marker_mismatch",
              })
              return { kind: "conflict" as const, conflict }
            }

            if (markerWorkspaceId) {
              const byMarkerId = yield* queryWorkspaceById(markerWorkspaceId)
              if (byMarkerId && byMarkerId.projectId === projectId) {
                // Distinguish a MOVE from a COPY: a moved folder leaves nothing
                // at the old location, but a backup/rsync copy carries the
                // marker while the original is still there. Repointing a copy
                // would silently steal the original workspace's identity (and
                // retire its live runtimes), so if the original path still
                // exists as a *different* folder, surface a conflict instead.
                const originalStillExists = yield* Effect.promise(async () => {
                  try {
                    const originalReal = await fs.realpath(byMarkerId.rootPath)
                    return originalReal !== realPath
                  } catch {
                    return false
                  }
                })

                if (originalStillExists) {
                  const conflict = yield* recordAndBuildConflict({
                    projectId,
                    candidatePath: folderPath,
                    candidateRealPath: realPath,
                    existingWorkspaceId: byMarkerId.workspaceId,
                    existingProjectId: byMarkerId.projectId,
                    reason: "copied_workspace",
                    details: { markerWorkspaceId, originalPath: byMarkerId.rootPath },
                  })
                  return { kind: "conflict" as const, conflict }
                }

                // The folder moved: repoint the existing row instead of
                // minting a twin. Revision bump retires runtimes that still
                // reference the old location.
                yield* sql`
                  UPDATE local_workspaces
                  SET
                    root_path = ${folderPath},
                    real_path = ${realPath},
                    project_root_relative_path = ${projectRootRelativePath},
                    project_root_path = ${projectRootPath},
                    git_root_path = ${hasGit ? projectRootPath : null},
                    git_dir_path = ${hasGit ? gitDirCandidate : null},
                    git_origin_url = ${repoIdentity ? repoIdentity.url : null},
                    git_repo_identity_json = ${repoIdentity ? JSON.stringify(repoIdentity) : null},
                    verification_status = ${"untrusted"},
                    verification_reason = ${null},
                    source = ${source},
                    workspace_revision = workspace_revision + 1,
                    updated_at = ${ts}
                  WHERE workspace_id = ${markerWorkspaceId}
                `
                // Repoint the workspace's non-worktree lanes too: they keep
                // their own project_root_path/git copies, and resolution reads
                // file/terminal/dev-server/git roots from the LANE. Leaving
                // them stale pointed everything at the old (now ENOENT or
                // wrong) directory. Worktree lanes own separate dirs — leave
                // them untouched.
                yield* sql`
                  UPDATE workspace_lanes
                  SET
                    project_root_relative_path = ${projectRootRelativePath},
                    project_root_path = ${projectRootPath},
                    git_root_path = ${hasGit ? projectRootPath : null},
                    git_dir_path = ${hasGit ? gitDirCandidate : null},
                    updated_at = ${ts}
                  WHERE workspace_id = ${markerWorkspaceId}
                    AND worktree_path IS NULL
                `
                if (setActive) {
                  yield* doSetActive(markerWorkspaceId, projectId)
                }
                return { kind: "moved" as const, workspaceId: markerWorkspaceId }
              }
              if (byMarkerId && byMarkerId.projectId !== projectId) {
                // Marker claims this project but the catalog row belongs to
                // another one — surface it instead of guessing.
                const conflict = yield* recordAndBuildConflict({
                  projectId,
                  candidatePath: folderPath,
                  candidateRealPath: realPath,
                  existingWorkspaceId: byMarkerId.workspaceId,
                  existingProjectId: byMarkerId.projectId,
                  reason: "marker_mismatch",
                  details: { markerWorkspaceId },
                })
                return { kind: "conflict" as const, conflict }
              }
            }

            const workspaceId = markerWorkspaceId ?? newId("lws")
            // Insert inactive: only one active workspace per project (partial
            // unique index) and doSetActive owns the swap.
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
                ${0}, ${1}, ${ts}, ${ts}
              )
            `
            if (setActive) {
              yield* doSetActive(workspaceId, projectId)
            }
            return { kind: "inserted" as const, workspaceId }
          }),
        )

        if (txOutcome.kind === "conflict") {
          return { success: false, conflicts: [txOutcome.conflict] }
        }

        const workspaceId = txOutcome.workspaceId

        // Marker write happens after commit so a rolled-back bind never leaves
        // a marker pointing at a row that does not exist. This also heals
        // markers whose workspaceId drifted from the catalog row (P1-08 loop).
        if (shouldWriteMarker) {
          const markerUpToDate =
            existingMarker?.marker.workspaceId === workspaceId &&
            existingMarker?.marker.projectId === projectId
          if (!markerUpToDate) {
            yield* Effect.tryPromise({
              try: () =>
                writeWorkspaceMarker(projectRootPath, {
                  version: 1,
                  workspaceId,
                  projectId,
                  createdBy: "cozea",
                  createdAt: now(),
                }),
              catch: () => new Error("Failed to write marker"),
            }).pipe(Effect.catch(() => Effect.void))
          }
        }

        if (txOutcome.kind !== "existing") {
          yield* emitEvent(
            workspaceId,
            projectId,
            txOutcome.kind === "moved" ? "workspace.relinked" : "workspace.imported",
          ).pipe(Effect.catch(() => Effect.void))
        }

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

        // Find an available folder name
        const targetPath = yield* Effect.tryPromise({
          try: () => findAvailablePath(baseDir, slug),
          catch: (e) => new Error(String(e)),
        })

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
          return {
            success: false,
            error: bindResult.error,
            conflicts: bindResult.conflicts,
          }
        }

        yield* emitEvent(bindResult.workspace?.workspaceId ?? null, projectId, "workspace.created").pipe(
          Effect.catch(() => Effect.void),
        )

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
          rootId,
          rootPathOverride,
          setActive = true,
        } = req

        const resolvedRoot = yield* resolveLocalRoot(rootId, rootPathOverride)
        const baseDir = resolvedRoot.realPath

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
          return {
            success: false,
            error: bindResult.error,
            conflicts: bindResult.conflicts,
          }
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
          return {
            status: "missing" as WorkspaceVerificationStatus,
            workspace: null as LocalWorkspaceDTO | null,
          }
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
        const record = yield* queryWorkspaceById(workspaceId)

        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`DELETE FROM workspace_lanes WHERE workspace_id = ${workspaceId}`
            yield* sql`DELETE FROM local_workspaces WHERE workspace_id = ${workspaceId}`
          }),
        )

        // Remove the on-disk marker if it is ours: a stale marker pointing at
        // the deleted row turned every later re-import into a conflict.
        if (record) {
          yield* Effect.tryPromise({
            try: async () => {
              const marker = await readWorkspaceMarker(record.projectRootPath)
              if (
                marker &&
                marker.marker.workspaceId === workspaceId &&
                marker.marker.projectId === record.projectId
              ) {
                await fs.rm(marker.markerPath, { force: true })
              }
            },
            catch: () => new Error("Failed to remove workspace marker"),
          }).pipe(Effect.catch(() => Effect.void))
        }

        yield* emitEvent(workspaceId, record?.projectId ?? null, "workspace.forgotten").pipe(
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

    // ── buildSnapshotEntries ──────────────────────────────────────────────────

    const BROKEN_VERIFICATION_STATUSES: ReadonlySet<string> = new Set([
      "missing",
      "not-directory",
      "unreadable",
      "marker-mismatched-project",
      "marker-mismatched-workspace",
      "repo-mismatched",
    ])

    const buildSnapshotEntries = (): Effect.Effect<WorkspaceCatalogSnapshotEntry[]> =>
      Effect.gen(function* () {
        const workspaces = yield* sql`
          SELECT * FROM local_workspaces WHERE is_active = 1
        `.pipe(Effect.map((rows) => rows.map((r) => mapRow(r as Record<string, unknown>))))

        const lanes = yield* sql`
          SELECT * FROM workspace_lanes WHERE is_active = 1
        `.pipe(Effect.map((rows) => rows.map((r) => mapLaneRow(r as Record<string, unknown>))))

        const lanesByWorkspaceId = new Map(lanes.map((lane) => [lane.workspaceId, lane] as const))

        return workspaces.map((workspace): WorkspaceCatalogSnapshotEntry => {
          const lane = lanesByWorkspaceId.get(workspace.workspaceId) ?? null
          const broken = BROKEN_VERIFICATION_STATUSES.has(workspace.verificationStatus)
          return {
            projectId: workspace.projectId,
            status: broken ? "broken" : "ready",
            workspace: recordToDTO(workspace),
            lane: lane ? laneRecordToDTO(lane) : null,
            runtimeIdentity: lane ? buildRuntimeIdentity(workspace, lane) : null,
            collaborationScopeId: buildCollaborationScopeId(workspace.projectId),
            reason: broken
              ? (workspace.verificationReason ?? workspace.verificationStatus)
              : null,
          }
        })
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
      buildSnapshotEntries,
      upsertProjectsCache,
      getSetting,
      setSetting,
    }
  }),
)
