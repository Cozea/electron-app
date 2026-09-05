import { expect, it, vi } from "vitest";
import { MessageId, TurnId } from "@cozea/assistant-contracts";
import {
  buildConversationRows,
  type ConversationRowsInput,
  type ConversationRow,
} from "@/features/assistant/chat/conversationRows";
import { createConversationRowProjector } from "@/features/assistant/chat/conversationRowProjector";
import type { TimelineEntry } from "@/features/assistant/chat/session-logic";

const turnId = TurnId.makeUnsafe("turn"),
  time = "2026-09-05T00:00:00Z";
const msg = (id: string): TimelineEntry => ({
  kind: "message",
  id,
  createdAt: time,
  message: {
    id: MessageId.makeUnsafe(id),
    role: "assistant",
    turnId,
    text: id,
    streaming: false,
    createdAt: time,
  },
});
const tool = (id: string): TimelineEntry => ({
  kind: "work",
  id,
  createdAt: time,
  entry: {
    id,
    turnId,
    createdAt: time,
    label: "Read",
    tone: "tool",
    status: "failed",
    requestKind: "file-read",
  },
});
const base: ConversationRowsInput = {
  entries: [msg("hidden"), msg("final"), tool("tail-a"), tool("tail-b")],
  latestTurn: { turnId, state: "completed", startedAt: time, completedAt: time },
  isWorking: false,
  activeWorkStartedAt: time,
  generationStatusPhase: "working",
  expanded: { "turn-fold:turn": true },
};
function replace(
  input: ConversationRowsInput,
  index: number,
  patch: object,
): ConversationRowsInput {
  return {
    ...input,
    entries: input.entries.map((entry, i) =>
      i === index && entry.kind === "message"
        ? { ...entry, message: { ...entry.message, ...patch } }
        : entry,
    ),
  };
}
function flatten(rows: ConversationRow[]): ConversationRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn-fold" || row.kind === "turn-fold-content"
      ? [row, ...flatten(row.children)]
      : [row],
  );
}
it("patches authoritative Unicode/attachment replacements, hidden folds and final footer data without rebuilding", () => {
  const build = vi.fn(buildConversationRows),
    projector = createConversationRowProjector(build);
  const first = projector.project(base);
  let input = replace(base, 0, { text: "短い 👩🏽‍💻" });
  input = replace(input, 1, {
    text: "Replacement, not a delta",
    attachments: [
      { type: "file", id: "f", name: "notes.txt", mimeType: "text/plain", sizeBytes: 1 },
    ],
  });
  const next = projector.project(input);
  expect(build).toHaveBeenCalledTimes(1);
  expect(next).toEqual(buildConversationRows(input));
  expect(next.find((row) => row.kind === "work-toggle")).toBe(
    first.find((row) => row.kind === "work-toggle"),
  );
  expect(
    flatten(next)
      .filter((row) => row.kind === "message" || row.kind === "assistant-meta")
      .map((row) => row.message.text),
  ).toContain("短い 👩🏽‍💻");
  expect(flatten(next).find((row) => row.kind === "assistant-meta")).toMatchObject({
    message: { text: "Replacement, not a delta" },
  });
  const newer = replace(input, 1, { text: "" });
  expect(projector.project(newer)).toEqual(buildConversationRows(newer));
  expect(build).toHaveBeenCalledTimes(1);
  projector.clear();
  projector.project(newer);
  expect(build).toHaveBeenCalledTimes(2);
});
it("falls back for structural, lifecycle, disclosure, work and plan changes", () => {
  const cases: ConversationRowsInput[] = [
    { ...base, entries: [...base.entries, msg("append")] },
    { ...base, entries: base.entries.slice(1) },
    { ...base, entries: [...base.entries].reverse() },
    replace(base, 0, { streaming: true }),
    replace(base, 0, { turnId: TurnId.makeUnsafe("other") }),
    replace(base, 0, { completedAt: "2026-09-05T00:00:01Z" }),
    { ...base, latestTurn: { ...base.latestTurn!, state: "running" } },
    { ...base, runningTurnId: turnId, isWorking: true },
    { ...base, generationStatusPhase: "thinking" },
    { ...base, expanded: {} },
    { ...base, entries: [base.entries[0]!, base.entries[1]!, tool("tail-a"), base.entries[3]!] },
    {
      ...base,
      entries: [
        ...base.entries,
        {
          kind: "proposed-plan",
          id: "plan",
          createdAt: time,
          proposedPlan: {
            id: "plan" as never,
            turnId,
            planMarkdown: "Plan",
            createdAt: time,
            updatedAt: time,
            implementedAt: null,
            implementationThreadId: null,
          },
        },
      ],
    },
  ];
  for (const input of cases) {
    const build = vi.fn(buildConversationRows),
      projector = createConversationRowProjector(build);
    projector.project(base);
    expect(projector.project(input)).toEqual(buildConversationRows(input));
    expect(build).toHaveBeenCalledTimes(2);
    expect(projector.project(input)).toEqual(buildConversationRows(input));
    expect(build).toHaveBeenCalledTimes(2);
  }
});
it("retains the last successful input if a full build fails", () => {
  const build = vi.fn(buildConversationRows),
    projector = createConversationRowProjector(build);
  projector.project(base);
  build.mockImplementationOnce(() => {
    throw new Error("build failed");
  });
  expect(() => projector.project({ ...base, entries: [] })).toThrow("build failed");
  expect(projector.project(replace(base, 0, { text: "recovered" }))).toEqual(
    buildConversationRows(replace(base, 0, { text: "recovered" })),
  );
  expect(build).toHaveBeenCalledTimes(2);
});
it("keeps expanded trailing fold segments in place while patching final text", () => {
  const tail = tool("trailing");
  if (tail.kind !== "work") throw new Error("fixture");
  const input = {
    ...base,
    entries: [
      msg("hidden"),
      msg("final"),
      { ...tail, entry: { ...tail.entry, status: "completed" as const } },
    ],
  };
  const build = vi.fn(buildConversationRows),
    projector = createConversationRowProjector(build);
  const before = projector.project(input);
  const nextInput = replace(input, 1, { text: "Final replaced" });
  const after = projector.project(nextInput);
  expect(after).toEqual(buildConversationRows(nextInput));
  expect(after.find((row) => row.kind === "turn-fold-content")).toBe(
    before.find((row) => row.kind === "turn-fold-content"),
  );
  expect(after.some((row) => row.kind === "turn-fold-content")).toBe(true);
  expect(build).toHaveBeenCalledTimes(1);
});
it("accepts freshly derived wrappers around stable work and message objects", () => {
  const build = vi.fn(buildConversationRows),
    projector = createConversationRowProjector(build);
  projector.project(base);
  const changed = replace(base, 1, { text: "new canonical text" });
  const input = {
    ...changed,
    latestTurn: { ...changed.latestTurn!, updatedAt: "metadata ignored by full projection" },
    entries: changed.entries.map((entry) => ({ ...entry })),
  };
  expect(projector.project(input)).toEqual(buildConversationRows(input));
  expect(build).toHaveBeenCalledTimes(1);
});
