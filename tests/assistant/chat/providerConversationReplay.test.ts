import { beforeEach, expect, it } from "vitest";
import { TurnId, type OrchestrationEvent } from "@cozea/assistant-contracts";
import { useThreadDetailStore } from "@/features/assistant/model/threadDetailStore";
import {
  deriveTimelineEntries,
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@/features/assistant/chat/session-logic";
import { deriveWorkLogEntries } from "@/features/assistant/chat/workLogDerivations";
import { deriveGenerationStatusPhase } from "@/features/assistant/chat/MessagesTimeline.logic";
import {
  projectActivityEntries,
  mergeActivityEntries,
} from "@/features/assistant/chat/conversationActivityEntries";
import {
  buildConversationRows,
  type ConversationRow,
} from "@/features/assistant/chat/conversationRows";
import { buildPendingUserInputAnswers } from "@/features/assistant/pendingUserInput";
import { makeActivity } from "./activityFixture";

// These are normalized-boundary fixtures, NOT live adapter qualification.
// Each scenario below cites a provider-specific pinned adapter mapping.
beforeEach(() => useThreadDetailStore.setState({ byThreadId: {}, deletedSequenceByThreadId: {} }));
function replay(provider: string) {
  const thread = "replay-" + provider,
    turn = TurnId.makeUnsafe(provider + "-turn");
  let sequence = 0;
  const now = () => new Date(Date.UTC(2026, 8, 5, 0, 0, sequence)).toISOString();
  const detail = () => useThreadDetailStore.getState().getThreadDetail(thread)!;
  const emit = (type: string, payload: Record<string, unknown>) => {
    sequence++;
    useThreadDetailStore
      .getState()
      .applyEvent(thread, { type, payload, sequence, occurredAt: now() } as OrchestrationEvent);
  };
  const session = (status: string, activeTurnId: string | null = turn) =>
    emit("thread.session-set", {
      session: { status, activeTurnId, providerName: provider, updatedAt: now() },
    });
  const text = (
    id: string,
    value: string,
    streaming: boolean,
    turnId = turn,
    attachments?: unknown[],
  ) =>
    emit("thread.message-sent", {
      messageId: id,
      role: "assistant",
      turnId,
      text: value,
      streaming,
      createdAt: now(),
      updatedAt: now(),
      ...(attachments ? { attachments } : {}),
    });
  const activity = (
    kind: string,
    payload: Record<string, unknown>,
    tone: "info" | "tool" | "error" = "info",
  ) =>
    emit("thread.activity-appended", {
      activity: makeActivity({
        id: provider + "-activity-" + sequence,
        turnId: turn,
        kind,
        payload,
        tone,
        sequence,
        createdAt: now(),
      }),
    });
  const rows = () => {
    const d = detail(),
      activity = projectActivityEntries(d.activities);
    return buildConversationRows({
      entries: mergeActivityEntries(
        deriveTimelineEntries(
          d.messages,
          d.proposedPlans,
          deriveWorkLogEntries(d.activities, undefined),
        ),
        activity,
      ),
      activity,
      latestTurn: d.canonical.latestTurn,
      runningTurnId:
        d.canonical.session?.status === "running" ? d.canonical.session.activeTurnId : null,
      isWorking: d.isStreaming,
      activeWorkStartedAt: null,
      generationStatusPhase: deriveGenerationStatusPhase(
        d.activities,
        d.canonical.latestTurn?.turnId,
      ),
      expanded: {},
    });
  };
  const parity = () => {
    const live = rows(),
      snapshot = detail().canonical;
    useThreadDetailStore
      .getState()
      .ingestSnapshot(thread, { snapshotSequence: sequence, thread: snapshot });
    expect(rows()).toEqual(live);
    expect(detail().loaded).toBe(true);
    return live;
  };
  session("running");
  return { turn, detail, emit, session, text, activity, rows, parity };
}
function flatten(rows: ConversationRow[]): ConversationRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn-fold" || row.kind === "turn-fold-content"
      ? [row, ...flatten(row.children)]
      : [row],
  );
}
function assertOneFooter(rows: ConversationRow[], id: string) {
  const actions = flatten(rows).filter(
    (row) => row.kind === "assistant-meta" || (row.kind === "message" && row.showActions),
  );
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ message: { id } });
}

it("Codex normalized command + reasoning markers + native question ID replay preserves final text and attachments", () => {
  // CodexAdapter.ts toUserInputQuestions (~852): native id, label options,
  // multiSelect:false. ProviderRuntimeIngestion item.* (~900) stamps toolCallId.
  const r = replay("codex");
  r.text("commentary", "Inspecting", false);
  r.activity(
    "tool.updated",
    {
      itemType: "command_execution",
      toolCallId: "codex-exec-1",
      title: "Command",
      detail: "pwd",
      status: "inProgress",
    },
    "tool",
  );
  r.activity("reasoning.started", { provider: "codex", streamKind: "reasoning_summary_text" });
  expect(r.rows().at(-1)?.kind).toBe("thinking");
  r.activity("reasoning.completed", { provider: "codex" });
  r.activity("user-input.requested", {
    requestId: "codex-question",
    questions: [
      {
        id: "scope",
        header: "Scope",
        question: "Which scope?",
        options: [{ label: "Local", description: "Current project" }],
        multiSelect: false,
      },
    ],
  });
  const request = derivePendingUserInputs(r.detail().activities)[0]!;
  expect(
    buildPendingUserInputAnswers(request.questions, { scope: { selectedOptionValues: ["Local"] } }),
  ).toEqual({ scope: "Local" });
  r.activity("user-input.resolved", { requestId: "codex-question" });
  r.activity(
    "tool.completed",
    {
      itemType: "command_execution",
      toolCallId: "codex-exec-1",
      title: "Command",
      detail: "pwd",
      status: "completed",
    },
    "tool",
  );
  r.activity(
    "tool.completed",
    {
      itemType: "command_execution",
      toolCallId: "codex-exec-failed",
      title: "Command",
      detail: "false",
      status: "failed",
    },
    "tool",
  );
  // Attachments exercise the shared persisted message contract, not a claim that
  // every provider transports every attachment type natively.
  r.text("final", "Done 👩🏽‍💻", false, r.turn, [
    { type: "file", id: "report", name: "report.txt", mimeType: "text/plain", sizeBytes: 8 },
  ]);
  r.session("ready", null);
  expect(r.detail().messages.map((m) => m.text)).toEqual(["Inspecting", "Done 👩🏽‍💻"]);
  expect(r.detail().messages[1]?.attachments?.[0]?.type).toBe("file");
  expect(derivePendingUserInputs(r.detail().activities)).toEqual([]);
  expect(
    deriveWorkLogEntries(r.detail().activities, undefined).find(
      (entry) => entry.toolCallId === "codex-exec-failed",
    )?.toolLifecycleStatus,
  ).toBe("failed");
  assertOneFooter(r.parity(), "final");
});

it("Claude preserves question-text keys and child-agent ownership/model through failed task completion", () => {
  // ClaudeAdapter.ts ~4143 uses FULL question text as answer key. ~3502/3538
  // repeats agentId/parentAgentId/toolUseId/model across task lifecycle.
  const r = replay("claudeAgent");
  const question = "Which areas should change?";
  r.activity("user-input.requested", {
    requestId: "claude-ask",
    questions: [
      {
        id: question,
        header: "Areas",
        question,
        multiSelect: true,
        options: [
          { label: "Server", description: "" },
          { label: "UI", description: "" },
        ],
      },
    ],
  });
  const request = derivePendingUserInputs(r.detail().activities)[0]!;
  expect(
    buildPendingUserInputAnswers(request.questions, {
      [question]: { selectedOptionValues: ["Server", "UI"] },
    }),
  ).toEqual({ [question]: ["Server", "UI"] });
  r.activity("user-input.resolved", { requestId: "claude-ask" });
  r.activity("task.started", {
    taskId: "claude-task",
    agentKind: "agent",
    agentId: "child",
    parentAgentId: "parent",
    toolUseId: "Task-use",
    title: "Review",
    model: "provider-model",
    role: "reviewer",
  });
  r.activity(
    "task.completed",
    { taskId: "claude-task", status: "failed", summary: "Permission denied" },
    "error",
  );
  r.text("final", "The review failed.", false);
  r.session("ready", null);
  const rows = r.parity();
  expect(rows.find((row) => row.kind === "provider-task")).toMatchObject({
    task: {
      taskId: "claude-task",
      agentId: "child",
      parentAgentId: "parent",
      model: "provider-model",
      status: "failed",
    },
  });
  assertOneFooter(rows, "final");
});

it("OpenCode header-derived multi-question ID and reasoning part mapping survive replay and late old-turn text", () => {
  // OpenCodeAdapter.ts ~578 maps question.multiple; opencodeRuntime.ts:422
  // derives question-<index>-<normalized-header>. Reasoning parts map to reasoning_text.
  const r = replay("opencode");
  r.activity("user-input.requested", {
    requestId: "open-question",
    questions: [
      {
        id: "question-0-build-scope",
        header: "Build Scope",
        question: "Choose targets",
        multiSelect: true,
        options: [
          { label: "API", description: "" },
          { label: "Web", description: "" },
        ],
      },
    ],
  });
  expect(derivePendingUserInputs(r.detail().activities)[0]?.questions[0]?.id).toBe(
    "question-0-build-scope",
  );
  r.activity("user-input.resolved", { requestId: "open-question" });
  r.activity("reasoning.started", { provider: "opencode", streamKind: "reasoning_text" });
  expect(r.rows().at(-1)?.kind).toBe("thinking");
  r.text("old", "Old partial", true);
  r.session("interrupted", null);
  const next = TurnId.makeUnsafe("opencode-steered");
  r.session("running", next);
  r.text("old", " + late", true);
  expect(r.detail().messages[0]).toMatchObject({ text: "Old partial + late", streaming: false });
  expect(r.detail().canonical.latestTurn?.turnId).toBe(next);
  r.text("new-final", "Steered answer", false, next);
  r.session("ready", null);
  const rows = r.parity();
  expect(rows.some((row) => row.kind === "thinking")).toBe(false);
  expect(r.detail().messages.map((message) => message.text)).toEqual([
    "Old partial + late",
    "Steered answer",
  ]);
  expect(
    flatten(rows).filter(
      (row) =>
        (row.kind === "message" && row.showActions && row.message.id === "new-final") ||
        (row.kind === "assistant-meta" && row.message.id === "new-final"),
    ),
  ).toHaveLength(1);
});

it("Cursor ACP command approval and create-plan extension preserve exact request and proposed-plan data", () => {
  // CursorAdapter.test.ts ~763: tool-call-1, command_execution,
  // cat server/package.json, exec_command_approval. CursorAdapter.ts ~625
  // maps cursor/create_plan to native proposed plan output.
  const r = replay("cursor");
  r.activity("approval.requested", {
    requestId: "cursor-permission",
    requestType: "exec_command_approval",
    detail: "cat server/package.json",
  });
  expect(derivePendingApprovals(r.detail().activities)[0]).toMatchObject({
    requestId: "cursor-permission",
    requestKind: "command",
    detail: "cat server/package.json",
  });
  r.activity("approval.resolved", { requestId: "cursor-permission", decision: "decline" });
  r.activity(
    "tool.completed",
    {
      toolCallId: "tool-call-1",
      itemType: "command_execution",
      status: "declined",
      detail: "cat server/package.json",
    },
    "tool",
  );
  r.emit("thread.proposed-plan-upserted", {
    proposedPlan: {
      id: "cursor-plan",
      turnId: r.turn,
      planMarkdown: "# Plan\nInspect the package",
      createdAt: "2026-09-05T00:00:00Z",
      updatedAt: "2026-09-05T00:00:00Z",
      implementedAt: null,
      implementationThreadId: null,
    },
  });
  // Cursor's shared ACP adapter also forwards normalized runtime plan steps
  // through its onPlanUpdated callback (CursorAdapter.ts ~425).
  r.activity("turn.plan.updated", {
    plan: [{ step: "Inspect package", status: "completed" }],
    explanation: "Native runtime plan",
  });
  r.text("final", "Command declined.", false);
  r.session("ready", null);
  expect(
    deriveWorkLogEntries(r.detail().activities, undefined).find(
      (entry) => entry.toolCallId === "tool-call-1",
    )?.toolLifecycleStatus,
  ).toBe("declined");
  const rows = r.parity();
  expect(rows.find((row) => row.kind === "proposed-plan")).toMatchObject({
    proposedPlan: { planMarkdown: "# Plan\nInspect the package" },
  });
  expect(flatten(rows).some((row) => row.kind === "provider-plan")).toBe(true);
  assertOneFooter(rows, "final");
});

it("optional Antigravity promotes local_bash background commands and retains stopped outcomes", () => {
  // AntigravityAdapter.ts ~978 promoteBackgroundCommands emits local_bash task
  // with original ACP toolUseId. Subagent batches separately use subagent_batch.
  const r = replay("antigravity");
  r.activity("task.started", {
    taskId: "bash-1",
    taskType: "local_bash",
    toolUseId: "bash-1",
    agentKind: "background",
    detail: "sleep 10",
  });
  r.activity("task.updated", { taskId: "bash-1", isBackgrounded: true });
  r.activity("task.completed", { taskId: "bash-1", status: "stopped" });
  r.activity(
    "tool.completed",
    { toolCallId: "bash-1", itemType: "command_execution", status: "stopped", detail: "sleep 10" },
    "tool",
  );
  r.text("final", "Stopped.", false);
  r.session("ready", null);
  const rows = r.parity();
  expect(rows.find((row) => row.kind === "provider-task")).toMatchObject({
    task: { status: "stopped" },
  });
  expect(rows.find((row) => row.kind === "provider-task")).toMatchObject({
    task: { toolUseId: "bash-1", isBackgrounded: true, payload: { taskType: "local_bash" } },
  });
  assertOneFooter(rows, "final");
});

it.skip("live provider qualification, Cursor native multiselect and Antigravity attachment transport are not verified by these normalized fixtures", () => {});
