import { expect, it } from "vitest";
import { TurnId } from "@cozea/assistant-contracts";
import { deriveProviderActivityState } from "@/features/assistant/chat/providerActivity";
import { makeActivity } from "./activityFixture";

const turnId = TurnId.makeUnsafe("turn");
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
