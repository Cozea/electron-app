import type {
  MessageId,
  OrchestrationLatestTurn,
  OrchestrationThreadActivity,
} from "@cozea/assistant-contracts"

import type { TimelineEntry } from "@/features/assistant/chat/timelineDerivations"
import type { Thread, TurnDiffSummary } from "@/features/assistant/model/types"
import { formatElapsed, hasToolActivityForTurn } from "./session-logic"

export function buildTurnDiffSummaryByAssistantMessageId(
  summaries: ReadonlyArray<TurnDiffSummary>,
): Map<MessageId, TurnDiffSummary> {
  const byMessageId = new Map<MessageId, TurnDiffSummary>()

  for (const summary of summaries) {
    if (!summary.assistantMessageId) {
      continue
    }
    byMessageId.set(summary.assistantMessageId, summary)
  }

  return byMessageId
}

export function buildRevertTurnCountByUserMessageId({
  timelineEntries,
  turnDiffSummaryByAssistantMessageId,
  inferredCheckpointTurnCountByTurnId,
}: {
  timelineEntries: ReadonlyArray<TimelineEntry>
  turnDiffSummaryByAssistantMessageId: ReadonlyMap<MessageId, Thread["turnDiffSummaries"][number]>
  inferredCheckpointTurnCountByTurnId: Record<string, number>
}): Map<MessageId, number> {
  const byUserMessageId = new Map<MessageId, number>()

  for (let index = 0; index < timelineEntries.length; index += 1) {
    const entry = timelineEntries[index]
    if (!entry || entry.kind !== "message" || entry.message.role !== "user") {
      continue
    }

    for (let nextIndex = index + 1; nextIndex < timelineEntries.length; nextIndex += 1) {
      const nextEntry = timelineEntries[nextIndex]
      if (!nextEntry || nextEntry.kind !== "message") {
        continue
      }
      if (nextEntry.message.role === "user") {
        break
      }

      const summary = turnDiffSummaryByAssistantMessageId.get(nextEntry.message.id)
      if (!summary) {
        continue
      }

      const turnCount =
        summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId]
      if (typeof turnCount !== "number") {
        break
      }

      byUserMessageId.set(entry.message.id, Math.max(0, turnCount - 1))
      break
    }
  }

  return byUserMessageId
}

export function deriveCompletionDividerBeforeEntryId({
  latestTurnSettled,
  activeTurnStartedAt,
  activeTurnCompletedAt,
  assistantMessageId,
  completionSummary,
  timelineEntries,
}: {
  latestTurnSettled: boolean
  activeTurnStartedAt?: string | null
  activeTurnCompletedAt?: string | null
  assistantMessageId?: MessageId | null
  completionSummary: string | null
  timelineEntries: ReadonlyArray<TimelineEntry>
}): string | null {
  if (!latestTurnSettled) return null
  if (!activeTurnStartedAt || !activeTurnCompletedAt || !completionSummary) return null

  if (assistantMessageId) {
    const exactMatch = timelineEntries.find(
      (entry) =>
        entry.kind === "message" &&
        entry.message.role === "assistant" &&
        entry.message.id === assistantMessageId,
    )
    if (exactMatch) {
      return exactMatch.id
    }
  }

  const turnStartedAt = Date.parse(activeTurnStartedAt)
  const turnCompletedAt = Date.parse(activeTurnCompletedAt)
  if (Number.isNaN(turnStartedAt) || Number.isNaN(turnCompletedAt)) {
    return null
  }

  let inRangeMatch: string | null = null
  let fallbackMatch: string | null = null

  for (const entry of timelineEntries) {
    if (entry.kind !== "message" || entry.message.role !== "assistant") {
      continue
    }
    const messageAt = Date.parse(entry.message.createdAt)
    if (Number.isNaN(messageAt) || messageAt < turnStartedAt) {
      continue
    }
    fallbackMatch = entry.id
    if (messageAt <= turnCompletedAt) {
      inRangeMatch = entry.id
    }
  }

  return inRangeMatch ?? fallbackMatch
}

export function deriveCompletionSummariesByMessageId({
  messages,
  activities,
  activeTurn,
  latestTurnSettled,
}: {
  messages: ReadonlyArray<Thread["messages"][number]>
  activities: ReadonlyArray<OrchestrationThreadActivity>
  activeTurn: OrchestrationLatestTurn | null
  latestTurnSettled: boolean
}): Map<MessageId, string> {
  const byMessageId = new Map<MessageId, string>()

  const orderedMessages = [...messages].toSorted((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const turns = new Map<
    string,
    { startedAt: string; assistantMessages: Array<Thread["messages"][number]> }
  >()
  let precedingUserCreatedAt: string | null = null

  for (const message of orderedMessages) {
    if (message.role === "user") {
      precedingUserCreatedAt = message.createdAt
      continue
    }
    if (message.role !== "assistant" || !message.turnId) continue
    const key = String(message.turnId)
    const existing = turns.get(key)
    if (existing) {
      existing.assistantMessages.push(message)
    } else {
      turns.set(key, {
        startedAt: precedingUserCreatedAt ?? message.createdAt,
        assistantMessages: [message],
      })
    }
  }

  const newestTurnKey = [...turns.keys()].at(-1)
  for (const [turnKey, turn] of turns) {
    const terminalMessage = turn.assistantMessages
      .filter((message) => !message.streaming)
      .at(-1)
    if (!terminalMessage?.turnId || !hasToolActivityForTurn(activities, terminalMessage.turnId)) {
      continue
    }

    const isActiveTurn = activeTurn?.turnId === terminalMessage.turnId
    const isUnprojectedNewestTurn = !activeTurn && turnKey === newestTurnKey
    if ((isActiveTurn || isUnprojectedNewestTurn) && !latestTurnSettled) continue

    const startedAt = isActiveTurn ? (activeTurn?.startedAt ?? turn.startedAt) : turn.startedAt
    const completedCandidates = [
      ...(isActiveTurn && activeTurn?.completedAt ? [activeTurn.completedAt] : []),
      ...turn.assistantMessages.flatMap((message) =>
        message.completedAt ? [message.completedAt] : [message.createdAt],
      ),
      ...activities
        .filter((activity) => String(activity.turnId ?? "") === turnKey)
        .map((activity) => activity.createdAt),
    ].toSorted()
    const completedAt = completedCandidates.at(-1)
    const elapsed = formatElapsed(startedAt, completedAt)
    if (!elapsed) continue

    if (isActiveTurn && activeTurn?.state === "interrupted") {
      byMessageId.set(terminalMessage.id, `Stopped after ${elapsed}`)
    } else if (isActiveTurn && activeTurn?.state === "error") {
      byMessageId.set(terminalMessage.id, `Failed after ${elapsed}`)
    } else {
      byMessageId.set(terminalMessage.id, `Worked for ${elapsed}`)
    }
  }

  return byMessageId
}
