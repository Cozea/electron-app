import crypto from "node:crypto"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as SqlClient from "@effect/sql/SqlClient"

import { isDeviceIdentityKey } from "../../../../shared/deviceIdentity.ts"
import {
  LOCAL_PROJECT_ID_PREFIX,
  isDeviceOnlyProjectId,
  type AdvanceProjectOperationRequest,
  type BeginProjectOperationRequest,
  type CreateLocalProjectEntryRequest,
  type LocalProjectDTO,
  type LocalProjectId,
  type LocalProjectResult,
  type LocalProjectStatus,
  type ObserveSharedProjectRequest,
  type ProjectOperationDTO,
  type ProjectOperationDetails,
  type ProjectOperationKind,
  type ProjectOperationStage,
  type ProjectOperationState,
  type UpdateLocalProjectMetadataRequest,
} from "../../../../shared/localProjectTypes.ts"

export interface LocalProjectCatalogInterface {
  readonly list: () => Effect.Effect<LocalProjectDTO[]>
  readonly get: (projectId: string) => Effect.Effect<LocalProjectDTO | null>
  readonly createEntry: (request: CreateLocalProjectEntryRequest) => Effect.Effect<LocalProjectResult<LocalProjectDTO>>
  readonly updateMetadata: (request: UpdateLocalProjectMetadataRequest) => Effect.Effect<LocalProjectResult<LocalProjectDTO>>
  readonly observeShared: (request: ObserveSharedProjectRequest) => Effect.Effect<LocalProjectResult<LocalProjectDTO>>
  readonly setStatus: (projectId: LocalProjectId, status: LocalProjectStatus) => Effect.Effect<LocalProjectResult<LocalProjectDTO>>
  readonly beginOperation: (request: BeginProjectOperationRequest) => Effect.Effect<LocalProjectResult<ProjectOperationDTO>>
  readonly getOperation: (operationId: string) => Effect.Effect<ProjectOperationDTO | null>
  readonly getCompletedRepair: (workspaceId: string, previousFolder: string | null, currentFolder: string, previousRevision?: number) => Effect.Effect<ProjectOperationDTO | null>
  readonly getCreationOperation: (projectId: LocalProjectId) => Effect.Effect<ProjectOperationDTO | null>
  readonly getPendingAttachment: (sourceFolder: string) => Effect.Effect<ProjectOperationDTO | null>
  readonly getPendingRepair: (workspaceId: string) => Effect.Effect<ProjectOperationDTO | null>
  readonly getPendingClose: (workspaceId: string) => Effect.Effect<ProjectOperationDTO | null>
  readonly completeRepairedCreation: (repair: ProjectOperationDTO) => Effect.Effect<LocalProjectResult<LocalProjectDTO>>
  readonly advanceOperation: (request: AdvanceProjectOperationRequest) => Effect.Effect<LocalProjectResult<ProjectOperationDTO>>
  readonly listRecoverableOperations: (projectId?: string) => Effect.Effect<ProjectOperationDTO[]>
  readonly isExcluded: (projectId: string) => Effect.Effect<boolean>
  readonly compactJournal: () => Effect.Effect<number>
  readonly backfillWorkspaceEntries: () => Effect.Effect<void>
}

interface ProjectRow extends Omit<LocalProjectDTO, "name" | "hidden"> {
  hidden: number
}

interface OperationRow extends Omit<ProjectOperationDTO, "details" | "requestDetails"> {
  detailsJson: string
  requestDetailsJson: string
}

const stages: ProjectOperationStage[] = ["requested", "prepared", "effect_applied", "binding_committed", "completed"]
const kinds: ProjectOperationKind[] = ["create", "attach", "repair", "remove", "share", "delete_shared", "github_repo"]
const transitions: Record<ProjectOperationState, readonly ProjectOperationState[]> = {
  pending: ["running", "failed", "cancelled"],
  running: ["running", "unknown", "failed", "completed"],
  unknown: ["running", "failed", "completed"],
  failed: ["running", "cancelled"],
  completed: [],
  cancelled: [],
}
const sharedStatuses = ["draft", "provisioning", "generating", "building", "active", "archived", "deleted"]
const stringDetailFields = new Set([
  "name", "slug", "sourceFolder", "destinationFolder", "workspaceId", "managedRootId",
  "cloudProjectId", "githubOwner", "githubName",
  "parentFolder", "sourceDevice", "sourceInode", "sourceBirthtime",
  "previousFolder", "expectedWorkspaceRevision",
  "repairOperationId",
  "runtimeRootsJson", "removalScopeJson",
])
const booleanDetailFields = new Set(["removeLocalData", "trashManagedFolder", "initGit", "closeOnly"])

function failure(error: string): { success: false; error: string } {
  return { success: false, error }
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200
}

/** Stable, bounded JSON also makes a replay with reordered keys identical. */
function encodeDetails(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
  if (entries.some(([key, entry]) =>
    stringDetailFields.has(key)
      ? typeof entry !== "string" || entry.length > (key === "removalScopeJson" ? 131_072 : 4096)
      : !booleanDetailFields.has(key) || typeof entry !== "boolean",
  )) return null
  const encoded = JSON.stringify(Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))))
  return encoded.length <= 147_456 ? encoded : null
}

function projectDTO(row: ProjectRow): LocalProjectDTO {
  return {
    ...row,
    hidden: row.hidden === 1,
    name: row.localName ?? row.sharedName ?? row.fallbackName,
  }
}

function operationDTO(row: OperationRow): ProjectOperationDTO {
  const { detailsJson, requestDetailsJson, ...operation } = row
  const parsed: unknown = JSON.parse(detailsJson)
  const request: unknown = JSON.parse(requestDetailsJson)
  if (encodeDetails(parsed) === null || encodeDetails(request) === null) throw new Error("Invalid durable project operation details")
  return { ...operation, details: parsed as ProjectOperationDetails, requestDetails: request as ProjectOperationDetails }
}

/** Uses the workspace catalog's connection/transactions; it owns no files. */
export const makeLocalProjectCatalog = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const get = (projectId: string) => sql<ProjectRow>`
    SELECT * FROM local_projects WHERE project_id = ${projectId} LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? projectDTO(rows[0]) : null), Effect.orDie)

  const getOperation = (operationId: string) => sql<OperationRow>`
    SELECT * FROM project_operation_history WHERE operation_id = ${operationId} LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? operationDTO(rows[0]) : null), Effect.orDie)

  const getCreationOperation = (projectId: LocalProjectId) => sql<OperationRow>`
    SELECT * FROM project_operation_history WHERE project_id = ${projectId} AND kind IN ('create', 'attach')
    ORDER BY created_at, operation_id LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? operationDTO(rows[0]) : null), Effect.orDie)

  const getPendingAttachment = (sourceFolder: string) => sql<OperationRow>`
    SELECT * FROM project_operations WHERE kind = 'attach'
      AND state IN ('pending', 'running', 'unknown', 'failed')
      AND json_extract(request_details_json, '$.sourceFolder') = ${sourceFolder}
    ORDER BY created_at, operation_id LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? operationDTO(rows[0]) : null), Effect.orDie)

  const getPendingRepair = (workspaceId: string) => sql<OperationRow>`
    SELECT * FROM project_operations WHERE kind = 'repair'
      AND state IN ('pending', 'running', 'unknown', 'failed')
      AND json_extract(request_details_json, '$.workspaceId') = ${workspaceId}
    ORDER BY created_at, operation_id LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? operationDTO(rows[0]) : null), Effect.orDie)

  const getPendingClose = (workspaceId: string) => sql<OperationRow>`
    SELECT * FROM project_operations WHERE kind = 'remove'
      AND json_extract(request_details_json, '$.closeOnly') = 1
      AND state IN ('pending', 'running', 'unknown', 'failed')
      AND json_extract(request_details_json, '$.workspaceId') = ${workspaceId}
    ORDER BY created_at, operation_id LIMIT 1
  `.pipe(Effect.map((rows) => rows[0] ? operationDTO(rows[0]) : null), Effect.orDie)

  const getCompletedRepair = (workspaceId: string, previousFolder: string | null, currentFolder: string, previousRevision?: number) => Effect.gen(function* () {
    if (previousFolder === null && (!Number.isSafeInteger(previousRevision) || Number(previousRevision) < 1)) return null
    const bindings = yield* sql<{ projectId: string; workspaceRevision: number }>`
      SELECT project_id, workspace_revision FROM local_workspaces
      WHERE workspace_id = ${workspaceId} AND project_root_path = ${currentFolder}
    `
    const binding = bindings[0]
    if (!binding || previousFolder === currentFolder && previousRevision === undefined) return null
    const rows = yield* sql<OperationRow>`
      SELECT * FROM project_operation_history
      WHERE kind = 'repair' AND state = 'completed' AND project_id = ${binding.projectId}
        AND json_extract(details_json, '$.workspaceId') = ${workspaceId}
        AND CAST(json_extract(details_json, '$.expectedWorkspaceRevision') AS INTEGER) < ${binding.workspaceRevision}
      ORDER BY CAST(json_extract(details_json, '$.expectedWorkspaceRevision') AS INTEGER) DESC LIMIT 128
    `
    const operations = rows.map(operationDTO)
    let folder = currentFolder
    let revision = binding.workspaceRevision - 1
    let latest: ProjectOperationDTO | null = null
    // A chat can be reopened after several moves. Every intervening revision
    // must have its own completed receipt; matching endpoint paths is insufficient.
    for (let depth = 0; depth < 128 && revision > 0; depth += 1) {
      const matches = operations.filter((operation) => operation.details.sourceFolder === folder && Number(operation.details.expectedWorkspaceRevision) === revision)
      if (matches.length !== 1 || !matches[0].details.previousFolder) return null
      latest ??= matches[0]
      folder = matches[0].details.previousFolder
      if ((previousFolder === null || folder === previousFolder) && (previousRevision === undefined || revision === previousRevision)) return latest
      revision -= 1
    }
    return null
  }).pipe(Effect.orDie)

  // The historical JSON importer runs after SQL migrations, and session
  // provisioning can still write bindings through compatibility callers.
  const backfillWorkspaceEntries = () => Effect.gen(function* () {
    const rows = yield* sql<{
      projectId: string; label: string | null; projectRootPath: string;
      createdAt: number; updatedAt: number; name: string | null; slug: string | null
    }>`
      SELECT w.project_id, w.label, w.project_root_path, w.created_at, w.updated_at,
        cache.name, cache.slug
      FROM local_workspaces w
      LEFT JOIN local_projects_cache cache ON cache.project_id = w.project_id
      LEFT JOIN local_projects p ON p.project_id = w.project_id
      WHERE p.project_id IS NULL OR
        (p.fallback_name = 'Local project' AND p.local_name IS NULL AND p.shared_name IS NULL)
      ORDER BY w.is_active DESC, w.created_at
    `
    const seen = new Set<string>()
    for (const row of rows) {
      if (seen.has(row.projectId)) continue
      seen.add(row.projectId)
      const fallback = row.name?.trim() || row.label?.trim() || path.basename(row.projectRootPath) || "Local project"
      yield* sql`
        INSERT INTO local_projects (project_id, fallback_name, slug, status,
          cloud_project_id, shared_name, created_at, updated_at)
        VALUES (${row.projectId}, ${fallback}, ${row.slug || "project"}, 'active',
          ${isDeviceOnlyProjectId(row.projectId) ? null : row.projectId},
          ${row.name?.trim() || null}, ${row.createdAt}, ${row.updatedAt})
        ON CONFLICT(project_id) DO UPDATE SET fallback_name = excluded.fallback_name
        WHERE local_projects.fallback_name = 'Local project'
          AND local_projects.local_name IS NULL AND local_projects.shared_name IS NULL
      `
    }
  }).pipe(Effect.asVoid, Effect.orDie)

  const list = () => Effect.gen(function* () {
    yield* backfillWorkspaceEntries()
    const rows = yield* sql<ProjectRow>`
      SELECT * FROM local_projects WHERE status != 'removed' ORDER BY updated_at DESC, project_id
    `
    return rows.map(projectDTO)
  }).pipe(Effect.orDie)

  const createEntry = (request: CreateLocalProjectEntryRequest): Effect.Effect<LocalProjectResult<LocalProjectDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!request || !validId(request.operationId) || !validName(request.name) ||
        (request.kind !== undefined && request.kind !== "create" && request.kind !== "attach") ||
        typeof request.slug !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(request.slug)) {
        return failure("A valid operation ID, project name and folder slug are required.")
      }
      const name = request.name.trim()
      const kind = request.kind ?? "create"
      const details = encodeDetails({ ...request.details, name, slug: request.slug })
      if (details === null) return failure("Project operation details are invalid or too large.")
      const existing = yield* getOperation(request.operationId)
      if (existing) {
        if (existing.kind !== kind || encodeDetails(existing.requestDetails) !== details) {
          return failure("This operation ID already belongs to a different request.")
        }
        const project = yield* get(existing.projectId)
        if (!project || project.status === "removed" || existing.state === "cancelled") {
          return failure("This creation attempt is no longer active.")
        }
        return { success: true as const, value: project }
      }
      const projectId = `${LOCAL_PROJECT_ID_PREFIX}${crypto.randomUUID().replace(/-/g, "")}` as LocalProjectId
      const now = Date.now()
      yield* sql`
        INSERT INTO local_projects (project_id, local_name, fallback_name, slug, status, created_at, updated_at)
        VALUES (${projectId}, ${name}, ${name}, ${request.slug}, 'provisioning', ${now}, ${now})
      `
      yield* sql`
        INSERT INTO project_operations (operation_id, project_id, kind, state, details_json, request_details_json, created_at, updated_at)
        VALUES (${request.operationId}, ${projectId}, ${kind}, 'pending', ${details}, ${details}, ${now}, ${now})
      `
      return { success: true as const, value: (yield* get(projectId))! }
    })).pipe(Effect.orDie)

  const updateMetadata = (request: UpdateLocalProjectMetadataRequest): Effect.Effect<LocalProjectResult<LocalProjectDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!request || !validId(request.projectId) ||
        (request.localName !== undefined && request.localName !== null && !validName(request.localName)) ||
        (request.hidden !== undefined && typeof request.hidden !== "boolean")) {
        return failure("Invalid local project metadata.")
      }
      const project = yield* get(request.projectId)
      if (!project || project.status === "removed") return failure("Local project not found.")
      yield* sql`
        UPDATE local_projects SET
          local_name = CASE WHEN ${request.localName !== undefined ? 1 : 0}
            THEN ${request.localName?.trim() ?? null} ELSE local_name END,
          hidden = CASE WHEN ${request.hidden !== undefined ? 1 : 0}
            THEN ${request.hidden ? 1 : 0} ELSE hidden END,
          updated_at = ${Date.now()}
        WHERE project_id = ${request.projectId}
      `
      return { success: true as const, value: (yield* get(request.projectId))! }
    })).pipe(Effect.orDie)

  const observeShared = (request: ObserveSharedProjectRequest): Effect.Effect<LocalProjectResult<LocalProjectDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!request || !validId(request.projectId) || !validId(request.cloudProjectId) ||
        isDeviceOnlyProjectId(request.cloudProjectId) || !validName(request.name) ||
        typeof request.slug !== "string" || request.slug.length > 120 ||
        typeof request.identityKey !== "string" || !isDeviceIdentityKey(request.identityKey) ||
        !sharedStatuses.includes(request.status)) return failure("Invalid shared project projection.")
      const project = yield* get(request.projectId)
      if (!project || project.status === "removed") return failure("Local project not found.")
      if (project.cloudProjectId && project.cloudProjectId !== request.cloudProjectId) {
        return failure("This local project already has a different cloud association.")
      }
      const other = yield* sql<{ projectId: string }>`
        SELECT project_id FROM local_projects WHERE cloud_project_id = ${request.cloudProjectId}
          AND project_id != ${request.projectId} LIMIT 1
      `
      if (other.length) return failure("This shared project already has a local entry.")
      const now = Date.now()
      yield* sql`
        UPDATE local_projects SET cloud_project_id = ${request.cloudProjectId}, shared_name = ${request.name.trim()},
          shared_status = ${request.status}, shared_identity_key = ${request.identityKey},
          shared_observed_at = ${now}, updated_at = ${now}
        WHERE project_id = ${request.projectId}
      `
      return { success: true as const, value: (yield* get(request.projectId))! }
    })).pipe(Effect.orDie)

  const setStatus = (projectId: LocalProjectId, status: LocalProjectStatus): Effect.Effect<LocalProjectResult<LocalProjectDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!validId(projectId) || !["provisioning", "active", "removed"].includes(status)) return failure("Invalid local project status.")
      const project = yield* get(projectId)
      if (!project) return failure("Local project not found.")
      if (project.status === "removed" && status !== "removed") return failure("A removed project cannot be reactivated by a delayed operation.")
      if (status === "removed") {
        const bindings = yield* sql`SELECT workspace_id FROM local_workspaces WHERE project_id = ${projectId} LIMIT 1`
        if (bindings.length) return failure("Forget workspace bindings before removing the local project.")
      }
      yield* sql`UPDATE local_projects SET status = ${status}, updated_at = ${Date.now()} WHERE project_id = ${projectId}`
      return { success: true as const, value: (yield* get(projectId))! }
    })).pipe(Effect.orDie)

  const beginOperation = (request: BeginProjectOperationRequest): Effect.Effect<LocalProjectResult<ProjectOperationDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!request || !validId(request.operationId) || !validId(request.projectId) || !kinds.includes(request.kind)) {
        return failure("Invalid project operation.")
      }
      const details = encodeDetails(request.details)
      if (details === null) return failure("Project operation details are invalid or too large.")
      const existing = yield* getOperation(request.operationId)
      if (existing) {
        return existing.projectId === request.projectId && existing.kind === request.kind && encodeDetails(existing.requestDetails) === details
          ? { success: true as const, value: existing }
          : failure("This operation ID already belongs to a different request.")
      }
      const project = yield* get(request.projectId)
      if (!project || project.status === "removed") return failure("Local project not found.")
      const now = Date.now()
      yield* sql`
        INSERT INTO project_operations (operation_id, project_id, kind, state, details_json, request_details_json, created_at, updated_at)
        VALUES (${request.operationId}, ${request.projectId}, ${request.kind}, 'pending', ${details}, ${details}, ${now}, ${now})
      `
      return { success: true as const, value: (yield* getOperation(request.operationId))! }
    })).pipe(Effect.orDie)

  const advanceOperation = (request: AdvanceProjectOperationRequest): Effect.Effect<LocalProjectResult<ProjectOperationDTO>> =>
    sql.withTransaction(Effect.gen(function* () {
      if (!request || !validId(request.operationId) || !Number.isInteger(request.expectedRevision) ||
        typeof request.state !== "string") return failure("Invalid project operation transition.")
      const operation = yield* getOperation(request.operationId)
      if (!operation) return failure("Project operation not found.")
      if (operation.revision !== request.expectedRevision) return failure("Project operation changed; reload its durable state.")
      if (!transitions[operation.state].includes(request.state)) return failure("Invalid project operation transition.")
      const stage = request.state === "completed" ? "completed" : request.stage ?? operation.stage
      if (!stages.includes(stage) || stages.indexOf(stage) < stages.indexOf(operation.stage) ||
        (stage === "completed" && request.state !== "completed")) return failure("Project operation stages cannot move backwards.")
      if (request.lastError !== undefined && request.lastError !== null &&
        (typeof request.lastError !== "string" || request.lastError.length > 2000)) return failure("Invalid project operation error.")
      const additions = request.details ?? {}
      if (encodeDetails(additions) === null || Object.entries(additions).some(([key, value]) =>
        value !== undefined && key in operation.details && operation.details[key as keyof ProjectOperationDetails] !== value,
      )) return failure("An operation's recorded resources cannot be replaced.")
      const details = encodeDetails({ ...operation.details,
        ...Object.fromEntries(Object.entries(additions).filter(([, value]) => value !== undefined)),
      })
      if (details === null) return failure("Project operation details are too large.")
      yield* sql`
        UPDATE project_operations SET state = ${request.state}, stage = ${stage}, details_json = ${details},
          revision = revision + 1, last_error = ${request.lastError ?? null}, updated_at = ${Date.now()}
        WHERE operation_id = ${request.operationId}
      `
      return { success: true as const, value: (yield* getOperation(request.operationId))! }
    })).pipe(Effect.orDie)

  const listRecoverableOperations = (projectId?: string) => sql<OperationRow>`
    SELECT * FROM project_operations WHERE state IN ('pending', 'running', 'unknown', 'failed')
      AND (${projectId ?? null} IS NULL OR project_id = ${projectId ?? null})
    ORDER BY CASE WHEN state = 'failed' THEN 1 ELSE 0 END, updated_at, operation_id LIMIT 128
  `.pipe(Effect.map((rows) => rows.map(operationDTO)), Effect.orDie)

  const completeRepairedCreation = (repair: ProjectOperationDTO): Effect.Effect<LocalProjectResult<LocalProjectDTO>> => sql.withTransaction(Effect.gen(function* () {
    const creation = yield* getCreationOperation(repair.projectId)
    if (creation && creation.state !== "completed" && creation.state !== "cancelled") {
      const source = creation.kind === "create" ? creation.details.destinationFolder : creation.details.sourceFolder
      if (source === repair.details.previousFolder && (!creation.details.workspaceId || creation.details.workspaceId === repair.details.workspaceId)) {
        // A verified move is the durable successor to the original binding;
        // keep its immutable path evidence and record how it was recovered.
        const details = encodeDetails({ ...creation.details, repairOperationId: repair.operationId })
        if (details === null) return failure("The original creation receipt needs inspection before repair can be finalized.")
        yield* sql`UPDATE project_operations SET state = 'completed', stage = 'completed', revision = revision + 1,
          details_json = ${details}, last_error = NULL, updated_at = ${Date.now()} WHERE operation_id = ${creation.operationId}`
      }
    }
    return yield* setStatus(repair.projectId, "active")
  })).pipe(Effect.orDie)

  const isExcluded = (projectId: string) => sql`SELECT 1 FROM project_exclusions WHERE project_id = ${projectId}`.pipe(Effect.map((rows) => rows.length > 0), Effect.orDie)
  const compactJournal = () => sql.withTransaction(Effect.gen(function* () {
    const cutoff = Date.now() - 30 * 86400_000
    // Move only terminal local receipts without native-effect/exclusion references.
    // The history view preserves complete replay intent and repair provenance.
    const rows = yield* sql<{ operationId: string }>`SELECT o.operation_id FROM project_operations o
      WHERE o.state IN ('completed', 'cancelled') AND o.kind IN ('create', 'attach', 'repair', 'remove') AND o.updated_at < ${cutoff}
      AND NOT EXISTS(SELECT 1 FROM project_exclusions e WHERE e.operation_id = o.operation_id)
      AND NOT EXISTS(SELECT 1 FROM project_operation_effects e WHERE e.operation_id = o.operation_id)
      ORDER BY o.updated_at LIMIT 128`
    for (const row of rows) {
      yield* sql`UPDATE project_operations SET last_error = NULL WHERE operation_id = ${row.operationId}`
      yield* sql`INSERT INTO project_operation_archive SELECT * FROM project_operations WHERE operation_id = ${row.operationId}`
      yield* sql`DELETE FROM project_operations WHERE operation_id = ${row.operationId}`
    }
    return rows.length
  })).pipe(Effect.orDie)

  return {
    list, get, isExcluded, compactJournal, createEntry, updateMetadata, observeShared, setStatus, beginOperation,
    getOperation, getCompletedRepair, getCreationOperation, getPendingAttachment, getPendingRepair, getPendingClose, completeRepairedCreation, advanceOperation, listRecoverableOperations, backfillWorkspaceEntries,
  } satisfies LocalProjectCatalogInterface
})
