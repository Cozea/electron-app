import type { MessageId } from "@cozea/assistant-contracts"

import type { TimelineEntry } from "@/features/projects/components/assistant/chat/timelineDerivations"
import type { Thread, TurnDiffSummary } from "@/stores/types"

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
  completionSummary,
  timelineEntries,
}: {
  latestTurnSettled: boolean
  activeTurnStartedAt?: string | null
  activeTurnCompletedAt?: string | null
  completionSummary: string | null
  timelineEntries: ReadonlyArray<TimelineEntry>
}): string | null {
  if (!latestTurnSettled) return null
  if (!activeTurnStartedAt || !activeTurnCompletedAt || !completionSummary) return null

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
