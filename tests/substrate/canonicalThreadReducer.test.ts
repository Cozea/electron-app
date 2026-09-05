import { describe, expect, it } from "vitest";
import type { OrchestrationEvent, OrchestrationThread } from "@cozea/contracts/t3";
import {
  applyThreadDetailEvent,
  type ThreadDetailState,
} from "../../packages/client-runtime/src/state/threadReducer";

// Deliberately minimal pure-state fixture: no runtime, credentials or provider calls.
const initial = {
  id: "thread",
  messages: [],
  activities: [],
  checkpoints: [],
  proposedPlans: [],
  session: null,
  latestTurn: null,
} as unknown as OrchestrationThread;
const at = "2026-09-05T08:00:00.000Z";
function apply(thread: ThreadDetailState, type: string, payload: unknown) {
  const result = applyThreadDetailEvent(thread, {
    type,
    payload,
    occurredAt: at,
  } as OrchestrationEvent);
  expect(result.kind).toBe("updated");
  if (result.kind !== "updated") throw new Error("Expected updated thread");
  return result.thread;
}

describe("canonical pinned reducer", () => {
  it("updates plans and applies zero revert without losing unbound plans", () => {
    const plan = {
      id: "plan",
      turnId: "turn",
      planMarkdown: "first",
      createdAt: at,
      updatedAt: at,
    };
    let thread = apply(initial, "thread.proposed-plan-upserted", { proposedPlan: plan });
    thread = apply(thread, "thread.proposed-plan-upserted", {
      proposedPlan: { ...plan, planMarkdown: "revised" },
    });
    expect(thread.proposedPlans.map((p) => p.planMarkdown)).toEqual(["revised"]);
    thread = apply(thread, "thread.proposed-plan-upserted", {
      proposedPlan: { ...plan, id: "unbound", turnId: null },
    });
    thread = apply(thread, "thread.reverted", { turnCount: 0 });
    expect(thread.proposedPlans.map((p) => p.id)).toEqual(["unbound"]);
  });

  it("keeps a running turn open across completed commentary and preserves unrelated arrays", () => {
    let thread = apply(initial, "thread.session-set", {
      session: { status: "running", activeTurnId: "turn", updatedAt: at },
    });
    const activities = thread.activities;
    thread = apply(thread, "thread.message-sent", {
      messageId: "commentary",
      role: "assistant",
      text: "Checking",
      turnId: "turn",
      streaming: false,
      createdAt: at,
      updatedAt: at,
    });
    expect(thread.latestTurn?.state).toBe("running");
    expect(thread.latestTurn?.completedAt).toBeNull();
    expect(thread.activities).toBe(activities);
    thread = apply(thread, "thread.session-set", {
      session: { status: "ready", activeTurnId: null, updatedAt: at },
    });
    expect(thread.latestTurn?.state).toBe("completed");
  });

  it.each(["interrupted", "error", "ready", "stopped"])(
    "retains late text after %s without reviving the turn",
    (status) => {
      let thread = apply(initial, "thread.session-set", {
        session: { status: "running", activeTurnId: "turn", updatedAt: at },
      });
      const payload = {
        messageId: "m",
        role: "assistant",
        text: "First",
        turnId: "turn",
        streaming: true,
        createdAt: at,
        updatedAt: at,
      };
      thread = apply(thread, "thread.message-sent", payload);
      thread = apply(thread, "thread.session-set", {
        session: { status, activeTurnId: null, updatedAt: at },
      });
      const terminal = thread.latestTurn;
      expect(thread.messages[0]).toMatchObject({ text: "First", streaming: false, updatedAt: at });
      thread = apply(thread, "thread.message-sent", { ...payload, text: " late" });
      expect(thread.latestTurn).toBe(terminal);
      expect(thread.messages[0]).toMatchObject({ text: "First late", streaming: false });
    },
  );

  it("keeps newer running turn identity when an older message receives a late delta", () => {
    let thread = apply(initial, "thread.session-set", {
      session: { status: "running", activeTurnId: "old", updatedAt: at },
    });
    const payload = {
      messageId: "old-message",
      role: "assistant",
      text: "Old",
      turnId: "old",
      streaming: true,
      createdAt: at,
      updatedAt: at,
    };
    thread = apply(thread, "thread.message-sent", payload);
    thread = apply(thread, "thread.session-set", {
      session: { status: "running", activeTurnId: "new", updatedAt: at },
    });
    const active = thread.latestTurn;
    thread = apply(thread, "thread.message-sent", { ...payload, text: " tail" });
    expect(thread.latestTurn).toBe(active);
    expect(thread.latestTurn).toMatchObject({ turnId: "new", state: "running" });
    expect(thread.messages[0]).toMatchObject({ text: "Old tail", streaming: false });
  });

  it("settles the turn on stop request and preserves interruption through late checkpoint", () => {
    let thread = apply(initial, "thread.session-set", {
      session: { status: "running", activeTurnId: "turn", updatedAt: at },
    });
    thread = apply(thread, "thread.session-stop-requested", { createdAt: at });
    expect(thread.latestTurn?.state).toBe("interrupted");
    thread = apply(thread, "thread.turn-diff-completed", {
      turnId: "turn",
      status: "ready",
      completedAt: at,
      files: [],
    });
    expect(thread.latestTurn?.state).toBe("interrupted");
  });

  it("binds a late final message while preserving the terminal turn outcome and timing", () => {
    let thread = apply(initial, "thread.session-set", {
      session: { status: "running", activeTurnId: "turn", updatedAt: at },
    });
    thread = apply(thread, "thread.session-set", {
      session: { status: "ready", activeTurnId: null, updatedAt: at },
    });
    thread = apply(thread, "thread.message-sent", {
      messageId: "final",
      role: "assistant",
      text: "Done",
      turnId: "turn",
      streaming: false,
      createdAt: at,
      updatedAt: "2026-09-05T08:00:02.000Z",
    });
    expect(thread.latestTurn).toMatchObject({
      state: "completed",
      completedAt: at,
      assistantMessageId: "final",
    });
  });
});
