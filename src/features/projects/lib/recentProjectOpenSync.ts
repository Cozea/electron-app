const STORAGE_KEY = 'cozea.project-open-sync.v1'
const ENTRY_TTL_MS = 10_000

interface RecentProjectOpenSyncState {
  [projectId: string]: number
}

function readState(): RecentProjectOpenSyncState {
  if (typeof window === 'undefined') return {}

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as RecentProjectOpenSyncState
  } catch {
    return {}
  }
}

function writeState(state: RecentProjectOpenSyncState): void {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors.
  }
}

export function markRecentProjectOpenSync(projectId: string): void {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return

  const state = readState()
  state[normalizedProjectId] = Date.now()
  writeState(state)
}

export function hasRecentProjectOpenSync(projectId: string): boolean {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return false

  const state = readState()
  const lastMarkedAt = state[normalizedProjectId]
  if (typeof lastMarkedAt !== 'number' || !Number.isFinite(lastMarkedAt)) {
    return false
  }

  const isFresh = Date.now() - lastMarkedAt <= ENTRY_TTL_MS
  if (isFresh) {
    return true
  }

  delete state[normalizedProjectId]
  writeState(state)
  return false
}
