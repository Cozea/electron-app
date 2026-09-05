import { describe, expect, it } from "vitest";
import type { OrchestrationEvent, OrchestrationReadModel } from "@cozea/assistant-contracts";
import { projectOrchestrationReadModelEvent } from "../../apps/desktop/src/features/assistant/model/orchestrationReadModelProjector";

const at = "2026-09-05T08:00:00.000Z";
const initial = () =>
  ({
    snapshotSequence: 0,
    updatedAt: at,
    projects: [],
    threads: [
      {
        id: "thread",
        projectId: "project",
        title: "Keep title",
        modelSelection: { provider: "codex", model: "test" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: "/fixture",
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        latestTurn: null,
        messages: [],
        activities: [],
        proposedPlans: [],
        checkpoints: [],
        session: null,
      },
    ],
  }) as unknown as OrchestrationReadModel;
function apply(model: OrchestrationReadModel, type: string, payload: unknown) {
  return projectOrchestrationReadModelEvent(model, {
    type,
    sequence: model.snapshotSequence + 1,
    occurredAt: at,
    payload: { threadId: "thread", ...(payload as object) },
  } as OrchestrationEvent);
}
const session = (status: string, activeTurnId: string | null = null) => ({
  session: {
    threadId: "thread",
    status,
    activeTurnId,
    providerName: "codex",
    runtimeMode: "full-access",
    lastError: null,
    updatedAt: at,
  },
});
const message = (turnId = "turn", streaming = true) => ({
  messageId: `${turnId}-message`,
  role: "assistant",
  text: "Hello",
  turnId,
  streaming,
  createdAt: at,
  updatedAt: at,
});
const checkpoint = (turnId = "turn") => ({
  turnId,
  checkpointTurnCount: 1,
  checkpointRef: "ref",
  status: "ready",
  files: [],
  assistantMessageId: `${turnId}-message`,
  completedAt: at,
});

describe("legacy read-model detail authority", () => {
  it("keeps completed commentary inside its running session", () => {
    let model = apply(initial(), "thread.session-set", session("running", "turn"));
    model = apply(model, "thread.message-sent", message("turn", false));
    expect(model.threads[0]!.latestTurn).toMatchObject({ state: "running", completedAt: null });
    expect(model.threads[0]!.messages[0]!.streaming).toBe(false);
  });

  it("does not replace a newer running turn with an old completion or checkpoint", () => {
    let model = apply(initial(), "thread.session-set", session("running", "old"));
    model = apply(model, "thread.message-sent", message("old"));
    model = apply(model, "thread.session-set", session("running", "new"));
    const latest = model.threads[0]!.latestTurn;
    model = apply(model, "thread.message-sent", message("old", false));
    model = apply(model, "thread.turn-diff-completed", checkpoint("old"));
    expect(model.threads[0]!.latestTurn).toBe(latest);
    expect(model.threads[0]!.checkpoints).toHaveLength(1);
  });

  it.each(["error", "stopped", "ready", "interrupted"])(
    "settles %s without a final flush and retains late text",
    (status) => {
      let model = apply(initial(), "thread.session-set", session("running", "turn"));
      model = apply(model, "thread.message-sent", message());
      model = apply(model, "thread.session-set", session(status));
      expect(model.threads[0]!.messages[0]!.streaming).toBe(false);
      const terminal = model.threads[0]!.latestTurn;
      model = apply(model, "thread.message-sent", { ...message(), text: " late" });
      expect(model.threads[0]!.latestTurn).toBe(terminal);
      expect(model.threads[0]!.messages[0]).toMatchObject({ text: "Hello late", streaming: false });
    },
  );

  it("records a checkpoint during a running turn without completing it", () => {
    let model = apply(initial(), "thread.session-set", session("running", "turn"));
    const latest = model.threads[0]!.latestTurn;
    model = apply(model, "thread.turn-diff-completed", checkpoint());
    expect(model.threads[0]!.latestTurn).toBe(latest);
    expect(model.threads[0]!.checkpoints).toHaveLength(1);
  });

  it.each(["thread.session-stop-requested", "thread.turn-interrupt-requested"])(
    "handles legacy %s without a final message",
    (type) => {
      let model = apply(initial(), "thread.session-set", session("running", "turn"));
      model = apply(model, "thread.message-sent", message());
      model = apply(model, type, { createdAt: at });
      expect(model.threads[0]!.latestTurn?.state).toBe("interrupted");
      expect(model.threads[0]!.messages[0]!.streaming).toBe(false);
      model = apply(model, "thread.message-sent", { ...message(), text: " late" });
      expect(model.threads[0]!.latestTurn?.state).toBe("interrupted");
      expect(model.threads[0]!.messages[0]).toMatchObject({ text: "Hello late", streaming: false });
    },
  );

  it("preserves project/shell metadata and unaffected thread/message references", () => {
    let model = apply(initial(), "thread.session-set", session("running", "turn"));
    model = apply(model, "thread.message-sent", {
      ...message(),
      messageId: "first",
      streaming: false,
    });
    const original = model.threads[0]!;
    model = { ...model, threads: [original, { ...original, id: "other" as typeof original.id }] };
    const other = model.threads[1];
    const projects = model.projects;
    model = apply(model, "thread.message-sent", message());
    const updated = model.threads[0]!;
    expect(updated).toMatchObject({
      title: original.title,
      branch: original.branch,
      worktreePath: original.worktreePath,
      projectId: original.projectId,
      runtimeMode: original.runtimeMode,
      interactionMode: original.interactionMode,
    });
    expect(updated.modelSelection).toBe(original.modelSelection);
    expect(updated.messages[0]).toBe(original.messages[0]);
    expect(updated.activities).toBe(original.activities);
    expect(updated.session).toBe(original.session);
    expect(model.threads[1]).toBe(other);
    expect(model.projects).toBe(projects);
  });

  it("shares plan and revert semantics while retaining unbound messages", () => {
    let model = apply(initial(), "thread.message-sent", {
      ...message(),
      messageId: "user",
      role: "user",
      turnId: null,
      streaming: false,
    });
    model = apply(model, "thread.message-sent", message());
    const plan = {
      id: "plan",
      turnId: "turn",
      planMarkdown: "first",
      implementedAt: null,
      implementationThreadId: null,
      createdAt: at,
      updatedAt: at,
    };
    model = apply(model, "thread.proposed-plan-upserted", { proposedPlan: plan });
    model = apply(model, "thread.proposed-plan-upserted", {
      proposedPlan: { ...plan, planMarkdown: "revised" },
    });
    expect(model.threads[0]!.proposedPlans.map((entry) => entry.planMarkdown)).toEqual(["revised"]);
    model = apply(model, "thread.reverted", { turnCount: 0 });
    expect(model.threads[0]!.messages.map((entry) => entry.id)).toEqual(["user"]);
    expect(model.threads[0]!.proposedPlans).toHaveLength(0);
  });
});
