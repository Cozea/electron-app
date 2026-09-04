import { useMemo } from "react"

import type { ProviderInteractionMode } from "@cozea/assistant-contracts"

import {
  derivePhase,
  deriveTimelineEntries,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "@/features/assistant/chat/timelineDerivations"
import type { PendingUserInput } from "@/features/assistant/chat/pendingRequests"
import {
  buildRevertTurnCountByUserMessageId,
  buildTurnDiffSummaryByAssistantMessageId,
  deriveCompletionDividerBeforeEntryId,
  deriveCompletionSummariesByMessageId,
  inferCheckpointTurnCountByTurnId,
} from "@/features/assistant/chat/turnDiffDerivations"
import {
  deriveWorkLogEntries,
  deriveActiveWorkStartedAt,
  formatElapsed,
  hasToolActivityForTurn,
} from "@/features/assistant/chat/workLogDerivations"
import { deriveGenerationStatusPhase } from "@/features/assistant/chat/MessagesTimeline.logic"
import type { Thread } from "@/features/assistant/model/types"

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
  // The merged live-running signal spans message checkpoints and provider
  // generations. Once it is idle, historical timeline boundaries can safely
  // produce one completion fold even if latestTurn/session projection lags.
  const completionTurnSettled = !isWorking
  const threadActivities = thread?.activities ?? []
  const generationStatusPhase = useMemo(
    () =>
      deriveGenerationStatusPhase(
        threadActivities,
        latestTurnSettled ? null : activeTurn?.turnId,
      ),
    [activeTurn?.turnId, latestTurnSettled, threadActivities],
  )
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
    () =>
      deriveTimelineEntries(thread?.messages ?? [], thread?.proposedPlans ?? [], workLogEntries),
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
    if (!completionTurnSettled) return null
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
    completionTurnSettled,
  ])
  const completionSummariesByMessageId = useMemo(
    () =>
      deriveCompletionSummariesByMessageId({
        messages: thread?.messages ?? [],
        activities: threadActivities,
        activeTurn,
        latestTurnSettled: completionTurnSettled,
      }),
    [activeTurn, completionTurnSettled, thread?.messages, threadActivities],
  )
  const completionDividerBeforeEntryId = useMemo(
    () =>
      deriveCompletionDividerBeforeEntryId({
        latestTurnSettled: completionTurnSettled,
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
      completionTurnSettled,
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
    // A newly submitted turn starts before the shell projection replaces the
    // previous settled latestTurn. Treat every explicit busy state as active
    // so the timeline shows feedback immediately instead of waiting for that
    // projection to catch up.
    isWorkActive: isWorking,
    generationStatusPhase,
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
