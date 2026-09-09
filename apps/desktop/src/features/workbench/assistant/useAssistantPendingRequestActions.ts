import { useCallback, type Dispatch, type SetStateAction } from "react"
import {
  ApprovalRequestId,
  CommandId,
  type NativeApi,
  type ProviderApprovalDecision,
} from "@cozea/assistant-contracts"

import {
  buildPendingUserInputAnswers,
  pendingUserInputDraftFromAnswer,
} from "@/features/assistant/pendingUserInput"
import {
  submitQuestionOnce,
} from "@/features/assistant/questionDraftStore"
import type { PendingUserInput } from "@/features/assistant/chat/session-logic"
import type { UserInputAnswerDrafts } from "@/features/assistant/model/assistantComposerTypes"
import type { Thread } from "@/features/assistant/model/types"
import { newCommandId } from "@/features/assistant/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"

interface UseAssistantPendingRequestActionsInput {
  thread: Thread | null
  pendingUserInputs: readonly PendingUserInput[]
  userInputDrafts: UserInputAnswerDrafts
  setUserInputDrafts: Dispatch<SetStateAction<UserInputAnswerDrafts>>
  getOrchestration: () => NativeApi["orchestration"]
  runMetaSync: (
    mutate: () => Promise<void>,
    options?: { requestKey?: string },
  ) => Promise<void>
}

/** Owns approval and question-response command construction for one bound thread. */
export function useAssistantPendingRequestActions(
  input: UseAssistantPendingRequestActionsInput,
) {
  const {
    getOrchestration,
    pendingUserInputs,
    runMetaSync,
    setUserInputDrafts,
    thread,
    userInputDrafts,
  } = input
  const handleApprovalDecision = useCallback(
    async (requestId: string, decision: ProviderApprovalDecision) => {
      if (!thread) return
      const threadId = thread.id

      await runMetaSync(
        async () => {
          ensureNativeApi()
          await getOrchestration().dispatchCommand({
            type: "thread.approval.respond",
            commandId: newCommandId(),
            threadId,
            requestId: ApprovalRequestId.makeUnsafe(requestId),
            decision,
            createdAt: new Date().toISOString(),
          })
        },
        { requestKey: requestId },
      )
    },
    [getOrchestration, runMetaSync, thread],
  )

  const handleUserInputDraftChange = useCallback(
    (requestId: string, questionId: string, value: string | string[]) => {
      setUserInputDrafts((current) => ({
        ...current,
        [requestId]: {
          ...current[requestId],
          [questionId]: value,
        },
      }))
    },
    [setUserInputDrafts],
  )

  const handleSubmitUserInput = useCallback(
    async (requestId: string) => {
      if (!thread) return

      const request = pendingUserInputs.find(
        (entry) => String(entry.requestId) === requestId,
      )
      if (!request) return
      const threadId = thread.id
      if (request.responseMode === "message") {
        await runMetaSync(
          () =>
            submitQuestionOnce(threadId, request, async (submission) => {
              await getOrchestration().dispatchCommand({
                type: "thread.user-input.respond",
                commandId: CommandId.makeUnsafe(submission.commandId),
                threadId,
                requestId: ApprovalRequestId.makeUnsafe(requestId),
                answers: submission.answers,
                createdAt: submission.createdAt,
              })
            }),
          { requestKey: requestId },
        )
        return
      }

      const answers = userInputDrafts[requestId]
      if (!answers) return
      const normalizedAnswers = buildPendingUserInputAnswers(
        request.questions,
        Object.fromEntries(
          request.questions.map((question) => [
            question.id,
            pendingUserInputDraftFromAnswer(question, answers[question.id]),
          ]),
        ),
      )
      if (normalizedAnswers === null) return

      await runMetaSync(
        async () => {
          ensureNativeApi()
          await getOrchestration().dispatchCommand({
            type: "thread.user-input.respond",
            commandId: newCommandId(),
            threadId,
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
    [
      getOrchestration,
      pendingUserInputs,
      runMetaSync,
      setUserInputDrafts,
      thread,
      userInputDrafts,
    ],
  )

  return {
    handleApprovalDecision,
    handleSubmitUserInput,
    handleUserInputDraftChange,
  }
}
