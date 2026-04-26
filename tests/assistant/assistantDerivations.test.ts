import { describe, expect, it } from "vitest"
import { MessageId, TurnId } from "@cozea/assistant-contracts"

import { isIntentionalAbortMessage, normalizeThreadError } from "../../src/features/projects/components/assistant/lib/assistantErrors"
import {
  buildRevertTurnCountByUserMessageId,
  buildTurnDiffSummaryByAssistantMessageId,
  deriveCompletionDividerBeforeEntryId,
} from "../../src/features/projects/components/assistant/chat/threadTimelineDerivations"
import type { TimelineEntry } from "../../src/features/projects/components/assistant/chat/timelineDerivations"
import type { TurnDiffSummary } from "../../src/stores/types"

describe("assistant error policy", () => {
  it("treats user interruption messages as non-sticky errors", () => {
    expect(isIntentionalAbortMessage("Aborted")).toBe(true)
    expect(isIntentionalAbortMessage("Request was aborted by the user")).toBe(true)
    expect(normalizeThreadError("Interrupted by user.")).toBeNull()
    expect(normalizeThreadError("Provider crashed")).toBe("Provider crashed")
  })
})

describe("assistant timeline derivations", () => {
  it("maps user messages to the previous checkpoint for revert actions", () => {
    const userMessageId = MessageId.makeUnsafe("msg-user")
    const assistantMessageId = MessageId.makeUnsafe("msg-assistant")
    const turnId = TurnId.makeUnsafe("turn-1")
    const timelineEntries: TimelineEntry[] = [
      {
        id: userMessageId,
        kind: "message",
        createdAt: "2026-01-01T00:00:00.000Z",
        message: {
          id: userMessageId,
          role: "user",
          text: "change this",
          createdAt: "2026-01-01T00:00:00.000Z",
          streaming: false,
        },
      },
      {
        id: assistantMessageId,
        kind: "message",
        createdAt: "2026-01-01T00:00:01.000Z",
        message: {
          id: assistantMessageId,
          role: "assistant",
          text: "done",
          createdAt: "2026-01-01T00:00:01.000Z",
          streaming: false,
        },
      },
    ]
    const summaries: TurnDiffSummary[] = [
      {
        turnId,
        completedAt: "2026-01-01T00:00:02.000Z",
        assistantMessageId,
        checkpointTurnCount: 3,
        files: [],
      },
    ]

    const byAssistantMessageId = buildTurnDiffSummaryByAssistantMessageId(summaries)
    const byUserMessageId = buildRevertTurnCountByUserMessageId({
      timelineEntries,
      turnDiffSummaryByAssistantMessageId: byAssistantMessageId,
      inferredCheckpointTurnCountByTurnId: {},
    })

    expect(byUserMessageId.get(userMessageId)).toBe(2)
  })

  it("chooses the assistant message nearest a completed working turn", () => {
    const dividerId = deriveCompletionDividerBeforeEntryId({
      latestTurnSettled: true,
      activeTurnStartedAt: "2026-01-01T00:00:00.000Z",
      activeTurnCompletedAt: "2026-01-01T00:00:03.000Z",
      completionSummary: "Worked for 3s",
      timelineEntries: [
        {
          id: "assistant-before",
          kind: "message",
          createdAt: "2025-12-31T23:59:59.000Z",
          message: {
            id: MessageId.makeUnsafe("assistant-before"),
            role: "assistant",
            text: "before",
            createdAt: "2025-12-31T23:59:59.000Z",
            streaming: false,
          },
        },
        {
          id: "assistant-during",
          kind: "message",
          createdAt: "2026-01-01T00:00:02.000Z",
          message: {
            id: MessageId.makeUnsafe("assistant-during"),
            role: "assistant",
            text: "during",
            createdAt: "2026-01-01T00:00:02.000Z",
            streaming: false,
          },
        },
      ],
    })

    expect(dividerId).toBe("assistant-during")
  })
})
