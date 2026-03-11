import type { BuildTask } from '@/components/builder/BuildTaskList'

export type ProjectBuildRunStatus = 'idle' | 'running' | 'failed' | 'completed' | 'interrupted'

export interface ProjectBuildSessionState {
  runId: string | null
  runStatus: ProjectBuildRunStatus
  runAttempt: number
  buildTasks: BuildTask[]
  progress: number
  statusMessage: string
  logs: string[]
}

interface StoredProjectBuildSessionState {
  runId?: string
  runStatus?: ProjectBuildRunStatus
  runAttempt?: number
  buildTasks?: BuildTask[]
  progress?: number
  statusMessage?: string
  logs?: string[]
}

export const DEFAULT_PROJECT_BUILD_STATUS_MESSAGE = 'Preparing to build...'
export const INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE = 'Build interrupted. You can retry to continue.'

export function createInitialProjectBuildSessionState(): ProjectBuildSessionState {
  return {
    runId: null,
    runStatus: 'idle',
    runAttempt: 0,
    buildTasks: [],
    progress: 0,
    statusMessage: DEFAULT_PROJECT_BUILD_STATUS_MESSAGE,
    logs: [],
  }
}

export function parseStoredProjectBuildSessionState(
  stored: string | null
): ProjectBuildSessionState {
  const initialState = createInitialProjectBuildSessionState()
  if (!stored) {
    return initialState
  }

  try {
    const parsed = JSON.parse(stored) as StoredProjectBuildSessionState
    const normalizedRunStatus =
      parsed.runStatus === 'running'
        ? 'interrupted'
        : parsed.runStatus ?? initialState.runStatus

    return {
      runId: typeof parsed.runId === 'string' ? parsed.runId : initialState.runId,
      runStatus: normalizedRunStatus,
      runAttempt: typeof parsed.runAttempt === 'number' ? parsed.runAttempt : initialState.runAttempt,
      buildTasks: Array.isArray(parsed.buildTasks) ? parsed.buildTasks : initialState.buildTasks,
      progress: typeof parsed.progress === 'number' ? parsed.progress : initialState.progress,
      statusMessage:
        parsed.runStatus === 'running'
          ? INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE
          : typeof parsed.statusMessage === 'string' && parsed.statusMessage.length > 0
            ? parsed.statusMessage
            : initialState.statusMessage,
      logs: Array.isArray(parsed.logs)
        ? parsed.logs.filter((entry): entry is string => typeof entry === 'string')
        : initialState.logs,
    }
  } catch {
    return initialState
  }
}
