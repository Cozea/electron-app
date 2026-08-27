import type { Id } from "../../../../../convex/_generated/dataModel"
import { normalizeProjectFilePath } from "./pathNormalization"
import type {
  SyncActorType,
  SyncOp,
  SyncOpKind,
  SyncOpSource,
  SyncJournalState,
} from "./types"

export interface EnqueueOpsResult {
  accepted: number
  rejected: number
  acceptedOpIds: string[]
  journalState: SyncJournalState
}

export interface SyncCoordinatorOptions {
  projectId: Id<"projects">
  actorId?: string
  actorType?: SyncActorType
  source?: SyncOpSource
  autoAck?: boolean
}

export interface SyncOpInput {
  kind: SyncOpKind
  path: string
  idempotencyKey?: string
  actorId?: string
  actorType?: SyncActorType
  source?: SyncOpSource
  baseHash?: string
  newHash?: string
  isBinary?: boolean
  size?: number
  timestamp?: number
}

function buildDefaultIdempotencyKey(op: Omit<SyncOp, "opId">): string {
  return [
    op.projectId,
    op.actorId,
    op.actorType,
    op.source,
    op.kind,
    op.path,
    op.baseHash ?? "",
    op.newHash ?? "",
    String(op.timestamp),
  ].join(":")
}

/**
 * SyncCoordinator routes all local operation sources through one pipeline.
 * The main process stores and orders ops; renderer uses this facade.
 */
export class SyncCoordinator {
  private projectId: Id<"projects">
  private actorId: string
  private actorType: SyncActorType
  private source: SyncOpSource
  private autoAck: boolean

  constructor(options: SyncCoordinatorOptions) {
    this.projectId = options.projectId
    this.actorId = options.actorId ?? "unknown"
    this.actorType = options.actorType ?? "system"
    this.source = options.source ?? "editor"
    this.autoAck = options.autoAck ?? true
  }

  createOp(input: SyncOpInput): SyncOp {
    const normalizedPath =
      normalizeProjectFilePath(input.path) ||
      input.path.replace(/\\/g, "/").replace(/^\/+/, "").trim()
    const timestamp = input.timestamp ?? Date.now()
    const baseOp: Omit<SyncOp, "opId"> = {
      idempotencyKey: input.idempotencyKey ?? "",
      projectId: this.projectId,
      actorId: input.actorId ?? this.actorId,
      actorType: input.actorType ?? this.actorType,
      source: input.source ?? this.source,
      kind: input.kind,
      path: normalizedPath,
      baseHash: input.baseHash,
      newHash: input.newHash,
      isBinary: Boolean(input.isBinary),
      size: Math.max(0, input.size ?? 0),
      timestamp,
    }

    return {
      opId: crypto.randomUUID(),
      ...baseOp,
      idempotencyKey:
        input.idempotencyKey && input.idempotencyKey.trim().length > 0
          ? input.idempotencyKey
          : buildDefaultIdempotencyKey(baseOp),
    }
  }

  async enqueueOp(input: SyncOpInput): Promise<EnqueueOpsResult> {
    return this.enqueueOps([this.createOp(input)])
  }

  async enqueueBatch(inputs: SyncOpInput[]): Promise<EnqueueOpsResult> {
    return this.enqueueOps(inputs.map((input) => this.createOp(input)))
  }

  async enqueueOps(ops: SyncOp[]): Promise<EnqueueOpsResult> {
    const result = await window.electronAPI.workspaceSync.enqueueOps({
      projectId: this.projectId,
      ops,
    })

    let journalState = result.journalState
    if (this.autoAck && result.acceptedOpIds.length > 0) {
      try {
        const ackResult = await window.electronAPI.workspaceSync.ackOps({
          projectId: this.projectId,
          opIds: result.acceptedOpIds,
        })
        journalState = ackResult.journalState
      } catch (error) {
        console.warn("[SyncCoordinator] Failed to ack sync ops:", error)
      }
    }

    return {
      accepted: result.accepted,
      rejected: result.rejected,
      acceptedOpIds: result.acceptedOpIds,
      journalState: {
        ...journalState,
        projectId: this.projectId,
      },
    }
  }

  async getJournalState(): Promise<SyncJournalState> {
    const result = await window.electronAPI.workspaceSync.getJournalState({
      projectId: this.projectId,
    })
    return {
      ...result,
      projectId: this.projectId,
    }
  }

  async ackOps(opIds: string[]): Promise<SyncJournalState> {
    const result = await window.electronAPI.workspaceSync.ackOps({
      projectId: this.projectId,
      opIds,
    })
    return {
      ...result.journalState,
      projectId: this.projectId,
    }
  }
}
