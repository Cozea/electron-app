import { describe, expect, it } from "vitest";
import { MessageId, TurnId } from "@cozea/assistant-contracts";
import { deriveTimelineEntries, type WorkLogEntry } from "@/features/assistant/chat/session-logic";
import { deriveToolPhase, summarizeToolPhase } from "@/features/assistant/chat/toolPhase";

const turn = TurnId.makeUnsafe("turn");
const entry = (id: string, status: WorkLogEntry["status"] = "completed"): WorkLogEntry => ({
  id,
  createdAt: "2026-09-05T00:00:01Z",
  turnId: turn,
  tone: "tool",
  label: "Read file",
  requestKind: "file-read",
  status,
});
describe("tool activity phase", () => {
  it("does not mistake session diagnostics for tool activity", () => {
    const notice = {
      ...entry("notice", "failed"),
      tone: "error" as const,
      activityKind: "runtime.error",
    };
    expect(deriveToolPhase(deriveTimelineEntries([], [], [notice]), true, turn).active).toBe(false);
  });
  it("replaces generic Working while tools run and between completed tools and text", () => {
    for (const status of ["inProgress", "completed"] as const) {
      const phase = deriveToolPhase(
        deriveTimelineEntries([], [], [entry("a", status)]),
        true,
        turn,
      );
      expect(phase.active).toBe(true);
      expect(phase.liveIds.has("a")).toBe(status === "inProgress");
    }
  });
  it("settles on resumed text or turn interruption/completion", () => {
    const rows = deriveTimelineEntries(
      [
        {
          id: MessageId.makeUnsafe("answer"),
          role: "assistant",
          text: "Resuming",
          streaming: true,
          createdAt: "2026-09-05T00:00:02Z",
          turnId: turn,
        },
      ],
      [],
      [entry("a", "inProgress")],
    );
    expect(deriveToolPhase(rows, true, turn).active).toBe(false);
    expect(deriveToolPhase(rows.slice(0, 1), false, turn).active).toBe(false);
  });
  it("does not animate an older turn and treats a new user message as a boundary", () => {
    const rows = deriveTimelineEntries([], [], [entry("a")]);
    expect(deriveToolPhase(rows, true, TurnId.makeUnsafe("other")).active).toBe(false);
    const user = {
      id: MessageId.makeUnsafe("question"),
      role: "user" as const,
      text: "Next",
      streaming: false,
      createdAt: "2026-09-05T00:00:02Z",
    };
    expect(
      deriveToolPhase(deriveTimelineEntries([user], [], [entry("a")]), true, null).active,
    ).toBe(false);
  });
  it("tracks simultaneous calls using their original row identity", () => {
    const phase = deriveToolPhase(
      deriveTimelineEntries(
        [],
        [],
        [
          {
            ...entry("update", "inProgress"),
            timelineOrigin: { id: "start", createdAt: "2026-09-05T00:00:00Z" },
          },
          entry("b", "inProgress"),
        ],
      ),
      true,
      turn,
    );
    expect([...phase.liveIds]).toEqual(["start", "b"]);
  });
  it("summarizes completed actions and counts failures without claiming success", () => {
    expect(summarizeToolPhase([entry("a", "inProgress")], true)).toBe("Working");
    expect(summarizeToolPhase([entry("a"), entry("b", "inProgress")], true)).toBe("Read 1 file");
    expect(
      summarizeToolPhase([entry("a"), entry("b", "failed"), entry("c", "failed")], false),
    ).toBe("Read 1 file · 2 actions failed");
    expect(summarizeToolPhase([entry("a", "failed")], false)).toBe("1 action failed");
  });
});
it("never summarizes unfinished, declined or cancelled actions as successful after the phase ends", () => {
  expect(summarizeToolPhase([entry("running", "inProgress")], false)).toBe("1 action unfinished");
  expect(summarizeToolPhase([entry("declined", "declined")], false)).toBe("1 action declined");
  expect(summarizeToolPhase([entry("cancelled", "cancelled")], false)).toBe("1 action stopped");
});
it("does not count reasoning, task activity or diagnostics as tools", () => {
  const rows = ["reasoning.started", "task.progress", "runtime.error"].map(activityKind => ({
    ...entry(activityKind), activityKind, tone: "thinking" as const,
  }));
  expect(deriveToolPhase(deriveTimelineEntries([], [], rows), true, turn).active).toBe(false);
  expect(summarizeToolPhase([...rows, entry("real")], false)).toBe("Read 1 file");
});
