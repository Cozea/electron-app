import { describe, expect, it } from "vitest";
import { MessageId, TurnId } from "@cozea/assistant-contracts";
import {
  buildConversationRows,
  reuseConversationRows,
  type ConversationRowsInput,
  type ConversationRow,
  MAX_INLINE_FOLD_ROWS,
} from "@/features/assistant/chat/conversationRows";
import type { TimelineEntry } from "@/features/assistant/chat/session-logic";

const turnId = TurnId.makeUnsafe("turn");
const time = "2026-09-05T00:00:00Z";
function message(id: string, role: "assistant" | "user", text = id): TimelineEntry {
  return {
    kind: "message",
    id,
    createdAt: time,
    message: {
      id: MessageId.makeUnsafe(id),
      role,
      turnId: role === "assistant" ? turnId : null,
      text,
      streaming: false,
      createdAt: time,
    },
  };
}
function tool(
  id: string,
  status: "completed" | "failed" | "inProgress" = "completed",
): TimelineEntry {
  return {
    kind: "work",
    id,
    createdAt: time,
    entry: {
      id,
      createdAt: time,
      turnId,
      tone: "tool",
      label: "Read file",
      requestKind: "file-read",
      status,
    },
  };
}
const defaults: Omit<ConversationRowsInput, "entries"> = {
  latestTurn: { turnId, state: "completed", startedAt: time, completedAt: time },
  isWorking: false,
  activeWorkStartedAt: time,
  generationStatusPhase: "working",
  expanded: {},
};
const sequence = [
  message("user", "user"),
  message("commentary", "assistant"),
  tool("read"),
  message("final", "assistant"),
];

describe("conversation rows", () => {
  it("retains inline animation at the threshold and virtualizes larger expanded folds with stable IDs", () => {
    const makeEntries = (count: number) => [
      message("user", "user"),
      ...Array.from({ length: count }, (_, index) => message(`detail-${index}`, "assistant")),
      message("final", "assistant"),
      tool("trailing"),
    ];
    // The trailing folded tool counts toward the threshold as well.
    const inline = buildConversationRows({
      ...defaults,
      entries: makeEntries(MAX_INLINE_FOLD_ROWS - 1),
      expanded: { "turn-fold:turn": true },
    });
    expect(inline.find((row) => row.kind === "turn-fold")).toMatchObject({
      children: expect.any(Array),
    });
    expect(inline.find((row) => row.kind === "turn-fold")?.virtualized).toBeUndefined();
    const large = buildConversationRows({
      ...defaults,
      entries: makeEntries(MAX_INLINE_FOLD_ROWS),
      expanded: { "turn-fold:turn": true },
    });
    expect(large.find((row) => row.kind === "turn-fold")).toMatchObject({
      virtualized: true,
      children: [],
    });
    expect(large.filter((row) => row.expandedFoldId).map((row) => row.id)).toEqual([
      ...Array.from({ length: MAX_INLINE_FOLD_ROWS }, (_, index) => `detail-${index}`),
      expect.stringContaining("work-toggle:"),
    ]);
    expect(large.at(-1)).toMatchObject({ kind: "assistant-meta" });
    const collapsed = buildConversationRows({
      ...defaults,
      entries: makeEntries(MAX_INLINE_FOLD_ROWS),
    });
    expect(collapsed.map((row) => row.id)).toEqual([
      "user",
      "turn-fold:turn",
      "final",
      "assistant-meta:final",
    ]);
  });
  it("distinguishes a blocking question from working/thinking without settling its turn", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: sequence.slice(0, 3),
      isWorking: true,
      runningTurnId: turnId,
      waitingFor: "question",
      generationStatusPhase: "thinking",
    });
    expect(rows.at(-1)?.kind).toBe("input-waiting");
    expect(
      rows.some(
        (row) => row.kind === "thinking" || row.kind === "turn-status" || row.kind === "turn-fold",
      ),
    ).toBe(false);
    expect(rows.find((row) => row.kind === "work-toggle")?.active).toBe(false);
    expect(rows.some((row) => row.kind === "message" && row.showActions)).toBe(false);
  });
  it("preserves expanded chronology for trailing work separated by final text", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: [...sequence, tool("trailing")],
      expanded: { "turn-fold:turn": true },
    });
    const flatten = (items: ConversationRow[]): string[] =>
      items.flatMap((row) => {
        if (row.kind === "turn-fold" || row.kind === "turn-fold-content")
          return row.expanded ? flatten(row.children) : [];
        if (row.kind === "work" || row.kind === "work-toggle" || row.kind === "notices")
          return row.groupedEntries.map((entry) => entry.id);
        return [row.id];
      });
    expect(flatten(rows)).toEqual([
      "user",
      "commentary",
      "read",
      "final",
      "trailing",
      "assistant-meta:final",
    ]);
    expect(rows.find((row) => row.kind === "message" && row.message.id === "final")).toMatchObject({
      showActions: false,
    });
    const collapsed = buildConversationRows({
      ...defaults,
      entries: [...sequence, tool("trailing")],
    });
    expect(collapsed.at(-1)).toMatchObject({ kind: "assistant-meta", message: { id: "final" } });
    expect(collapsed.filter((row) => row.kind === "assistant-meta")).toHaveLength(1);
  });
  it("keeps the same accordion identity across live start and completion-only snapshot", () => {
    const start = tool("start", "inProgress");
    const finish = tool("finish");
    if (start.kind !== "work" || finish.kind !== "work") throw new Error("fixture");
    start.entry.toolCallId = finish.entry.toolCallId = "call";
    const input = { ...defaults, isWorking: true, runningTurnId: turnId };
    const live = buildConversationRows({ ...input, entries: [start] });
    const first = live[0]!;
    if (first.kind !== "work-toggle") throw new Error("fixture");
    const restored = buildConversationRows({
      ...input,
      entries: [finish],
      expanded: { [first.groupId]: true },
    });
    expect(restored[0]?.id).toBe(first.id);
    expect(restored[0]?.kind === "work-toggle" && restored[0].expanded).toBe(true);
  });
  it("renders one completed fold and only a terminal footer", () => {
    const rows = buildConversationRows({ ...defaults, entries: sequence });
    expect(rows.map((row) => row.kind)).toEqual(["message", "turn-fold", "message"]);
    const fold = rows[1]!;
    expect(fold.kind === "turn-fold" && fold.children.map((row) => row.kind)).toEqual([
      "message",
      "work-toggle",
    ]);
    expect(
      fold.kind === "turn-fold" &&
        fold.children.some((row) => row.kind === "message" && row.showActions),
    ).toBe(false);
    expect(rows[2]?.kind === "message" && rows[2].showActions).toBe(true);
  });
  it("keeps active response segments unfolded with no per-message actions", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: sequence,
      isWorking: true,
      runningTurnId: turnId,
    });
    expect(rows.some((row) => row.kind === "turn-fold")).toBe(false);
    expect(rows.some((row) => row.kind === "message" && row.showActions)).toBe(false);
  });
  it("moves exactly one footer after visible trailing tools", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: [...sequence, tool("tail"), tool("error", "failed")],
    });
    expect(rows.at(-1)?.kind).toBe("assistant-meta");
    expect(rows.filter((row) => row.kind === "assistant-meta")).toHaveLength(1);
    expect(rows.some((row) => row.kind === "message" && row.showActions)).toBe(false);
  });
  it("does not mix hidden tools with visible background work in one accordion", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: [sequence[0]!, tool("done"), tool("background", "inProgress"), sequence[3]!],
    });
    expect(rows.map((row) => row.kind)).toEqual(["message", "turn-fold", "work-toggle", "message"]);
    const background = rows[2]!;
    expect(
      background.kind === "work-toggle" && background.groupedEntries.map((entry) => entry.id),
    ).toEqual(["background"]);
  });
  it("does not show Working alongside an explicit Thinking phase", () => {
    const rows = buildConversationRows({
      ...defaults,
      entries: sequence.slice(0, 3),
      isWorking: true,
      runningTurnId: turnId,
      generationStatusPhase: "thinking",
    });
    expect(rows.at(-1)?.kind).toBe("thinking");
    expect(rows.some((row) => row.kind === "turn-status")).toBe(false);
    expect(rows.find((row) => row.kind === "work-toggle")?.active).toBe(false);
  });
  it("reuses unrelated row identities and accepts same-sized attachment replacements", () => {
    const before = buildConversationRows({ ...defaults, entries: sequence });
    const changed = message("final", "assistant", "new canonical text");
    const after = reuseConversationRows(
      before,
      buildConversationRows({ ...defaults, entries: [...sequence.slice(0, 3), changed] }),
    );
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).not.toBe(before[2]);
    const user = sequence[0]!;
    if (user.kind !== "message") throw new Error("fixture");
    const replaced = {
      ...user,
      message: {
        ...user.message,
        attachments: [
          {
            type: "image" as const,
            id: "image",
            name: "new.png",
            mimeType: "image/png",
            sizeBytes: 1,
            previewUrl: "new",
          },
        ],
      },
    };
    const original = {
      ...replaced,
      message: {
        ...replaced.message,
        attachments: [{ ...replaced.message.attachments[0]!, previewUrl: "old" }],
      },
    };
    const first = buildConversationRows({ ...defaults, entries: [original] });
    const second = reuseConversationRows(
      first,
      buildConversationRows({ ...defaults, entries: [replaced] }),
    );
    expect(second[0]).not.toBe(first[0]);
  });
});
