import { useCallback, useState } from "react"
import { ApprovalRequestId, type ProviderApprovalDecision } from "@cozea/assistant-contracts"

import type { UserInputAnswerDrafts } from "@/features/assistant/chat/CozeaChatSurface"
import { newCommandId } from "@/features/assistant/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { Thread } from "@/features/assistant/model/types"

interface UseAssistantApprovalsInput {
  thread: Thread | null
  runMetaSync: (
    mutate: () => Promise<void>,
    options?: { requestKey?: string },
  ) => Promise<void>
}

export function useAssistantApprovals({ thread, runMetaSync }: UseAssistantApprovalsInput) {
  const [userInputDrafts, setUserInputDrafts] = useState<UserInputAnswerDrafts>({})

  const handleApprovalDecision = useCallback(
    async (requestId: string, decision: ProviderApprovalDecision) => {
      if (!thread) {
        return
      }

      await runMetaSync(
        async () => {
          const api = ensureNativeApi()
          await api.orchestration.dispatchCommand({
            type: "thread.approval.respond",
            commandId: newCommandId(),
            threadId: thread.id,
            requestId: ApprovalRequestId.makeUnsafe(requestId),
            decision,
            createdAt: new Date().toISOString(),
          })
        },
        { requestKey: requestId },
      )
    },
    [runMetaSync, thread],
  )

  const handleUserInputDraftChange = useCallback(
    (requestId: string, questionId: string, value: string) => {
      setUserInputDrafts((current) => ({
        ...current,
        [requestId]: {
          ...current[requestId],
          [questionId]: value,
        },
      }))
    },
    [],
  )

  const handleSubmitUserInput = useCallback(
    async (requestId: string) => {
      if (!thread) {
        return
      }

      const answers = userInputDrafts[requestId]
      if (!answers) {
        return
      }

      const normalizedAnswers = Object.fromEntries(
        Object.entries(answers)
          .map(([questionId, answer]) => [questionId, answer.trim()])
          .filter((entry) => entry[1].length > 0),
      )

      if (Object.keys(normalizedAnswers).length === 0) {
        return
      }

      await runMetaSync(
        async () => {
          const api = ensureNativeApi()
          await api.orchestration.dispatchCommand({
            type: "thread.user-input.respond",
            commandId: newCommandId(),
            threadId: thread.id,
            requestId: ApprovalRequestId.makeUnsafe(requestId),
            answers: normalizedAnswers,
            createdAt: new Date().toISOString(),
          })
          setUserInputDrafts((current) => {
            const next = { ...current }
            delete next[requestId]
            return next
          })
        },
        { requestKey: requestId },
      )
    },
    [runMetaSync, thread, userInputDrafts],
  )

  return {
    userInputDrafts,
    handleApprovalDecision,
    handleUserInputDraftChange,
    handleSubmitUserInput,
  }
}
