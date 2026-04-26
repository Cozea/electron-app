// @ts-nocheck
import {
  CommandId,
  EventId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
} from "@cozea/assistant-contracts"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import {
  createEmptyReadModel,
  projectEvent,
} from "../../electron/assistant-runtime/orchestration/projector"
import {
  createEmptyOrchestrationReadModel,
  projectOrchestrationReadModelEvent,
} from "../../src/stores/orchestrationReadModelProjector"

function makeEvent(input: {
  sequence: number
  type: OrchestrationEvent["type"]
  occurredAt: string
  aggregateKind: OrchestrationEvent["aggregateKind"]
  aggregateId: string
  commandId: string | null
  payload: unknown
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.makeUnsafe(`parity-event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId:
      input.aggregateKind === "project"
        ? ProjectId.makeUnsafe(input.aggregateId)
        : ThreadId.makeUnsafe(input.aggregateId),
    occurredAt: input.occurredAt,
    commandId: input.commandId === null ? null : CommandId.makeUnsafe(input.commandId),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload as never,
  } as OrchestrationEvent
}

describe("orchestration projector parity", () => {
  it("keeps renderer and electron projectors aligned for project/thread creation", async () => {
    const now = "2026-01-01T00:00:00.000Z"
    const events = [
      makeEvent({
        sequence: 1,
        type: "project.created",
        aggregateKind: "project",
        aggregateId: "project-1",
        occurredAt: now,
        commandId: "cmd-project-create",
        payload: {
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: now,
        commandId: "cmd-thread-create",
        payload: {
          threadId: "thread-1",
          projectId: "project-1",
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]

    let electronModel = createEmptyReadModel(now)
    let rendererModel = createEmptyOrchestrationReadModel(now)

    for (const event of events) {
      electronModel = await Effect.runPromise(projectEvent(electronModel, event))
      rendererModel = projectOrchestrationReadModelEvent(rendererModel, event)
    }

    expect(rendererModel).toEqual(electronModel)
  })

  it("projects assistant message events into the latest turn timing", async () => {
    const now = "2026-01-01T00:00:00.000Z"
    const startedAt = "2026-01-01T00:00:03.000Z"
    const completedAt = "2026-01-01T00:00:09.000Z"
    const events = [
      makeEvent({
        sequence: 1,
        type: "project.created",
        aggregateKind: "project",
        aggregateId: "project-1",
        occurredAt: now,
        commandId: "cmd-project-create",
        payload: {
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 2,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: now,
        commandId: "cmd-thread-create",
        payload: {
          threadId: "thread-1",
          projectId: "project-1",
          title: "Thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5-codex",
          },
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      makeEvent({
        sequence: 3,
        type: "thread.message-sent",
        aggregateKind: "thread",
        aggregateId: "thread-1",
        occurredAt: completedAt,
        commandId: "cmd-message",
        payload: {
          threadId: "thread-1",
          messageId: "assistant-message-1",
          role: "assistant",
          text: "Done",
          turnId: "turn-1",
          streaming: false,
          createdAt: startedAt,
          updatedAt: completedAt,
        },
      }),
    ]

    let electronModel = createEmptyReadModel(now)
    let rendererModel = createEmptyOrchestrationReadModel(now)

    for (const event of events) {
      electronModel = await Effect.runPromise(projectEvent(electronModel, event))
      rendererModel = projectOrchestrationReadModelEvent(rendererModel, event)
    }

    expect(rendererModel).toEqual(electronModel)
    expect(rendererModel.threads[0]?.latestTurn).toMatchObject({
      turnId: "turn-1",
      state: "completed",
      startedAt,
      completedAt,
      assistantMessageId: "assistant-message-1",
    })
  })
})
