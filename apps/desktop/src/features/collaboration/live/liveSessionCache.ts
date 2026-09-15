import type { LiveSessionRecord } from "./useLiveSession"

const STORAGE_KEY = "cozea:live-session-cache:v1"

interface CachedSessionState {
  version: 1
  sessionsByProject: Record<string, LiveSessionRecord[]>
  sessionsById: Record<string, LiveSessionRecord>
}

function readState(): CachedSessionState {
  if (typeof window === "undefined") {
    return { version: 1, sessionsByProject: {}, sessionsById: {} }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 1, sessionsByProject: {}, sessionsById: {} }
    const parsed = JSON.parse(raw) as CachedSessionState
    if (parsed.version === 1 && parsed.sessionsByProject && typeof parsed.sessionsByProject === "object") {
      return parsed
    }
    return { version: 1, sessionsByProject: {}, sessionsById: {} }
  } catch {
    return { version: 1, sessionsByProject: {}, sessionsById: {} }
  }
}

function writeState(state: CachedSessionState): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
}

export function cacheProjectSessions(projectId: string, sessions: readonly LiveSessionRecord[]): void {
  const trimmed = projectId?.trim()
  if (!trimmed) return
  const state = readState()
  state.sessionsByProject[trimmed] = [...sessions]
  for (const session of sessions) {
    if (session.publicSessionId) {
      state.sessionsById[session.publicSessionId] = session
    }
  }
  writeState(state)
}

export function readCachedProjectSessions(projectId: string | null | undefined): LiveSessionRecord[] | undefined {
  const trimmed = projectId?.trim()
  if (!trimmed) return undefined
  const state = readState()
  return state.sessionsByProject[trimmed]
}

export function readCachedSessionById(publicSessionId: string | null | undefined): LiveSessionRecord | null {
  const trimmed = publicSessionId?.trim()
  if (!trimmed) return null
  const state = readState()
  return state.sessionsById[trimmed] ?? null
}
