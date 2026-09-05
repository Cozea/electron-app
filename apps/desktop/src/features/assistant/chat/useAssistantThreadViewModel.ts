import { useMemo } from "react"

import type { ProviderInteractionMode } from "@cozea/assistant-contracts"

import {
  derivePhase,
  deriveTimelineEntries,
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
  inferCheckpointTurnCountByTurnId,
  type PendingUserInput,
} from "@/features/assistant/chat/session-logic"
import {
  buildRevertTurnCountByUserMessageId,
  buildTurnDiffSummaryByAssistantMessageId,
} from "@/features/assistant/chat/threadTimelineDerivations"
import { deriveWorkLogEntries } from "@/features/assistant/chat/workLogDerivations"
import {
  deriveActiveWorkStartedAt,
} from "@/features/assistant/chat/session-logic"
import { deriveGenerationStatusPhase } from "@/features/assistant/chat/MessagesTimeline.logic"
import type { Thread } from "@/features/assistant/model/types"
import { useStableChatMap } from "./useChatRenderStability"

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
  const revertTurnCountByUserMessageId = useStableChatMap(useMemo(
    () =>
      buildRevertTurnCountByUserMessageId({
        timelineEntries,
        turnDiffSummaryByAssistantMessageId,
        inferredCheckpointTurnCountByTurnId,
      }),
    [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId],
  ))
  const activeProposedPlan = useMemo(
    () => findLatestProposedPlan(thread?.proposedPlans ?? [], activeTurn?.turnId ?? null),
    [activeTurn?.turnId, thread?.proposedPlans],
  )
  const showPlanFollowUpPrompt =
    !pendingUserInputs.some((request) => request.responseMode !== "message") &&
    selectedInteractionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan)

  return {
    activeTurn,
    latestTurnSettled,
    phase,
    isWorking,
    activeWorkStartedAt,
    // A newly submitted turn starts before the shell projection replaces the
    // previous settled latestTurn. Treat every explicit busy state as active
    // so the timeline shows feedback immediately instead of waiting for that
    // projection to catch up.
    isWorkActive: isWorking,
    generationStatusPhase,
    timelineEntries,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    activeProposedPlan,
    showPlanFollowUpPrompt,
  }
}
