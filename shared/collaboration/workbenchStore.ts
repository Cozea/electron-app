/**
 * Local Project Workbench persistence abstraction and invariant helpers.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P01
 *
 * Invariants:
 * - C01: Project is the collaborative subject.
 * - C02: Session Workbench is local device state.
 * - C06: sessionId != branchName.
 * - C29: One active Workbench per project/device.
 * - C30: Idling a Workbench is local; does not pause global session.
 */

import {
  asWorkbenchId,
  type BranchName,
  type CollaborationSessionDescriptor,
  type LocalProjectWorkbench,
  type LocalWorkbenchLifecycle,
  type ProjectId,
  type SessionId,
  type WorkbenchId,
  type WorkspaceId,
} from "./types"
import { assertValidWorkbenchTransition } from "./stateMachines"

export class WorkbenchInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkbenchInvariantError"
  }
}

// ─── Invariant Validation ──────────────────────────────────────────────────────

/**
 * Validates invariant rules on a LocalProjectWorkbench instance:
 * 1. Session Workbench (kind="collaboration") MUST have a valid collaborationSessionId.
 * 2. Ordinary Workbench (kind="ordinary") CANNOT claim a collaborationSessionId.
 * 3. Identifiers must be populated.
 */
export function validateWorkbenchInvariants(workbench: LocalProjectWorkbench): void {
  if (!workbench.workbenchId) {
    throw new WorkbenchInvariantError("workbenchId cannot be empty")
  }
  if (!workbench.projectId) {
    throw new WorkbenchInvariantError("projectId cannot be empty")
  }
  if (!workbench.workspaceId) {
    throw new WorkbenchInvariantError("workspaceId cannot be empty")
  }
  if (workbench.workspaceRevision < 1) {
    throw new WorkbenchInvariantError("workspaceRevision must be >= 1")
  }

  if (workbench.kind === "collaboration") {
    if (!workbench.collaborationSessionId) {
      throw new WorkbenchInvariantError(
        "Session Workbench invariant violated: kind='collaboration' requires a non-null collaborationSessionId",
      )
    }
  } else if (workbench.kind === "ordinary") {
    if (workbench.collaborationSessionId !== null && workbench.collaborationSessionId !== undefined) {
      throw new WorkbenchInvariantError(
        "Ordinary Workbench invariant violated: kind='ordinary' cannot claim collaborationSessionId",
      )
    }
  } else {
    throw new WorkbenchInvariantError(`Unknown workbench kind: '${(workbench as any).kind}'`)
  }
}

// ─── Factory Helpers ───────────────────────────────────────────────────────────

export interface CreateOrdinaryWorkbenchParams {
  workbenchId?: string
  projectId: ProjectId
  workspaceId: WorkspaceId
  workspaceRevision?: number
  branchName?: BranchName | null
  title: string
  presentationStateRef?: string
  lifecycle?: LocalWorkbenchLifecycle
  now?: number
}

export function createOrdinaryWorkbench(
  params: CreateOrdinaryWorkbenchParams,
): LocalProjectWorkbench {
  const now = params.now ?? Date.now()
  const workbench: LocalProjectWorkbench = {
    workbenchId: asWorkbenchId(params.workbenchId ?? `wb_${crypto.randomUUID()}`),
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    workspaceRevision: params.workspaceRevision ?? 1,
    kind: "ordinary",
    branchName: params.branchName ?? null,
    collaborationSessionId: null,
    lifecycle: params.lifecycle ?? "creating",
    title: params.title,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: params.lifecycle === "active" ? now : null,
    presentationStateRef: params.presentationStateRef ?? "",
  }
  validateWorkbenchInvariants(workbench)
  return workbench
}

export interface CreateSessionWorkbenchParams {
  workbenchId?: string
  projectId: ProjectId
  workspaceId: WorkspaceId
  workspaceRevision?: number
  branchName: BranchName
  sessionId: SessionId
  title: string
  presentationStateRef?: string
  lifecycle?: LocalWorkbenchLifecycle
  now?: number
}

export function createSessionWorkbench(
  params: CreateSessionWorkbenchParams,
): LocalProjectWorkbench {
  const now = params.now ?? Date.now()
  const workbench: LocalProjectWorkbench = {
    workbenchId: asWorkbenchId(params.workbenchId ?? `wb_${crypto.randomUUID()}`),
    projectId: params.projectId,
    workspaceId: params.workspaceId,
    workspaceRevision: params.workspaceRevision ?? 1,
    kind: "collaboration",
    branchName: params.branchName,
    collaborationSessionId: params.sessionId,
    lifecycle: params.lifecycle ?? "creating",
    title: params.title,
    createdAt: now,
    updatedAt: now,
    lastActivatedAt: params.lifecycle === "active" ? now : null,
    presentationStateRef: params.presentationStateRef ?? "",
  }
  validateWorkbenchInvariants(workbench)
  return workbench
}

// ─── Invariant Evaluation Helpers ──────────────────────────────────────────────

/**
 * Evaluates whether collaboration is active for a given workbench.
 *
 * Invariant C06: sessionId != branchName.
 * Critical assertion: Branch equality (e.g. activeBranch === collabBranch)
 * CANNOT create collaboration membership!
 * Collaboration is active ONLY when:
 * 1. workbench.kind === "collaboration"
 * 2. workbench.collaborationSessionId matches session.sessionId
 * 3. session.lifecycle === "ACTIVE"
 * 4. workbench.lifecycle === "active"
 */
export function isCollaborationActive(
  workbench: LocalProjectWorkbench,
  session: CollaborationSessionDescriptor | null,
): boolean {
  if (workbench.kind !== "collaboration" || !workbench.collaborationSessionId) {
    return false
  }

  if (!session) {
    return false
  }

  if (session.sessionId !== workbench.collaborationSessionId) {
    return false
  }

  return session.lifecycle === "ACTIVE" && workbench.lifecycle === "active"
}

// ─── Persistence Abstraction ──────────────────────────────────────────────────

export interface SetActiveWorkbenchResult {
  readonly activated: LocalProjectWorkbench
  readonly idled: LocalProjectWorkbench | null
}

export interface LocalProjectWorkbenchStore {
  get(workbenchId: WorkbenchId): Promise<LocalProjectWorkbench | null>
  listByProject(projectId: ProjectId): Promise<LocalProjectWorkbench[]>
  getActive(projectId: ProjectId): Promise<LocalProjectWorkbench | null>
  save(workbench: LocalProjectWorkbench): Promise<LocalProjectWorkbench>
  setActive(projectId: ProjectId, workbenchId: WorkbenchId): Promise<SetActiveWorkbenchResult>
  setIdle(projectId: ProjectId, workbenchId: WorkbenchId): Promise<LocalProjectWorkbench>
  delete(workbenchId: WorkbenchId): Promise<boolean>
}

/**
 * In-memory implementation of LocalProjectWorkbenchStore.
 * Enforces Invariant C29: Exactly one active Workbench per project/device.
 * Enforces Invariant C30: Switching local active Workbench does not touch cloud session lifecycle.
 */
export class InMemoryLocalProjectWorkbenchStore implements LocalProjectWorkbenchStore {
  private readonly workbenches = new Map<string, LocalProjectWorkbench>()

  async get(workbenchId: WorkbenchId): Promise<LocalProjectWorkbench | null> {
    const wb = this.workbenches.get(workbenchId)
    return wb ? { ...wb } : null
  }

  async listByProject(projectId: ProjectId): Promise<LocalProjectWorkbench[]> {
    const results: LocalProjectWorkbench[] = []
    for (const wb of this.workbenches.values()) {
      if (wb.projectId === projectId && wb.lifecycle !== "closed") {
        results.push({ ...wb })
      }
    }
    return results
  }

  async getActive(projectId: ProjectId): Promise<LocalProjectWorkbench | null> {
    for (const wb of this.workbenches.values()) {
      if (wb.projectId === projectId && wb.lifecycle === "active") {
        return { ...wb }
      }
    }
    return null
  }

  async save(workbench: LocalProjectWorkbench): Promise<LocalProjectWorkbench> {
    validateWorkbenchInvariants(workbench)

    // If attempting to save as "active", ensure no other workbench for this project is active
    if (workbench.lifecycle === "active") {
      for (const [id, existing] of this.workbenches.entries()) {
        if (
          existing.projectId === workbench.projectId &&
          existing.workbenchId !== workbench.workbenchId &&
          existing.lifecycle === "active"
        ) {
          throw new WorkbenchInvariantError(
            `Invariant C29 violated: Cannot save workbench '${workbench.workbenchId}' as active; workbench '${id}' is already active for project '${workbench.projectId}'`,
          )
        }
      }
    }

    this.workbenches.set(workbench.workbenchId, { ...workbench })
    return { ...workbench }
  }

  /**
   * Switches the active Workbench for a project.
   *
   * Algorithm (Section 5.2):
   * 1. Validate destination Workbench exists and belongs to projectId.
   * 2. If already active, return as-is.
   * 3. Mark current active Workbench (if any) as 'idle'.
   * 4. Mark destination Workbench as 'active'.
   * 5. Invariant C30: Never mutate cloud session lifecycle merely because of switch.
   */
  async setActive(
    projectId: ProjectId,
    workbenchId: WorkbenchId,
  ): Promise<SetActiveWorkbenchResult> {
    const destination = this.workbenches.get(workbenchId)
    if (!destination) {
      throw new Error(`Workbench '${workbenchId}' not found`)
    }
    if (destination.projectId !== projectId) {
      throw new WorkbenchInvariantError(
        `Workbench '${workbenchId}' belongs to project '${destination.projectId}', not '${projectId}'`,
      )
    }
    if (destination.lifecycle === "closed") {
      throw new WorkbenchInvariantError(
        `Cannot activate closed workbench '${workbenchId}'`,
      )
    }

    if (destination.lifecycle === "active") {
      return { activated: { ...destination }, idled: null }
    }

    assertValidWorkbenchTransition(destination.lifecycle, "active")

    const now = Date.now()

    // Find and idle currently active workbench for this project
    let idled: LocalProjectWorkbench | null = null
    for (const [id, existing] of this.workbenches.entries()) {
      if (
        existing.projectId === projectId &&
        existing.workbenchId !== workbenchId &&
        existing.lifecycle === "active"
      ) {
        assertValidWorkbenchTransition(existing.lifecycle, "idle")
        const idledRecord: LocalProjectWorkbench = {
          ...existing,
          lifecycle: "idle",
          updatedAt: now,
        }
        this.workbenches.set(id, idledRecord)
        idled = idledRecord
        break
      }
    }

    const activatedRecord: LocalProjectWorkbench = {
      ...destination,
      lifecycle: "active",
      lastActivatedAt: now,
      updatedAt: now,
    }
    this.workbenches.set(workbenchId, activatedRecord)

    return { activated: activatedRecord, idled }
  }

  async setIdle(
    projectId: ProjectId,
    workbenchId: WorkbenchId,
  ): Promise<LocalProjectWorkbench> {
    const wb = this.workbenches.get(workbenchId)
    if (!wb) {
      throw new Error(`Workbench '${workbenchId}' not found`)
    }
    if (wb.projectId !== projectId) {
      throw new WorkbenchInvariantError(
        `Workbench '${workbenchId}' does not belong to project '${projectId}'`,
      )
    }

    if (wb.lifecycle === "idle") {
      return { ...wb }
    }

    assertValidWorkbenchTransition(wb.lifecycle, "idle")

    const updated: LocalProjectWorkbench = {
      ...wb,
      lifecycle: "idle",
      updatedAt: Date.now(),
    }
    this.workbenches.set(workbenchId, updated)
    return { ...updated }
  }

  async delete(workbenchId: WorkbenchId): Promise<boolean> {
    const wb = this.workbenches.get(workbenchId)
    if (!wb) return false

    // Transition to closed before removing
    if (wb.lifecycle !== "closed") {
      assertValidWorkbenchTransition(wb.lifecycle, "closed")
    }

    return this.workbenches.delete(workbenchId)
  }
}
