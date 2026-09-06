import { describe, expect, it } from "vitest";
import { MessageId, TurnId } from "@cozea/assistant-contracts";

import {
  buildConversationRows,
  type ConversationRowsInput,
} from "@/features/assistant/chat/conversationRows";
import type { TimelineEntry } from "@/features/assistant/chat/session-logic";

const turnId = TurnId.makeUnsafe("turn-stability");
const time = "2026-09-05T00:00:00Z";

function userMessage(): TimelineEntry {
  return {
    kind: "message",
    id: "user",
    createdAt: time,
    message: {
      id: MessageId.makeUnsafe("user"),
      role: "user",
      turnId: null,
      text: "Do the work",
      streaming: false,
      createdAt: time,
    },
  };
}

const base: ConversationRowsInput = {
  entries: [userMessage()],
  latestTurn: {
    turnId,
    state: "running",
    startedAt: time,
    completedAt: null,
  },
  runningTurnId: turnId,
  activeTurnId: turnId,
  isWorking: true,
  activeWorkStartedAt: time,
  generationStatusPhase: "working",
  expanded: {},
};

describe("active conversation lifecycle stability", () => {
  it("retains one row id from Working to Thinking to Waiting", () => {
    const working = buildConversationRows(base).at(-1);
    const thinking = buildConversationRows({
      ...base,
      generationStatusPhase: "thinking",
    }).at(-1);
    const waiting = buildConversationRows({
      ...base,
      generationStatusPhase: "thinking",
      waitingFor: "question",
    }).at(-1);

    expect(working).toMatchObject({
      id: "active-turn-lifecycle-row",
      kind: "turn-status",
    });
    expect(thinking).toMatchObject({
      id: "active-turn-lifecycle-row",
      kind: "thinking",
    });
    expect(waiting).toMatchObject({
      id: "active-turn-lifecycle-row",
      kind: "input-waiting",
      requestKind: "question",
    });
  });
});
