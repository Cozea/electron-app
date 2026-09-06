import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import {
  isScheduledTaskProvider,
  normalizeModelOptions,
  normalizeRecurrence,
  type ScheduledTask,
  type ScheduledTaskDraft,
  type ScheduledTaskMutationResult,
  type ScheduledTaskProjectTarget,
  type ScheduledTaskRun,
  type ScheduledTaskRunReport,
  SCHEDULED_TASK_RUN_HISTORY_LIMIT,
} from '../../../../shared/scheduledTasks'

const REGISTRY_FILE_NAME = 'scheduled-tasks.json'
const NAME_MAX_LENGTH = 120
const PROMPT_MAX_LENGTH = 4000

interface PersistedState {
  version: 1
  tasks: ScheduledTask[]
}

function registryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

/**
 * Where a task with no project runs. Cozea owns the folder, so a general task
 * ("summarize today's news") has a real working directory without being
 * pointed at anybody's repository.
 */
function standaloneWorkspaceRoot(): string {
  const root = path.join(app.getPath('userData'), 'scheduled-tasks', 'workspace')
  try {
    fs.mkdirSync(root, { recursive: true })
  } catch {
    // Reported as a run failure if it matters; listing must not throw.
  }
  return root
}

function reviveProject(value: unknown): ScheduledTaskProjectTarget | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ScheduledTaskProjectTarget>
  if (typeof candidate.workspaceRoot !== 'string' || !candidate.workspaceRoot.trim()) return null
  return {
    workspaceRoot: candidate.workspaceRoot,
    label:
      typeof candidate.label === 'string' && candidate.label.trim()
        ? candidate.label.slice(0, NAME_MAX_LENGTH)
        : path.basename(candidate.workspaceRoot),
  }
}

/**
 * A task read off disk may predate a field, or have been hand-edited. Anything
 * that cannot be repaired into a runnable task is dropped rather than handed to
 * the page as a half-record.
 */
function reviveTask(value: unknown): ScheduledTask | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<ScheduledTask>
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null
  if (typeof candidate.name !== 'string' || !candidate.name.trim()) return null
  if (!isScheduledTaskProvider(candidate.provider)) return null
  if (typeof candidate.startAt !== 'number' || !Number.isFinite(candidate.startAt)) return null

  const now = Date.now()
  return {
    id: candidate.id,
    name: candidate.name.slice(0, NAME_MAX_LENGTH),
    prompt: typeof candidate.prompt === 'string' ? candidate.prompt.slice(0, PROMPT_MAX_LENGTH) : '',
    provider: candidate.provider,
    model: typeof candidate.model === 'string' && candidate.model.trim() ? candidate.model : null,
    modelOptions: normalizeModelOptions(candidate.modelOptions),
    computerUse: candidate.computerUse === true,
    project: reviveProject(candidate.project),
    startAt: candidate.startAt,
    recurrence: normalizeRecurrence(candidate.recurrence),
    enabled: candidate.enabled !== false,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : now,
    lastRunAt: typeof candidate.lastRunAt === 'number' ? candidate.lastRunAt : null,
    lastError: typeof candidate.lastError === 'string' ? candidate.lastError : null,
    lastThreadId: typeof candidate.lastThreadId === 'string' ? candidate.lastThreadId : null,
    runs: reviveRuns(candidate.runs),
  }
}

function reviveRuns(value: unknown): ScheduledTaskRun[] {
  if (!Array.isArray(value)) return []
  const runs: ScheduledTaskRun[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<ScheduledTaskRun>
    if (typeof candidate.ranAt !== 'number' || !Number.isFinite(candidate.ranAt)) continue
    const status =
      candidate.status === 'started' || candidate.status === 'failed' || candidate.status === 'skipped'
        ? candidate.status
        : 'started'
    runs.push({
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : randomUUID(),
      ranAt: candidate.ranAt,
      status,
      threadId: typeof candidate.threadId === 'string' ? candidate.threadId : null,
      error: typeof candidate.error === 'string' ? candidate.error : null,
      seenAt: typeof candidate.seenAt === 'number' ? candidate.seenAt : null,
    })
  }
  return runs.sort((left, right) => right.ranAt - left.ranAt).slice(0, SCHEDULED_TASK_RUN_HISTORY_LIMIT)
}

function readState(): PersistedState {
  const filePath = registryPath()
  try {
    if (!fs.existsSync(filePath)) return { version: 1, tasks: [] }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<PersistedState> | null
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : []
    return {
      version: 1,
      tasks: tasks.map(reviveTask).filter((task): task is ScheduledTask => task !== null),
    }
  } catch {
    return { version: 1, tasks: [] }
  }
}

function writeState(state: PersistedState): void {
  const filePath = registryPath()
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/** Soonest first, so the list reads as a queue rather than a creation log. */
function byStart(left: ScheduledTask, right: ScheduledTask): number {
  return left.startAt - right.startAt || left.createdAt - right.createdAt
}

export class ScheduledTaskService {
  private static instance: ScheduledTaskService | null = null

  static getInstance(): ScheduledTaskService {
    ScheduledTaskService.instance ??= new ScheduledTaskService()
    return ScheduledTaskService.instance
  }

  list(): ScheduledTask[] {
    return readState().tasks.sort(byStart)
  }

  standaloneWorkspaceRoot(): string {
    return standaloneWorkspaceRoot()
  }

  save(draft: ScheduledTaskDraft): ScheduledTaskMutationResult {
    const name = typeof draft?.name === 'string' ? draft.name.trim() : ''
    if (!name) return { success: false, error: 'Give the task a name.' }
    const prompt = typeof draft?.prompt === 'string' ? draft.prompt.trim() : ''
    if (!prompt) return { success: false, error: 'Say what the task should do.' }
    if (!isScheduledTaskProvider(draft?.provider)) {
      return { success: false, error: 'Pick a provider to run the task.' }
    }
    if (typeof draft?.startAt !== 'number' || !Number.isFinite(draft.startAt)) {
      return { success: false, error: 'Pick when the task should first run.' }
    }

    const state = readState()
    const now = Date.now()
    const existing = draft.taskId
      ? state.tasks.find((task) => task.id === draft.taskId) ?? null
      : null
    if (draft.taskId && !existing) {
      return { success: false, error: 'That scheduled task no longer exists.' }
    }

    const task: ScheduledTask = {
      id: existing?.id ?? randomUUID(),
      name: name.slice(0, NAME_MAX_LENGTH),
      prompt: prompt.slice(0, PROMPT_MAX_LENGTH),
      provider: draft.provider,
      model: typeof draft.model === 'string' && draft.model.trim() ? draft.model : null,
      modelOptions: normalizeModelOptions(draft.modelOptions),
      computerUse: draft.computerUse === true,
      project: reviveProject(draft.project),
      startAt: draft.startAt,
      recurrence: normalizeRecurrence(draft.recurrence),
      enabled: draft.enabled !== false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      // Editing the schedule re-arms the task: the old run belonged to the
      // old timing, and keeping it would skip the first new slot.
      lastRunAt:
        existing && existing.startAt === draft.startAt ? existing.lastRunAt : null,
      lastError: existing?.lastError ?? null,
      lastThreadId: existing?.lastThreadId ?? null,
      runs: existing?.runs ?? [],
    }

    writeState({
      version: 1,
      tasks: existing
        ? state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
        : [...state.tasks, task],
    })
    return { success: true, taskId: task.id }
  }

  setEnabled(options: { taskId: string; enabled: boolean }): ScheduledTaskMutationResult {
    const state = readState()
    const task = state.tasks.find((candidate) => candidate.id === options?.taskId)
    if (!task) return { success: false, error: 'That scheduled task no longer exists.' }

    writeState({
      version: 1,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? { ...candidate, enabled: options.enabled === true, updatedAt: Date.now() }
          : candidate,
      ),
    })
    return { success: true, taskId: task.id }
  }

  /**
   * Records an attempt, successful or not. `lastRunAt` moves either way: a task
   * whose run could not start must not be retried every tick, and the error it
   * carries says why on the card.
   */
  markRun(report: ScheduledTaskRunReport): ScheduledTaskMutationResult {
    const state = readState()
    const task = state.tasks.find((candidate) => candidate.id === report?.taskId)
    if (!task) return { success: false, error: 'That scheduled task no longer exists.' }

    const ranAt =
      typeof report.ranAt === 'number' && Number.isFinite(report.ranAt) ? report.ranAt : Date.now()
    const error = report.error ? String(report.error).slice(0, 500) : null
    const run: ScheduledTaskRun = {
      id: randomUUID(),
      ranAt,
      status: report.status ?? (report.threadId ? 'started' : 'failed'),
      threadId: report.threadId ?? null,
      error,
      seenAt: null,
    }
    writeState({
      version: 1,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              lastRunAt: ranAt,
              lastError: error,
              lastThreadId: report.threadId ?? null,
              runs: [run, ...candidate.runs].slice(0, SCHEDULED_TASK_RUN_HISTORY_LIMIT),
              updatedAt: Date.now(),
            }
          : candidate,
      ),
    })
    return { success: true, taskId: task.id }
  }

  /** Records that someone opened a run, which clears its unread mark. */
  markRunSeen(options: { taskId: string; runId: string }): ScheduledTaskMutationResult {
    const state = readState()
    const task = state.tasks.find((candidate) => candidate.id === options?.taskId)
    const run = task?.runs.find((candidate) => candidate.id === options?.runId)
    if (!task || !run) return { success: false, error: 'That run no longer exists.' }
    if (run.seenAt !== null) return { success: true, taskId: task.id }

    const seenAt = Date.now()
    writeState({
      version: 1,
      tasks: state.tasks.map((candidate) =>
        candidate.id === task.id
          ? {
              ...candidate,
              runs: candidate.runs.map((entry) =>
                entry.id === run.id ? { ...entry, seenAt } : entry,
              ),
            }
          : candidate,
      ),
    })
    return { success: true, taskId: task.id }
  }

  remove(options: { taskId: string }): ScheduledTaskMutationResult {
    const state = readState()
    if (!state.tasks.some((candidate) => candidate.id === options?.taskId)) {
      return { success: false, error: 'That scheduled task no longer exists.' }
    }

    writeState({
      version: 1,
      tasks: state.tasks.filter((candidate) => candidate.id !== options.taskId),
    })
    return { success: true, taskId: options.taskId }
  }
}
