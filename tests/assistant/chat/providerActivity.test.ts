import { expect, it } from "vitest";
import { TurnId } from "@cozea/assistant-contracts";
import { deriveProviderActivityState, groupOwnedActivity } from "@/features/assistant/chat/providerActivity";
import { isInternalActivity } from "@/features/assistant/chat/activityOwnership";
import { makeActivity } from "./activityFixture";

const turnId = TurnId.makeUnsafe("turn");
it("shares native internal attribution rules without hiding blank or malformed owners", () => {
  for (const payload of [{ agentId: "child" }, { agentId: " child " }, { timelineBypass: true }]) {
    expect(isInternalActivity(makeActivity({ sequence: 1, payload }))).toBe(true);
  }
  for (const payload of [{}, { agentId: " " }, { agentId: 12 }, { timelineBypass: "true" }]) {
    expect(isInternalActivity(makeActivity({ sequence: 1, payload }))).toBe(false);
  }
});

it("groups a long owned lifecycle without mutating input or prior projected arrays", () => {
  const events = Object.freeze(Array.from({ length: 1000 }, (_, index) => makeActivity({
    sequence: index, kind: index === 999 ? "tool.completed" : "tool.progress",
    payload: { toolCallId: "one", status: index === 999 ? "failed" : "running" },
  })));
  const first = groupOwnedActivity(events.slice(0, 10));
  const full = groupOwnedActivity(events);
  expect(first[0]?.events).toHaveLength(10);
  expect(full).toHaveLength(1);
  expect(full[0]?.events).toEqual(events);
  expect(full[0]?.latest).toBe(events[999]);
  expect(full[0]?.events).not.toBe(events);
});
it("keeps the spawn turn when completion arrives on a later synthetic turn", () => {
  const state = deriveProviderActivityState([
    makeActivity({
      sequence: 1,
      turnId,
      kind: "task.started",
      payload: { taskId: "agent", agentKind: "agent" },
    }),
    makeActivity({
      sequence: 2,
      turnId: TurnId.makeUnsafe("synthetic"),
      kind: "task.completed",
      payload: { taskId: "agent", status: "completed" },
    }),
  ]);
  expect(state.tasks[0]).toMatchObject({ turnId, status: "completed" });
});
it("keeps native task identity, parent ownership, background state and final outcome across sparse updates", () => {
  const activities = [
    makeActivity({
      sequence: 1,
      turnId,
      kind: "task.started",
      payload: {
        taskId: "child",
        title: "Review",
        agentId: "agent",
        parentAgentId: "parent",
        agentKind: "agent",
        toolUseId: "call",
        model: "native-model",
      },
    }),
    makeActivity({
      sequence: 2,
      turnId,
      kind: "task.updated",
      payload: { taskId: "child", isBackgrounded: true },
    }),
    makeActivity({
      sequence: 3,
      turnId,
      kind: "task.completed",
      payload: { taskId: "child", status: "failed", summary: "Permission denied" },
    }),
    makeActivity({
      sequence: 4,
      turnId,
      kind: "task.progress",
      payload: { taskId: "child", usageSnapshot: true, typedUsage: { totalTokens: 12 } },
    }),
  ];
  expect(deriveProviderActivityState(activities, turnId)).toMatchObject({
    reasoningActive: false,
    tasks: [
      {
        taskId: "child",
        title: "Review",
        agentId: "agent",
        parentAgentId: "parent",
        toolUseId: "call",
        status: "failed",
        isBackgrounded: true,
        detail: "Permission denied",
        payload: { typedUsage: { totalTokens: 12 } },
      },
    ],
  });
});
it("uses explicit reasoning markers and scopes tasks and reasoning to their native turn", () => {
  const activities = [
    makeActivity({
      sequence: 1,
      turnId,
      kind: "task.progress",
      summary: "Reasoning update",
      payload: { taskId: "background", agentKind: "background" },
    }),
    makeActivity({ sequence: 2, turnId, kind: "reasoning.started" }),
    makeActivity({ sequence: 3, turnId: TurnId.makeUnsafe("other"), kind: "reasoning.completed" }),
  ];
  expect(deriveProviderActivityState(activities.slice(0, 1), turnId).reasoningActive).toBe(false);
  expect(deriveProviderActivityState(activities, turnId).reasoningActive).toBe(true);
  expect(
    deriveProviderActivityState(
      [...activities, makeActivity({ sequence: 4, turnId, kind: "reasoning.completed" })],
      turnId,
    ).reasoningActive,
  ).toBe(false);
});
it("projects native runtime plan steps without turning them into tool actions", () => {
  const state = deriveProviderActivityState(
    [
      makeActivity({
        turnId,
        kind: "turn.plan.updated",
        payload: {
          explanation: "Review before editing",
          plan: [
            { step: "Inspect", status: "completed" },
            { step: "Fix", status: "inProgress" },
          ],
        },
      }),
    ],
    turnId,
  );
  expect(state.tasks).toEqual([]);
  expect(state.plan?.steps).toEqual([
    { step: "Inspect", status: "completed" },
    { step: "Fix", status: "inProgress" },
  ]);
});
