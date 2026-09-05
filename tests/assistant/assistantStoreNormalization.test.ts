import { describe, expect, it } from "vitest"

import {
  applyOrchestrationDomainEventsToState,
  createAssistantThreadSelectorById,
  selectAssistantThreadById,
  syncServerReadModel,
  type AppState,
} from "@/features/assistant/model/assistantStore"
import { createEmptyOrchestrationReadModel } from "@/features/assistant/model/orchestrationReadModelProjector"

import type { OrchestrationShellSnapshot } from "@cozea/contracts/t3"
import { mergeT3ShellSnapshot } from "@/features/assistant/model/t3ShellSnapshot"

const NOW = "2026-04-25T00:00:00.000Z"

it("preserves native file and unsupported attachment variants in legacy snapshots", () => {
  const model = createReadModel();
  model.threads[0].messages[0].attachments = [
    { type: "file", id: "pdf", name: "notes.pdf", mimeType: "application/pdf", sizeBytes: 1 },
    { type: "audio", id: "audio", name: "voice", mimeType: "audio/wav", sizeBytes: 1 },
  ];
  const state = syncServerReadModel(createBaseState(), model);
  const thread = selectAssistantThreadById(state, "thread-1");
  expect(thread?.messages[0]?.attachments).toMatchObject([
    { type: "file", name: "notes.pdf" },
    { type: "unsupported", originalType: "audio" },
  ]);
});

function createBaseState(): AppState {
  return {
    projects: [],
    threads: [],
    projectIds: [],
    projectById: {},
    projectIdByCwd: {},
    threadIds: [],
    threadIdsByProjectId: {},
    threadShellById: {},
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
    threadsHydrated: false,
    orchestrationReadModel: createEmptyOrchestrationReadModel(NOW),
  } as AppState
}

function createReadModel() {
  return {
    snapshotSequence: 1,
    updatedAt: NOW,
    projects: [
      {
        id: "project-1",
        title: "Project",
        workspaceRoot: "/repo/project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: "thread-1",
        projectId: "project-1",
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
        messages: [
          {
            id: "message-user-1",
            role: "user",
            text: "hello",
            turnId: null,
            streaming: false,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
  } as any
}

function event(type: string, payload: unknown, sequence = 2) {
  return {
    sequence,
    eventId: `event-${sequence}`,
    type,
    aggregateKind: type.startsWith("project.") ? "project" : "thread",
    aggregateId:
      type.startsWith("project.") && typeof payload === "object" && payload
        ? (payload as { projectId?: string }).projectId
        : (payload as { threadId?: string }).threadId,
    occurredAt: NOW,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload,
  } as any
}

describe("assistant store normalization", () => {
  it.each(["interrupted", "error"] as const)(
    "keeps a %s turn terminal when its checkpoint arrives",
    (status) => {
      const state = syncServerReadModel(createBaseState(), createReadModel());
      const session = {
        threadId: "thread-1",
        providerName: "codex",
        runtimeMode: "full-access",
        lastError: status === "error" ? "Provider failed" : null,
        updatedAt: NOW,
      };
      const settled = applyOrchestrationDomainEventsToState(state, [
        event(
          "thread.session-set",
          {
            threadId: "thread-1",
            session: { ...session, status: "running", activeTurnId: "turn-1" },
          },
          2,
        ),
        event(
          "thread.session-set",
          {
            threadId: "thread-1",
            session: { ...session, status, activeTurnId: null },
          },
          3,
        ),
      ]);
      expect(selectAssistantThreadById(settled, "thread-1")?.latestTurn?.state).toBe(status);
      const next = applyOrchestrationDomainEventsToState(settled, [
        event(
          "thread.turn-diff-completed",
          {
            threadId: "thread-1",
            turnId: "turn-1",
            checkpointTurnCount: 1,
            checkpointRef: "refs/cozea/qa/checkpoint",
            status: "ready",
            files: [],
            assistantMessageId: null,
            completedAt: NOW,
          },
          4,
        ),
      ]);
      expect(selectAssistantThreadById(next, "thread-1")?.latestTurn?.state).toBe(status);
    },
  );


  it("keeps message and activity slices stable when only session state changes", () => {
    const state = syncServerReadModel(createBaseState(), createReadModel())
    const before = selectAssistantThreadById(state, "thread-1")

    const next = applyOrchestrationDomainEventsToState(state, [
      event("thread.session-set", {
        threadId: "thread-1",
        session: {
          threadId: "thread-1",
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: "turn-1",
          lastError: null,
          updatedAt: NOW,
        },
      }),
    ])
    const after = selectAssistantThreadById(next, "thread-1")

    expect(after).not.toBe(before)
    expect(after?.session?.status).toBe("running")
    expect(after?.messages).toBe(before?.messages)
    expect(after?.activities).toBe(before?.activities)
  })

  it("returns the same selected thread when an unrelated project event is projected", () => {
    const selector = createAssistantThreadSelectorById("thread-1")
    const state = syncServerReadModel(createBaseState(), createReadModel())
    const before = selector(state)

    const next = applyOrchestrationDomainEventsToState(state, [
      event("project.meta-updated", {
        projectId: "project-1",
        title: "Renamed project",
        updatedAt: NOW,
      }),
    ])

    expect(selector(next)).toBe(before)
    expect(next.threadIds).toBe(state.threadIds)
    expect(next.threadShellById).toBe(state.threadShellById)
  })

  it("only swaps the message slice when a message event is projected", () => {
    const state = syncServerReadModel(createBaseState(), createReadModel())
    const before = selectAssistantThreadById(state, "thread-1")

    const next = applyOrchestrationDomainEventsToState(state, [
      event("thread.message-sent", {
        threadId: "thread-1",
        messageId: "message-assistant-1",
        role: "assistant",
        text: "hi",
        turnId: "turn-1",
        streaming: false,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ])
    const after = selectAssistantThreadById(next, "thread-1")

    expect(after?.messages).not.toBe(before?.messages)
    expect(after?.messages).toHaveLength(2)
    expect(after?.activities).toBe(before?.activities)
    expect(after?.proposedPlans).toBe(before?.proposedPlans)
  })
})


describe("T3 shell metadata hydration", () => {
  it("settles a completed session without discarding cached transcript slices", () => {
    const previous = createReadModel();
    const thread = previous.threads[0]!;
    const snapshot = {
      snapshotSequence: 45, updatedAt: NOW, projects: previous.projects,
      threads: [{ ...thread, messages: undefined, activities: undefined, proposedPlans: undefined, checkpoints: undefined,
        session: { threadId: thread.id, status: "ready", providerName: "codex", runtimeMode: "full-access", activeTurnId: null, lastError: null, updatedAt: NOW },
        latestTurn: { turnId: "turn-qa", state: "completed", requestedAt: NOW, startedAt: NOW, completedAt: NOW, assistantMessageId: null },
      }],
    } as unknown as OrchestrationShellSnapshot;
    const merged = mergeT3ShellSnapshot(previous, snapshot);
    expect(merged.threads[0]?.messages).toBe(thread.messages);
    expect(merged.threads[0]?.activities).toBe(thread.activities);
    const state = syncServerReadModel(createBaseState(), merged);
    expect(selectAssistantThreadById(state, thread.id)?.session?.orchestrationStatus).toBe("ready");
    expect(merged.threads[0]?.latestTurn?.state).toBe("completed");
    expect(mergeT3ShellSnapshot(merged, { ...snapshot, threads: [] }).threads).toEqual([]);
  });
});
