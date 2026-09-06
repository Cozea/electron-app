/**
 * Scheduled tasks: an agent run the user sets up once and Cozea repeats on a
 * clock. A task names a provider to run it, when it first runs, and how often
 * it comes back. Computer-use tasks are the same thing pointed at the desktop
 * rather than at the project, which is why they are a flag here and a tag in
 * the UI: the difference changes what the run can touch.
 *
 * The types and the next-run arithmetic live together so the main process, the
 * renderer and the tests all read the same clock rules.
 */

/** The four agent CLIs Cozea can drive, matching AgentSkillProvider. */
export type ScheduledTaskProvider = 'codex' | 'claude' | 'cursor' | 'opencode'

export const SCHEDULED_TASK_PROVIDERS: ReadonlyArray<ScheduledTaskProvider> = [
  'claude',
  'codex',
  'cursor',
  'opencode',
]

/**
 * Hours step by duration; days, weeks and months step by the calendar, so a
 * task set for 09:00 stays at 09:00 across a daylight-saving change.
 */
export type ScheduledTaskRecurrenceUnit = 'hours' | 'days' | 'weeks' | 'months'

export const SCHEDULED_TASK_RECURRENCE_UNITS: ReadonlyArray<ScheduledTaskRecurrenceUnit> = [
  'hours',
  'days',
  'weeks',
  'months',
]

export interface ScheduledTaskRecurrence {
  /** `null` runs the task once, at `startAt`. */
  unit: ScheduledTaskRecurrenceUnit | null
  /** Units between runs. Ignored when `unit` is null. */
  interval: number
}

export const RUN_ONCE: ScheduledTaskRecurrence = { unit: null, interval: 1 }

/**
 * The project a run happens in. Null on a task that belongs to no project, like
 * "read the news and summarize it": those run in a scratch workspace Cozea
 * owns, so a general task never writes into someone's repository.
 */
export interface ScheduledTaskProjectTarget {
  /** Absolute path the run uses as its working directory. */
  workspaceRoot: string
  /** What to show in the list, captured when the project was picked. */
  label: string
}

/**
 * A provider option carried with the task, such as a reasoning level. Shaped
 * like the assistant's own `ProviderOptionSelection` without pulling the
 * contracts package into the main process.
 */
export interface ScheduledTaskModelOption {
  id: string
  value: string | boolean
}

export interface ScheduledTaskDraft {
  /** Absent when creating. */
  taskId?: string
  name: string
  /** What the agent is asked to do on every run. */
  prompt: string
  provider: ScheduledTaskProvider
  /** Null falls back to whatever the provider treats as its default model. */
  model: string | null
  /** Reasoning level and any other option the chosen model exposes. */
  modelOptions: ScheduledTaskModelOption[]
  /** Runs against the desktop through Open Computer Use, not just the project. */
  computerUse: boolean
  /** Null for a general task with no project of its own. */
  project: ScheduledTaskProjectTarget | null
  /** First run, as epoch milliseconds. */
  startAt: number
  recurrence: ScheduledTaskRecurrence
  enabled: boolean
}

export interface ScheduledTask {
  id: string
  name: string
  prompt: string
  provider: ScheduledTaskProvider
  model: string | null
  modelOptions: ScheduledTaskModelOption[]
  computerUse: boolean
  project: ScheduledTaskProjectTarget | null
  startAt: number
  recurrence: ScheduledTaskRecurrence
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** Null until a run has been attempted. */
  lastRunAt: number | null
  /** Why the last run could not start, so a silent failure stays visible. */
  lastError: string | null
  /** The conversation the last run opened, for a link back into it. */
  lastThreadId: string | null
  /** Most recent first, capped at SCHEDULED_TASK_RUN_HISTORY_LIMIT. */
  runs: ScheduledTaskRun[]
}

/**
 * One attempt. The runner knows whether it managed to start the run, not how
 * the run turned out, so the states say exactly that and nothing more.
 */
export type ScheduledTaskRunStatus = 'started' | 'failed' | 'skipped'

export interface ScheduledTaskRun {
  id: string
  ranAt: number
  status: ScheduledTaskRunStatus
  /** The conversation the run opened, when one was started. */
  threadId: string | null
  /** Why it could not start, for a failed or skipped attempt. */
  error: string | null
  /**
   * When the person opened this run. Null means unread, which is what the
   * dot in the history marks: a run that started and has not been looked at.
   */
  seenAt: number | null
}

/** Enough history to see a pattern without the file growing without end. */
export const SCHEDULED_TASK_RUN_HISTORY_LIMIT = 50

export interface ScheduledTasksSnapshot {
  tasks: ScheduledTask[]
  /**
   * Computer use is a setting, and a computer-use task is inert while it is
   * off. The page says so rather than letting the task look armed.
   */
  computerUseEnabled: boolean
  /**
   * Where a task with no project runs. Main owns the path so the renderer
   * never has to invent one.
   */
  standaloneWorkspaceRoot: string
}

export interface ScheduledTaskMutationResult {
  success: boolean
  error?: string
  taskId?: string
}

/** What the runner reports back after trying to start a task. */
export interface ScheduledTaskRunReport {
  taskId: string
  ranAt: number
  /** Defaults to started when a thread came back, failed otherwise. */
  status?: ScheduledTaskRunStatus
  threadId?: string | null
  error?: string | null
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** Keeps only well-formed options; anything else is dropped rather than stored. */
export function normalizeModelOptions(value: unknown): ScheduledTaskModelOption[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const options: ScheduledTaskModelOption[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<ScheduledTaskModelOption>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    if (!id || seen.has(id)) continue
    if (typeof candidate.value !== 'string' && typeof candidate.value !== 'boolean') continue
    seen.add(id)
    options.push({ id, value: candidate.value })
  }
  return options
}

export function isScheduledTaskProvider(value: unknown): value is ScheduledTaskProvider {
  return SCHEDULED_TASK_PROVIDERS.includes(value as ScheduledTaskProvider)
}

/** Clamps a recurrence to something the arithmetic below can honour. */
export function normalizeRecurrence(
  recurrence: ScheduledTaskRecurrence | null | undefined,
): ScheduledTaskRecurrence {
  if (!recurrence?.unit || !SCHEDULED_TASK_RECURRENCE_UNITS.includes(recurrence.unit)) {
    return RUN_ONCE
  }
  const interval = Math.floor(recurrence.interval)
  return {
    unit: recurrence.unit,
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
  }
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate()
}

/**
 * Adds calendar steps, keeping the local time of day. A monthly task started
 * on the 31st falls back to the last day of shorter months rather than
 * spilling into the next one.
 */
function addCalendarSteps(
  from: number,
  unit: Exclude<ScheduledTaskRecurrenceUnit, 'hours'>,
  interval: number,
  steps: number,
): number {
  if (steps === 0) return from
  const next = new Date(from)
  if (unit === 'days' || unit === 'weeks') {
    const days = interval * steps * (unit === 'weeks' ? 7 : 1)
    next.setDate(next.getDate() + days)
    return next.getTime()
  }
  const dayOfMonth = next.getDate()
  next.setDate(1)
  next.setMonth(next.getMonth() + interval * steps)
  next.setDate(Math.min(dayOfMonth, daysInMonth(next.getFullYear(), next.getMonth())))
  return next.getTime()
}

/** Whole calendar months from one instant to another, ignoring the day. */
function monthsBetween(from: number, to: number): number {
  const start = new Date(from)
  const end = new Date(to)
  return (
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  )
}

/**
 * The earliest slot this task still owes, or null when it owes none.
 *
 * Deliberately independent of the current time: "next" is the first occurrence
 * after the last run, which is what makes a missed slot visible as overdue and
 * lets the runner see that a task is due at all. Comparing it to now is the
 * caller's job.
 */
export function computeNextRunAt(
  task: Pick<ScheduledTask, 'startAt' | 'recurrence' | 'lastRunAt'> & { enabled?: boolean },
): number | null {
  if (task.enabled === false) return null
  const recurrence = normalizeRecurrence(task.recurrence)
  const lastRunAt = task.lastRunAt ?? null

  if (!recurrence.unit) {
    return lastRunAt === null ? task.startAt : null
  }

  // A task that has never run owes its first slot, however long ago that was.
  if (lastRunAt === null) return task.startAt
  // Never repeat on top of a run that already happened at this slot.
  const after = lastRunAt
  if (task.startAt > after) return task.startAt

  if (recurrence.unit === 'hours') {
    const step = recurrence.interval * HOUR_MS
    const elapsed = after - task.startAt
    return task.startAt + (Math.floor(elapsed / step) + 1) * step
  }

  // Jump most of the way with an estimate, then walk the last steps so
  // daylight saving and short months land on the real occurrence.
  const approximateStep =
    recurrence.unit === 'months'
      ? Math.max(1, Math.floor(monthsBetween(task.startAt, after) / recurrence.interval))
      : Math.max(
          1,
          Math.floor(
            (after - task.startAt) /
              (recurrence.interval * DAY_MS * (recurrence.unit === 'weeks' ? 7 : 1)),
          ),
        )

  let steps = Math.max(0, approximateStep)
  let candidate = addCalendarSteps(task.startAt, recurrence.unit, recurrence.interval, steps)
  // Walk back if the estimate overshot, then forward until it clears `after`.
  while (steps > 0 && addCalendarSteps(task.startAt, recurrence.unit, recurrence.interval, steps - 1) > after) {
    steps -= 1
    candidate = addCalendarSteps(task.startAt, recurrence.unit, recurrence.interval, steps)
  }
  while (candidate <= after) {
    steps += 1
    candidate = addCalendarSteps(task.startAt, recurrence.unit, recurrence.interval, steps)
  }
  return candidate
}

/**
 * How late a run may be and still fire. A machine asleep for a week should not
 * wake up and replay every missed slot, so anything older is recorded as
 * skipped and the task moves on to its next occurrence.
 */
export const MAX_RUN_LATENESS_MS = 6 * 60 * 60 * 1000

export function isScheduledTaskDue(task: ScheduledTask, now: number): boolean {
  if (!task.enabled) return false
  const nextRunAt = computeNextRunAt(task)
  return nextRunAt !== null && nextRunAt <= now
}

/** Due, but too old to be worth running: clear it off the queue instead. */
export function isScheduledTaskStale(task: ScheduledTask, now: number): boolean {
  const nextRunAt = computeNextRunAt(task)
  return nextRunAt !== null && now - nextRunAt > MAX_RUN_LATENESS_MS
}

/** Everything a tick should act on, most overdue first. */
export function dueScheduledTasks(
  tasks: ReadonlyArray<ScheduledTask>,
  now: number,
): ScheduledTask[] {
  return tasks
    .filter((task) => isScheduledTaskDue(task, now))
    .sort((left, right) => (computeNextRunAt(left) ?? 0) - (computeNextRunAt(right) ?? 0))
}

/** "Every 2 days", "Every hour", "Once" — the schedule in one phrase. */
export function describeRecurrence(recurrence: ScheduledTaskRecurrence): string {
  const normalized = normalizeRecurrence(recurrence)
  if (!normalized.unit) return 'Once'
  if (normalized.unit === 'days' && normalized.interval === 1) return 'Every day'
  const singular: Record<ScheduledTaskRecurrenceUnit, string> = {
    hours: 'hour',
    days: 'day',
    weeks: 'week',
    months: 'month',
  }
  return normalized.interval === 1
    ? `Every ${singular[normalized.unit]}`
    : `Every ${normalized.interval} ${normalized.unit}`
}
