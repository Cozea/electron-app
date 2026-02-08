import type { Id } from "../../../convex/_generated/dataModel"
import { normalizeRelativePath } from "./pathNormalization"

interface StoredSyncHistoryV1 {
  version: 1
  lastSyncAt: number
  cloudPaths: string[]
}

export interface LocalSyncHistory {
  lastSyncAt: number | null
  cloudPathsAtLastSync: ReadonlySet<string>
}

export interface LocalSyncHistoryInspection extends LocalSyncHistory {
  corrupted: boolean
}

const STORAGE_KEY_PREFIX = "cozea:syncHistory:v1"

function getStorageKey(projectId: Id<"projects">): string {
  return `${STORAGE_KEY_PREFIX}:${projectId}`
}

function hasIpcSyncHistory(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  const candidate = (window as unknown as {
    electronAPI?: {
      sync?: {
        getHistory?: unknown
        setHistory?: unknown
      }
    }
  }).electronAPI

  return (
    typeof candidate?.sync?.getHistory === "function" &&
    typeof candidate?.sync?.setHistory === "function"
  )
}

function normalizeCloudPaths(paths: Iterable<string>): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const pathValue of paths) {
    const normalizedPath = normalizeRelativePath(pathValue)
    if (!normalizedPath || seen.has(normalizedPath)) continue
    seen.add(normalizedPath)
    normalized.push(normalizedPath)
  }
  normalized.sort((a, b) => a.localeCompare(b))
  return normalized
}

function inspectFromLocalStorage(projectId: Id<"projects">): LocalSyncHistoryInspection {
  try {
    const raw = localStorage.getItem(getStorageKey(projectId))
    if (!raw) {
      return { lastSyncAt: null, cloudPathsAtLastSync: new Set(), corrupted: false }
    }

    const parsed: unknown = JSON.parse(raw)
    if (!isStoredSyncHistoryV1(parsed)) {
      return { lastSyncAt: null, cloudPathsAtLastSync: new Set(), corrupted: true }
    }

    return {
      lastSyncAt: parsed.lastSyncAt,
      cloudPathsAtLastSync: new Set(normalizeCloudPaths(parsed.cloudPaths)),
      corrupted: false,
    }
  } catch {
    return { lastSyncAt: null, cloudPathsAtLastSync: new Set(), corrupted: true }
  }
}

function persistToLocalStorage(
  projectId: Id<"projects">,
  history: { lastSyncAt: number; cloudPathsAtLastSync: Iterable<string> }
): void {
  const payload: StoredSyncHistoryV1 = {
    version: 1,
    lastSyncAt: history.lastSyncAt,
    cloudPaths: normalizeCloudPaths(history.cloudPathsAtLastSync),
  }

  localStorage.setItem(getStorageKey(projectId), JSON.stringify(payload))
}

function isStoredSyncHistoryV1(value: unknown): value is StoredSyncHistoryV1 {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>

  if (record.version !== 1) return false
  if (typeof record.lastSyncAt !== "number") return false
  if (!Array.isArray(record.cloudPaths)) return false
  if (!record.cloudPaths.every((pathValue) => typeof pathValue === "string")) return false

  return true
}

export async function inspectLocalSyncHistory(
  projectId: Id<"projects">
): Promise<LocalSyncHistoryInspection> {
  if (!hasIpcSyncHistory()) {
    return inspectFromLocalStorage(projectId)
  }

  try {
    const history = await window.electronAPI.sync.getHistory({
      projectId: String(projectId),
    })

    const normalized = normalizeCloudPaths(history.cloudPaths)
    const inspection: LocalSyncHistoryInspection = {
      lastSyncAt: history.lastSyncAt,
      cloudPathsAtLastSync: new Set(normalized),
      corrupted: Boolean(history.corrupted),
    }

    // Keep legacy localStorage mirror as migration fallback.
    if (inspection.lastSyncAt !== null) {
      persistToLocalStorage(projectId, {
        lastSyncAt: inspection.lastSyncAt,
        cloudPathsAtLastSync: normalized,
      })
    }

    return inspection
  } catch {
    return inspectFromLocalStorage(projectId)
  }
}

export async function loadLocalSyncHistory(projectId: Id<"projects">): Promise<LocalSyncHistory> {
  const inspected = await inspectLocalSyncHistory(projectId)
  return {
    lastSyncAt: inspected.lastSyncAt,
    cloudPathsAtLastSync: inspected.cloudPathsAtLastSync,
  }
}

export async function saveLocalSyncHistory(
  projectId: Id<"projects">,
  history: { lastSyncAt: number; cloudPathsAtLastSync: Iterable<string> }
): Promise<void> {
  const normalizedPaths = normalizeCloudPaths(history.cloudPathsAtLastSync)

  // Keep localStorage mirror for backward compatibility and recovery fallback.
  persistToLocalStorage(projectId, {
    lastSyncAt: history.lastSyncAt,
    cloudPathsAtLastSync: normalizedPaths,
  })

  if (!hasIpcSyncHistory()) {
    return
  }

  try {
    await window.electronAPI.sync.setHistory({
      projectId: String(projectId),
      lastSyncAt: history.lastSyncAt,
      cloudPaths: normalizedPaths,
    })
  } catch {
    // Non-fatal: local mirror remains available.
  }
}
