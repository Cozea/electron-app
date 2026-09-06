/**
 * How an agent hands a scheduled task to Cozea.
 *
 * When someone asks an agent tile to schedule something, the agent answers with
 * a fenced `cozea-scheduled-task` block. Cozea reads it, fills the Scheduled
 * Tasks form with it, and the person saves it. The agent never writes the
 * schedule itself: a task that will later run an agent unattended is worth one
 * confirmation from a human.
 */

import {
  isScheduledTaskProvider,
  normalizeRecurrence,
  RUN_ONCE,
  type ScheduledTaskProvider,
  type ScheduledTaskRecurrence,
} from './scheduledTasks'

export const SCHEDULED_TASK_BLOCK_LANGUAGE = 'cozea-scheduled-task'

/** The project a proposal points at: the tile's own, an explicit path, or none. */
export type ProposedProject = { kind: 'current' } | { kind: 'path'; workspaceRoot: string } | null

export interface ScheduledTaskProposal {
  name: string
  prompt: string
  /** Null when the agent did not say; the form falls back to its default. */
  provider: ScheduledTaskProvider | null
  /** A named model, when the person asked for one. Null leaves it to the form. */
  model: string | null
  computerUse: boolean
  project: ProposedProject
  /** Epoch milliseconds, or null when the agent gave no usable time. */
  startAt: number | null
  recurrence: ScheduledTaskRecurrence
  /** Fields a person still has to supply before this can be saved. */
  missing: Array<'name' | 'prompt' | 'startAt'>
}

const BLOCK_PATTERN = new RegExp(
  `\`\`\`${SCHEDULED_TASK_BLOCK_LANGUAGE}\\s*\\n([\\s\\S]*?)(?:\`\`\`|$)`,
  'g',
)

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Agents write local wall-clock times ("2026-09-06T09:00"), because that is
 * what the person asked for. A trailing Z or offset is honoured when given.
 */
export function parseProposedStartAt(value: unknown): number | null {
  const text = readString(value)
  if (!text) return null
  const parsed = new Date(text)
  const time = parsed.getTime()
  return Number.isFinite(time) ? time : null
}

function parseProposedProject(value: unknown): ProposedProject {
  const text = readString(value)
  if (!text || text === 'none' || text === 'null') return null
  if (text === 'current') return { kind: 'current' }
  return { kind: 'path', workspaceRoot: text }
}

function parseProposedRecurrence(value: unknown): ScheduledTaskRecurrence {
  if (!value || typeof value !== 'object') return RUN_ONCE
  const candidate = value as { unit?: unknown; interval?: unknown; every?: unknown }
  const interval = Number(candidate.interval ?? candidate.every ?? 1)
  return normalizeRecurrence({
    unit: candidate.unit as ScheduledTaskRecurrence['unit'],
    interval: Number.isFinite(interval) ? interval : 1,
  })
}

function toProposal(raw: unknown): ScheduledTaskProposal | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const name = readString(candidate.name ?? candidate.title)
  const prompt = readString(candidate.prompt ?? candidate.task ?? candidate.instructions)
  const startAt = parseProposedStartAt(candidate.startAt ?? candidate.start ?? candidate.at)
  // A block with neither a name nor an instruction is not a proposal at all,
  // just a code sample that happens to carry the tag.
  if (!name && !prompt) return null

  const missing: ScheduledTaskProposal['missing'] = []
  if (!name) missing.push('name')
  if (!prompt) missing.push('prompt')
  if (startAt === null) missing.push('startAt')

  return {
    name,
    prompt,
    provider: isScheduledTaskProvider(candidate.provider) ? candidate.provider : null,
    model: readString(candidate.model) || null,
    computerUse: candidate.computerUse === true || candidate.computer_use === true,
    project: parseProposedProject(candidate.project ?? candidate.workspaceRoot),
    startAt,
    recurrence: parseProposedRecurrence(candidate.repeat ?? candidate.recurrence),
    missing,
  }
}

/**
 * Every proposal in one message. Malformed blocks are skipped rather than
 * thrown: a half-written block during streaming must not break the timeline.
 */
export function parseScheduledTaskProposals(text: string | null | undefined): ScheduledTaskProposal[] {
  if (!text || !text.includes(SCHEDULED_TASK_BLOCK_LANGUAGE)) return []
  const proposals: ScheduledTaskProposal[] = []
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const body = match[1]
    if (!body?.trim()) continue
    try {
      const proposal = toProposal(JSON.parse(body) as unknown)
      if (proposal) proposals.push(proposal)
    } catch {
      // Still streaming, or the agent wrote something that is not JSON.
    }
  }
  return proposals
}
