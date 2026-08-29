import { describe, expect, it } from "vitest"
import { EventId, MessageId, TurnId } from "@cozea/assistant-contracts"

import { isIntentionalAbortMessage, normalizeThreadError } from "../../apps/desktop/src/features/projects/components/assistant/lib/assistantErrors"
import {
  buildRevertTurnCountByUserMessageId,
  buildTurnDiffSummaryByAssistantMessageId,
  deriveCompletionDividerBeforeEntryId,
  deriveCompletionSummariesByMessageId,
} from "../../apps/desktop/src/features/projects/components/assistant/chat/threadTimelineDerivations"
import type { TimelineEntry } from "../../apps/desktop/src/features/projects/components/assistant/chat/timelineDerivations"
import type { ChatMessage, TurnDiffSummary } from "../../apps/desktop/src/stores/types"

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

  it("prefers the latest turn assistantMessageId when available", () => {
    const dividerId = deriveCompletionDividerBeforeEntryId({
      latestTurnSettled: true,
      activeTurnStartedAt: "2026-01-01T00:00:00.000Z",
      activeTurnCompletedAt: "2026-01-01T00:00:03.000Z",
      assistantMessageId: MessageId.makeUnsafe("assistant-after"),
      completionSummary: "Worked for 3s",
      timelineEntries: [
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
        {
          id: "assistant-after",
          kind: "message",
          createdAt: "2026-01-01T00:00:04.000Z",
          message: {
            id: MessageId.makeUnsafe("assistant-after"),
            role: "assistant",
            text: "after",
            createdAt: "2026-01-01T00:00:04.000Z",
            streaming: false,
          },
        },
      ],
    })

    expect(dividerId).toBe("assistant-after")
  })

  it("keeps completion summaries for historical assistant turns with tools", () => {
    const turnOne = TurnId.makeUnsafe("turn-1")
    const turnTwo = TurnId.makeUnsafe("turn-2")
    const assistantOne = MessageId.makeUnsafe("assistant-1")
    const assistantTwo = MessageId.makeUnsafe("assistant-2")
    const messages: ChatMessage[] = [
      {
        id: assistantOne,
        role: "assistant",
        text: "first",
        turnId: turnOne,
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:03.000Z",
        streaming: false,
      },
      {
        id: assistantTwo,
        role: "assistant",
        text: "second",
        turnId: turnTwo,
        createdAt: "2026-01-01T00:01:00.000Z",
        completedAt: "2026-01-01T00:01:04.000Z",
        streaming: false,
      },
    ]

    const summaries = deriveCompletionSummariesByMessageId({
      messages,
      activities: [
        {
          id: EventId.makeUnsafe("activity-1"),
          kind: "tool.completed",
          summary: "Read file",
          tone: "tool",
          payload: {},
          turnId: turnOne,
          createdAt: "2026-01-01T00:00:02.000Z",
        },
        {
          id: EventId.makeUnsafe("activity-2"),
          kind: "tool.completed",
          summary: "Ran command",
          tone: "tool",
          payload: {},
          turnId: turnTwo,
          createdAt: "2026-01-01T00:01:03.000Z",
        },
      ],
      activeTurn: {
        turnId: turnTwo,
        state: "completed",
        requestedAt: "2026-01-01T00:01:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
        completedAt: "2026-01-01T00:01:04.000Z",
        assistantMessageId: assistantTwo,
      },
      latestTurnSettled: true,
    })

    expect(summaries.get(assistantOne)).toBe("Worked for 3s")
    expect(summaries.get(assistantTwo)).toBe("Worked for 4s")
  })

  it("reports one duration for the whole turn across assistant generations", () => {
    const turnId = TurnId.makeUnsafe("turn-multi")
    const firstAssistant = MessageId.makeUnsafe("assistant-preamble")
    const finalAssistant = MessageId.makeUnsafe("assistant-final")
    const summaries = deriveCompletionSummariesByMessageId({
      messages: [
        {
          id: MessageId.makeUnsafe("user-multi"),
          role: "user",
          text: "run it",
          createdAt: "2026-01-01T00:00:00.000Z",
          streaming: false,
        },
        {
          id: firstAssistant,
          role: "assistant",
          text: "Starting.",
          turnId,
          createdAt: "2026-01-01T00:00:01.000Z",
          completedAt: "2026-01-01T00:00:01.001Z",
          streaming: false,
        },
        {
          id: finalAssistant,
          role: "assistant",
          text: "Done.",
          turnId,
          createdAt: "2026-01-01T00:00:07.000Z",
          completedAt: "2026-01-01T00:00:08.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: EventId.makeUnsafe("tool-multi"),
          kind: "tool.completed",
          summary: "Ran command",
          tone: "tool",
          payload: {},
          turnId,
          createdAt: "2026-01-01T00:00:06.000Z",
        },
      ],
      activeTurn: null,
      latestTurnSettled: true,
    })

    expect(summaries.has(firstAssistant)).toBe(false)
    expect(summaries.get(finalAssistant)).toBe("Worked for 8s")
  })

  it("keeps the previous completed summary while the next turn is starting", () => {
    const previousTurn = TurnId.makeUnsafe("turn-previous")
    const currentTurn = TurnId.makeUnsafe("turn-current")
    const previousAssistant = MessageId.makeUnsafe("assistant-previous")
    const summaries = deriveCompletionSummariesByMessageId({
      messages: [
        {
          id: MessageId.makeUnsafe("user-previous"),
          role: "user",
          text: "first",
          createdAt: "2026-01-01T00:00:00.000Z",
          streaming: false,
        },
        {
          id: previousAssistant,
          role: "assistant",
          text: "done",
          turnId: previousTurn,
          createdAt: "2026-01-01T00:00:03.000Z",
          completedAt: "2026-01-01T00:00:04.000Z",
          streaming: false,
        },
        {
          id: MessageId.makeUnsafe("user-current"),
          role: "user",
          text: "second",
          createdAt: "2026-01-01T00:01:00.000Z",
          streaming: false,
        },
      ],
      activities: [
        {
          id: EventId.makeUnsafe("tool-previous"),
          kind: "tool.completed",
          summary: "Ran command",
          tone: "tool",
          payload: {},
          turnId: previousTurn,
          createdAt: "2026-01-01T00:00:03.500Z",
        },
      ],
      activeTurn: {
        turnId: currentTurn,
        state: "running",
        requestedAt: "2026-01-01T00:01:00.000Z",
        startedAt: "2026-01-01T00:01:00.000Z",
      },
      latestTurnSettled: false,
    })

    expect(summaries.get(previousAssistant)).toBe("Worked for 4s")
  })
})
