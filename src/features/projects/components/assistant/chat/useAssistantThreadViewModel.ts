import { useMemo } from "react"

import type { ProviderInteractionMode } from "@cozea/assistant-contracts"

import {
  derivePhase,
  deriveTimelineEntries,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "@/features/projects/components/assistant/chat/timelineDerivations"
import type { PendingUserInput } from "@/features/projects/components/assistant/chat/pendingRequests"
import {
  buildRevertTurnCountByUserMessageId,
  buildTurnDiffSummaryByAssistantMessageId,
  deriveCompletionDividerBeforeEntryId,
  deriveCompletionSummariesByMessageId,
  inferCheckpointTurnCountByTurnId,
} from "@/features/projects/components/assistant/chat/turnDiffDerivations"
import {
  deriveWorkLogEntries,
  deriveActiveWorkStartedAt,
  formatElapsed,
  hasToolActivityForTurn,
} from "@/features/projects/components/assistant/chat/workLogDerivations"
import type { Thread } from "@/stores/types"

interface UseAssistantThreadViewModelInput {
  thread: Thread | null
  isRunning: boolean
  isSending: boolean
  isInterrupting: boolean
  pendingTurnStartStartedAtIso?: string | null
  isRevertingCheckpoint?: boolean
  pendingUserInputs: PendingUserInput[]
  selectedInteractionMode: ProviderInteractionMode
}

export function useAssistantThreadViewModel({
  thread,
  isRunning,
  isSending,
  isInterrupting,
  pendingTurnStartStartedAtIso,
  isRevertingCheckpoint,
  pendingUserInputs,
  selectedInteractionMode,
}: UseAssistantThreadViewModelInput) {
  const activeTurn = thread?.latestTurn ?? null
  const latestTurnSettled = isLatestTurnSettled(activeTurn, thread?.session ?? null)
  const phase = thread ? derivePhase(thread.session ?? null) : "disconnected"
  const isWorking = isRunning || isSending || isInterrupting || Boolean(isRevertingCheckpoint)
  const threadActivities = thread?.activities ?? []
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, undefined),
    [threadActivities],
  )
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeTurn?.turnId),
    [activeTurn?.turnId, threadActivities],
  )
  const activeWorkStartedAt = useMemo(
    () =>
      isWorking || !latestTurnSettled
        ? deriveActiveWorkStartedAt(
            activeTurn,
            thread?.session ?? null,
            pendingTurnStartStartedAtIso ?? null,
          )
        : null,
    [activeTurn, isWorking, latestTurnSettled, pendingTurnStartStartedAtIso, thread?.session],
  )
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(thread?.messages ?? [], thread?.proposedPlans ?? [], workLogEntries),
    [thread?.messages, thread?.proposedPlans, workLogEntries],
  )
  const inferredCheckpointTurnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(thread?.turnDiffSummaries ?? []),
    [thread?.turnDiffSummaries],
  )
  const turnDiffSummaryByAssistantMessageId = useMemo(
    () => buildTurnDiffSummaryByAssistantMessageId(thread?.turnDiffSummaries ?? []),
    [thread?.turnDiffSummaries],
  )
  const revertTurnCountByUserMessageId = useMemo(
    () =>
      buildRevertTurnCountByUserMessageId({
        timelineEntries,
        turnDiffSummaryByAssistantMessageId,
        inferredCheckpointTurnCountByTurnId,
      }),
    [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId],
  )
  const completionSummary = useMemo(() => {
    if (!latestTurnSettled) return null
    if (!latestTurnHasToolActivity) return null
    if (!activeTurn?.startedAt || !activeTurn.completedAt) return null

    const elapsed = formatElapsed(activeTurn.startedAt, activeTurn.completedAt)
    if (!elapsed) return null
    if (activeTurn?.state === "interrupted") {
      return `Stopped after ${elapsed}`
    }
    if (activeTurn?.state === "error") {
      return `Failed after ${elapsed}`
    }
    return `Worked for ${elapsed}`
  }, [
    activeTurn?.completedAt,
    activeTurn?.startedAt,
    activeTurn?.state,
    latestTurnHasToolActivity,
    latestTurnSettled,
  ])
  const completionSummariesByMessageId = useMemo(
    () =>
      deriveCompletionSummariesByMessageId({
        messages: thread?.messages ?? [],
        activities: threadActivities,
        activeTurn,
        latestTurnSettled,
      }),
    [activeTurn, latestTurnSettled, thread?.messages, threadActivities],
  )
  const completionDividerBeforeEntryId = useMemo(
    () =>
      deriveCompletionDividerBeforeEntryId({
        latestTurnSettled,
        activeTurnStartedAt: activeTurn?.startedAt ?? null,
        activeTurnCompletedAt: activeTurn?.completedAt ?? null,
        assistantMessageId: activeTurn?.assistantMessageId ?? null,
        completionSummary,
        timelineEntries,
      }),
    [
      activeTurn?.assistantMessageId,
      activeTurn?.completedAt,
      activeTurn?.startedAt,
      completionSummary,
      latestTurnSettled,
      timelineEntries,
    ],
  )
  const activeProposedPlan = useMemo(
    () => findLatestProposedPlan(thread?.proposedPlans ?? [], activeTurn?.turnId ?? null),
    [activeTurn?.turnId, thread?.proposedPlans],
  )
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    selectedInteractionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan)

  return {
    activeTurn,
    latestTurnSettled,
    phase,
    isWorking,
    activeWorkStartedAt,
    activeWorkCompletedAt: completionSummary ? (activeTurn?.completedAt ?? null) : null,
    isWorkActive: isWorking && !latestTurnSettled,
    timelineEntries,
    completionDividerBeforeEntryId,
    completionSummary,
    completionSummariesByMessageId,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  }
}
