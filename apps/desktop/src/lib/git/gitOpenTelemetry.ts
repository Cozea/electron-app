import { isGitOpenDebugEnabled, logGitOpenDebug } from './gitOpenDebug'

const GIT_OPEN_TELEMETRY_KEY = 'gitOpenTelemetry.v1'
const GIT_OPEN_TELEMETRY_LIMIT = 200

export interface GitOpenTelemetryEvent {
  at: string
  projectId: string
  projectSlug: string
  outcome: 'opened' | 'manual_conflict' | 'cancelled' | 'failed'
  durationMs: number
  strategy:
    | 'clean'
    | 'restore'
    | 'replay'
    | 'salvage-reclone'
    | 'bootstrap-publish'
    | 'bootstrap-restore'
    | 'conflict-resume'
  changed: boolean
  repoHealth?: string
  hadMeaningfulLocalState?: boolean
  conflictedPathsCount?: number
  errorMessage?: string
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function recordGitOpenTelemetry(event: GitOpenTelemetryEvent): void {
  if (!canUseStorage()) {
    return
  }

  try {
    const raw = window.localStorage.getItem(GIT_OPEN_TELEMETRY_KEY)
    const existing = raw ? (JSON.parse(raw) as GitOpenTelemetryEvent[]) : []
    const next = [...existing, event].slice(-GIT_OPEN_TELEMETRY_LIMIT)
    window.localStorage.setItem(GIT_OPEN_TELEMETRY_KEY, JSON.stringify(next))
  } catch (error) {
    if (isGitOpenDebugEnabled()) {
      console.warn('[GitOpenTelemetry] Failed to persist telemetry event:', error)
    }
  }

  logGitOpenDebug('prepare:telemetry', event as unknown as Record<string, unknown>)
}

export function readGitOpenTelemetry(): GitOpenTelemetryEvent[] {
  if (!canUseStorage()) {
    return []
  }

  try {
    const raw = window.localStorage.getItem(GIT_OPEN_TELEMETRY_KEY)
    return raw ? (JSON.parse(raw) as GitOpenTelemetryEvent[]) : []
  } catch {
    return []
  }
}

export function clearGitOpenTelemetry(): void {
  if (!canUseStorage()) {
    return
  }
  window.localStorage.removeItem(GIT_OPEN_TELEMETRY_KEY)
}
