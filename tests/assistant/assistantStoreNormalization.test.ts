import { describe, expect, it } from "vitest"

import {
  applyOrchestrationDomainEventsToState,
  createAssistantThreadSelectorById,
  selectAssistantThreadById,
  syncServerReadModel,
  type AppState,
} from "@/stores/assistant-store"
import { createEmptyOrchestrationReadModel } from "@/stores/orchestrationReadModelProjector"

const NOW = "2026-04-25T00:00:00.000Z"

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
    expect(next.threads).toBe(state.threads)
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
