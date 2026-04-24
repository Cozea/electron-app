import type { Id } from "../../../convex/_generated/dataModel"

export type SyncOpSource = "editor" | "agent" | "watcher" | "remote"
export type SyncActorType = "user" | "agent" | "system"
export type SyncOpKind = "upsert" | "delete" | "rename" | "chmod" | "yjs_update"

export interface SyncOp {
  opId: string
  idempotencyKey: string
  projectId: Id<"projects">
  actorId: string
  actorType: SyncActorType
  source: SyncOpSource
  kind: SyncOpKind
  path: string
  baseHash?: string
  newHash?: string
  isBinary: boolean
  size: number
  timestamp: number
}

export interface SyncJournalState {
  projectId: Id<"projects">
  journalHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: number
  pathHeads: Record<string, string>
  lastJournalCursor: number
  lastPersistedAt: number | null
}

// Sync status for UI
export type SyncStatus =
  | "idle"
  | "checking"
  | "planning"
  | "syncing"
  | "complete"
  | "error"

// Progress tracking for UI
export interface SyncProgress {
  status: SyncStatus
  message: string
  current: number
  total: number
  logs: string[]
}
