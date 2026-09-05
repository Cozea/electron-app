import { describe, expect, it } from "vitest";
import { MessageId, TurnId } from "@cozea/assistant-contracts";
import { projectConversation } from "@/features/assistant/chat/conversationProjection";
import type { TimelineEntry } from "@/features/assistant/chat/session-logic";

const turn = TurnId.makeUnsafe("turn");
const newer = TurnId.makeUnsafe("newer");
const at = (second: number) => `2026-09-05T00:00:${String(second).padStart(2, "0")}Z`;
function message(
  id: string,
  role: "user" | "assistant",
  second: number,
  turnId: TurnId | null = turn,
  streaming = false,
): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: at(second),
    message: {
      id: MessageId.makeUnsafe(id),
      role,
      turnId,
      text: id,
      streaming,
      createdAt: at(second),
      ...(streaming ? {} : { completedAt: at(second) }),
    },
  };
}
function tool(
  id: string,
  second: number,
  status: "completed" | "failed" | "inProgress" = "completed",
): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt: at(second),
    entry: {
      id,
      createdAt: at(second),
      turnId: turn,
      status,
      tone: "tool",
      label: "Read file",
      requestKind: "file-read",
    },
  };
}
const settled = { turnId: turn, state: "completed", startedAt: at(0), completedAt: at(8) };
const sequence = [
  message("user", "user", 0, null),
  message("commentary", "assistant", 1),
  tool("read", 2),
  message("answer", "assistant", 8),
];

describe("conversation projection", () => {
  it("keeps commentary/tool/text in one active response with no final footer or fold", () => {
    const result = projectConversation({
      entries: sequence,
      latestTurn: settled,
      runningTurnId: turn,
      isWorking: true,
    });
    expect([...result.actionMessageIds]).toEqual([]);
    expect(result.folds).toEqual([]);
    expect([...result.activeTurnIds]).toEqual([turn]);
  });
  it("folds only intermediate work and grants actions only to terminal text", () => {
    const result = projectConversation({
      entries: sequence,
      latestTurn: settled,
      isWorking: false,
    });
    expect([...result.actionMessageIds]).toEqual(["answer"]);
    expect(result.folds[0]).toMatchObject({
      turnId: turn,
      anchorEntryId: "commentary",
      label: "Worked for 8s",
    });
    expect([...result.folds[0]!.hiddenEntryIds]).toEqual(["commentary", "read"]);
  });
  it("keeps promptless replacement turns in the same active visual response", () => {
    const entries = [...sequence, message("replacement", "assistant", 9, newer, true)];
    const result = projectConversation({
      entries,
      latestTurn: settled,
      runningTurnId: newer,
      isWorking: true,
    });
    expect(result.actionMessageIds.size).toBe(0);
    expect(result.folds.length).toBe(0);
    expect(result.activeTurnIds.has(turn)).toBe(true);
  });
  it("a new user boundary leaves earlier completed response settled", () => {
    const entries = [
      ...sequence,
      message("steer", "user", 9, null),
      message("new", "assistant", 10, newer, true),
    ];
    const result = projectConversation({
      entries,
      latestTurn: settled,
      runningTurnId: newer,
      isWorking: true,
    });
    expect([...result.actionMessageIds]).toEqual(["answer"]);
    expect(result.folds).toHaveLength(1);
  });
  it("places terminal actions after a trailing tool group, preserving failed rows", () => {
    const entries = [...sequence, tool("tail-one", 9), tool("tail-error", 10, "failed")];
    const result = projectConversation({ entries, latestTurn: settled, isWorking: false });
    expect(result.footerAfterEntryId.get("answer")).toBe("tail-error");
    expect(result.folds[0]?.hiddenEntryIds.has("tail-error")).toBe(false);
  });
  it("keeps ongoing background tools outside completion folds", () => {
    const entries = [sequence[0]!, tool("background", 1, "inProgress"), ...sequence.slice(1)];
    const result = projectConversation({ entries, latestTurn: settled, isWorking: false });
    expect(result.folds[0]?.hiddenEntryIds.has("background")).toBe(false);
  });
  it("handles unkeyed history without treating each assistant segment as final", () => {
    const entries = [
      message("u", "user", 0, null),
      message("a", "assistant", 1, null),
      message("b", "assistant", 2, null),
    ];
    expect([...projectConversation({ entries, isWorking: false }).actionMessageIds]).toEqual(["b"]);
    expect(projectConversation({ entries, isWorking: true }).actionMessageIds.size).toBe(0);
  });
  it("does not relabel interrupted work as successful", () => {
    const result = projectConversation({
      entries: sequence,
      latestTurn: { ...settled, state: "interrupted" },
      isWorking: false,
    });
    expect(result.folds[0]?.label).toBe("You stopped after 8s");
  });
  it("keeps a lone compaction visible, but folds it with other intermediate work", () => {
    const compaction = tool("compact", 9);
    if (compaction.kind !== "work") throw new Error("fixture");
    compaction.entry.sourceActivityKind = "context-compaction";
    expect(
      projectConversation({
        entries: [sequence[0]!, compaction, sequence[3]!],
        latestTurn: settled,
        isWorking: false,
      }).folds,
    ).toEqual([]);
    const result = projectConversation({
      entries: [...sequence, tool("tail", 9), compaction, tool("failed", 10, "failed")],
      latestTurn: settled,
      isWorking: false,
    });
    expect(result.folds[0]?.hiddenEntryIds.has("compact")).toBe(true);
    expect(result.folds[0]?.hiddenEntryIds.has("failed")).toBe(false);
  });
});
