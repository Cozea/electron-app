import { describe, expect, it } from "vitest";
import { EventId, TurnId, type OrchestrationThreadActivity } from "@cozea/assistant-contracts";
import {
  mergeActivityEntries,
  projectActivityEntries,
} from "@/features/assistant/chat/conversationActivityEntries";
import { buildConversationRows } from "@/features/assistant/chat/conversationRows";
import { deriveTimelineEntries } from "@/features/assistant/chat/session-logic";
import { deriveWorkLogEntries } from "@/features/assistant/chat/workLogDerivations";
const turnId = TurnId.makeUnsafe("turn");
function activity(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
  second: number,
): OrchestrationThreadActivity {
  return {
    id: EventId.makeUnsafe(id),
    kind,
    payload,
    turnId,
    tone: "info",
    summary: kind,
    createdAt: `2026-09-05T00:00:0${second}Z`,
  };
}
describe("native activity timeline integration", () => {
  it("removes collapsed owned tools from actual work projection but retains unattributed tools", () => {
    const events = [
      activity("spawn", "task.started", { taskId: "child", agentKind: "agent" }, 0),
      activity(
        "read-start",
        "tool.started",
        { agentId: "child", toolCallId: "read", title: "Read", status: "running" },
        1,
      ),
      activity(
        "read-end",
        "tool.completed",
        { agentId: "child", toolCallId: "read", title: "Read", status: "failed" },
        2,
      ),
      activity(
        "parent-read",
        "tool.completed",
        { toolCallId: "parent-read", title: "Read", status: "completed" },
        3,
      ),
    ];
    const state = projectActivityEntries(events);
    const merged = mergeActivityEntries(
      deriveTimelineEntries([], [], deriveWorkLogEntries(events, undefined)),
      state,
    );
    expect(merged.map((entry) => entry.id)).toEqual(["provider-task:child", "parent-read"]);
    expect(state.tasks.get("provider-task:child")?.activities).toHaveLength(3);
  });
  it("re-homes owner tools and background work without hiding nested agent anchors or orphans", () => {
    const events = [
      activity("owner", "task.started", { taskId: "owner", agentKind: "agent" }, 0),
      activity(
        "nested",
        "task.started",
        { taskId: "nested", agentId: "owner", agentKind: "agent", timelineBypass: true },
        1,
      ),
      activity("child-read", "tool.completed", { agentId: "nested", status: "failed" }, 2),
      activity(
        "shell",
        "task.started",
        { taskId: "shell", agentId: "owner", agentKind: "background" },
        3,
      ),
      activity("orphan", "tool.completed", { agentId: "missing", status: "declined" }, 4),
      activity("bypass", "tool.completed", { timelineBypass: true, status: "stopped" }, 5),
      activity("parent", "tool.completed", { status: "completed" }, 6),
    ];
    const state = projectActivityEntries(events);
    const merged = mergeActivityEntries(
      events.map((event) => ({
        kind: "work" as const,
        id: event.id,
        createdAt: event.createdAt,
        entry: {
          id: event.id,
          createdAt: event.createdAt,
          label: event.summary,
          tone: "info" as const,
          sourceActivityKind: event.kind,
        },
      })),
      state,
    );
    expect(
      merged
        .filter((entry) => events.some((event) => event.id === entry.id))
        .map((entry) => entry.id),
    ).toEqual(["parent"]);
    expect(state.tasks.get("provider-task:nested")?.activities?.map((event) => event.id)).toContain(
      "child-read",
    );
    expect(state.tasks.get("provider-task:owner")?.activities?.map((event) => event.id)).toContain(
      "shell",
    );
    expect(state.entries.some((entry) => entry.id === "provider-task:nested")).toBe(true);
    expect(state.entries.some((entry) => entry.id === "provider-task:shell")).toBe(false);
    expect(
      [...state.tasks.values()].flatMap((task) => task.activities ?? []).map((event) => event.id),
    ).toEqual(expect.arrayContaining(["orphan", "bypass"]));
  });
  it("shows a task immediately on task.started and updates one anchored row", () => {
    const start = activity(
      "start",
      "task.started",
      { taskId: "task", title: "Inspect code", status: "running", agentId: "child" },
      0,
    );
    const finish = activity(
      "finish",
      "task.progress",
      { taskId: "task", status: "completed", summary: "Done" },
      5,
    );
    const first = projectActivityEntries([start]);
    const next = projectActivityEntries([start, finish]);
    expect(first.entries).toHaveLength(1);
    expect(next.entries[0]?.id).toBe(first.entries[0]?.id);
    expect(next.entries[0]?.createdAt).toBe(start.createdAt);
    expect(next.tasks.get("provider-task:task")).toMatchObject({
      status: "completed",
      agentId: "child",
    });
    const rows = buildConversationRows({
      entries: mergeActivityEntries([], next),
      activity: next,
      isWorking: false,
      latestTurn: {
        turnId,
        state: "completed",
        startedAt: start.createdAt,
        completedAt: finish.createdAt,
      },
      activeWorkStartedAt: null,
      generationStatusPhase: "working",
      expanded: {},
    });
    expect(rows.map((row) => row.kind)).toEqual(["provider-task"]);
  });
  it("keeps step-plan updates in one row and removes duplicate raw activity", () => {
    const start = activity(
      "plan-start",
      "turn.plan.updated",
      { plan: [{ step: "Read", status: "pending" }] },
      0,
    );
    const finish = activity(
      "plan-end",
      "turn.plan.updated",
      { plan: [{ step: "Read", status: "completed" }] },
      4,
    );
    const state = projectActivityEntries([start, finish]);
    const entries = mergeActivityEntries(
      [
        {
          kind: "work",
          id: "plan-end",
          createdAt: finish.createdAt,
          entry: {
            id: "plan-end",
            createdAt: finish.createdAt,
            turnId,
            sourceActivityKind: "turn.plan.updated",
            tone: "info",
            label: "Plan",
          },
        },
      ],
      state,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.createdAt).toBe(start.createdAt);
    expect(state.plans.get("provider-plan:turn")?.steps[0]?.status).toBe("completed");
    const rows = buildConversationRows({
      entries,
      activity: state,
      isWorking: true,
      runningTurnId: turnId,
      activeWorkStartedAt: start.createdAt,
      generationStatusPhase: "working",
      expanded: {},
    });
    expect(rows[0]?.kind).toBe("provider-plan");
    expect(rows.some((row) => row.kind === "work-toggle")).toBe(false);
  });
  it("does not fabricate reasoning prose or tool use from reasoning markers", () => {
    const state = projectActivityEntries([
      activity("reason", "reasoning.started", { streamKind: "reasoning" }, 0),
    ]);
    expect(state.entries).toEqual([]);
    expect(state.tasks.size).toBe(0);
  });
});
