import type { Id } from "../../../convex/_generated/dataModel"

interface StoredSyncHistoryV1 {
  version: 1
  lastSyncAt: number
  cloudPaths: string[]
}

export interface LocalSyncHistory {
  lastSyncAt: number | null
  cloudPathsAtLastSync: ReadonlySet<string>
}

const STORAGE_KEY_PREFIX = "cozea:syncHistory:v1"

function getStorageKey(projectId: Id<"projects">): string {
  return `${STORAGE_KEY_PREFIX}:${projectId}`
}

export function loadLocalSyncHistory(projectId: Id<"projects">): LocalSyncHistory {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId))
    if (!raw) {
      return { lastSyncAt: null, cloudPathsAtLastSync: new Set() }
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isStoredSyncHistoryV1(parsed)) {
      return { lastSyncAt: null, cloudPathsAtLastSync: new Set() }
    }

    return {
      lastSyncAt: parsed.lastSyncAt,
      cloudPathsAtLastSync: new Set(parsed.cloudPaths),
    }
  } catch {
    return { lastSyncAt: null, cloudPathsAtLastSync: new Set() }
  }
}

export function saveLocalSyncHistory(
  projectId: Id<"projects">,
  history: { lastSyncAt: number; cloudPathsAtLastSync: Iterable<string> }
): void {
  const payload: StoredSyncHistoryV1 = {
    version: 1,
    lastSyncAt: history.lastSyncAt,
    cloudPaths: Array.from(history.cloudPathsAtLastSync),
  }

  localStorage.setItem(getStorageKey(projectId), JSON.stringify(payload))
}

function isStoredSyncHistoryV1(value: unknown): value is StoredSyncHistoryV1 {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>

  if (record.version !== 1) return false
  if (typeof record.lastSyncAt !== "number") return false
  if (!Array.isArray(record.cloudPaths)) return false
  if (!record.cloudPaths.every((p) => typeof p === "string")) return false

  return true
}

