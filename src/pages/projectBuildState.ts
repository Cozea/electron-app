export const DEFAULT_PROJECT_BUILD_STATUS_MESSAGE = 'Ready to build the project.'
export const INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE =
  'The previous build was interrupted. You can retry it safely.'

export type ProjectBuildRunStatus = 'idle' | 'running' | 'interrupted' | 'completed' | 'failed'

export interface ProjectBuildTask {
  content: string
  activeForm: string
  status: 'pending' | 'in_progress' | 'completed'
}

export interface ProjectBuildSessionState {
  runId: string | null
  runStatus: ProjectBuildRunStatus
  runAttempt: number
  buildTasks: ProjectBuildTask[]
  progress: number
  statusMessage: string
  logs: string[]
}

const INITIAL_PROJECT_BUILD_SESSION_STATE: ProjectBuildSessionState = Object.freeze({
  runId: null,
  runStatus: 'idle',
  runAttempt: 0,
  buildTasks: [],
  progress: 0,
  statusMessage: DEFAULT_PROJECT_BUILD_STATUS_MESSAGE,
  logs: [],
})

function isTaskStatus(value: unknown): value is ProjectBuildTask['status'] {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function normalizeBuildTasks(value: unknown): ProjectBuildTask[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const content =
      typeof entry.content === 'string' && entry.content.trim().length > 0
        ? entry.content
        : null
    const activeForm =
      typeof entry.activeForm === 'string' && entry.activeForm.trim().length > 0
        ? entry.activeForm
        : content
    const status = isTaskStatus(entry.status) ? entry.status : null

    if (!content || !activeForm || !status) {
      return []
    }

    return [{ content, activeForm, status }]
  })
}

function isInFlightStatus(value: unknown): boolean {
  return value === 'running' || value === 'queued' || value === 'starting'
}

export function createInitialProjectBuildSessionState(): ProjectBuildSessionState {
  return {
    ...INITIAL_PROJECT_BUILD_SESSION_STATE,
    buildTasks: [],
    logs: [],
  }
}

export function parseStoredProjectBuildSessionState(
  stored: string | null | undefined
): ProjectBuildSessionState {
  if (!stored) {
    return createInitialProjectBuildSessionState()
  }

  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>
    const runStatus = isInFlightStatus(parsed.runStatus)
      ? 'interrupted'
      : parsed.runStatus === 'interrupted' ||
          parsed.runStatus === 'completed' ||
          parsed.runStatus === 'failed' ||
          parsed.runStatus === 'idle'
        ? parsed.runStatus
        : 'idle'

    return {
      runId: typeof parsed.runId === 'string' ? parsed.runId : null,
      runStatus,
      runAttempt:
        typeof parsed.runAttempt === 'number' && Number.isFinite(parsed.runAttempt)
          ? parsed.runAttempt
          : 0,
      buildTasks: normalizeBuildTasks(parsed.buildTasks),
      progress:
        typeof parsed.progress === 'number' && Number.isFinite(parsed.progress)
          ? parsed.progress
          : 0,
      statusMessage:
        runStatus === 'interrupted'
          ? INTERRUPTED_PROJECT_BUILD_STATUS_MESSAGE
          : typeof parsed.statusMessage === 'string' && parsed.statusMessage.trim().length > 0
            ? parsed.statusMessage
            : DEFAULT_PROJECT_BUILD_STATUS_MESSAGE,
      logs: Array.isArray(parsed.logs)
        ? parsed.logs.filter((value): value is string => typeof value === 'string')
        : [],
    }
  } catch {
    return createInitialProjectBuildSessionState()
  }
}

export const useProjectBuildState = () => ({})
