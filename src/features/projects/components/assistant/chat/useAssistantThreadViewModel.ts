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
  inferCheckpointTurnCountByTurnId,
} from "@/features/projects/components/assistant/chat/turnDiffDerivations"
import {
  deriveActiveWorkStartedAt,
  deriveWorkLogEntries,
  formatElapsed,
  hasToolActivityForTurn,
} from "@/features/projects/components/assistant/chat/workLogDerivations"
import type { Thread } from "@/stores/types"

interface UseAssistantThreadViewModelInput {
  thread: Thread | null
  isRunning: boolean
  isSending: boolean
  isInterrupting: boolean
  isRevertingCheckpoint?: boolean
  pendingUserInputs: PendingUserInput[]
  selectedInteractionMode: ProviderInteractionMode
}

export function useAssistantThreadViewModel({
  thread,
  isRunning,
  isSending,
  isInterrupting,
  isRevertingCheckpoint,
  pendingUserInputs,
  selectedInteractionMode,
}: UseAssistantThreadViewModelInput) {
  const activeTurn = thread?.latestTurn ?? null
  const latestTurnSettled = isLatestTurnSettled(activeTurn, thread?.session ?? null)
  const phase = thread ? derivePhase(thread.session ?? null) : "disconnected"
  const isWorking = isRunning || isSending || isInterrupting || Boolean(isRevertingCheckpoint)
  const activeTurnStartedAt = deriveActiveWorkStartedAt(
    activeTurn,
    thread?.session ?? null,
    null,
  )
  const threadActivities = thread?.activities ?? []
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeTurn?.turnId ?? undefined),
    [activeTurn?.turnId, threadActivities],
  )
  const timelineEntries = useMemo(
    () => deriveTimelineEntries(thread?.messages ?? [], thread?.proposedPlans ?? [], workLogEntries),
    [thread?.messages, thread?.proposedPlans, workLogEntries],
  )
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeTurn?.turnId),
    [activeTurn?.turnId, threadActivities],
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
    if (!activeTurn?.startedAt || !activeTurn.completedAt) return null
    if (!latestTurnHasToolActivity) return null

    const elapsed = formatElapsed(activeTurn.startedAt, activeTurn.completedAt)
    return elapsed ? `Worked for ${elapsed}` : null
  }, [activeTurn?.completedAt, activeTurn?.startedAt, latestTurnHasToolActivity, latestTurnSettled])
  const completionDividerBeforeEntryId = useMemo(
    () =>
      deriveCompletionDividerBeforeEntryId({
        latestTurnSettled,
        activeTurnStartedAt: activeTurn?.startedAt,
        activeTurnCompletedAt: activeTurn?.completedAt,
        completionSummary,
        timelineEntries,
      }),
    [activeTurn?.completedAt, activeTurn?.startedAt, completionSummary, latestTurnSettled, timelineEntries],
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
    activeTurnStartedAt,
    timelineEntries,
    completionDividerBeforeEntryId,
    completionSummary,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  }
}
