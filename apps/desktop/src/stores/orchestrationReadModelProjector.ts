/**
 * Synchronous port of `electron/assistant-runtime/orchestration/projector.ts`
 * `projectEvent` for renderer-side incremental updates from WS domain events.
 */
import type {
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationMessage,
  OrchestrationReadModel,
  OrchestrationSession,
  OrchestrationThread,
  ThreadId,
} from "@cozea/assistant-contracts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;

const MAX_THREAD_MESSAGES = 2000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function updateOrchestrationThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyOrchestrationReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectOrchestrationReadModelEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): OrchestrationReadModel {
  const nextBase: OrchestrationReadModel = {
    ...model,
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "project.created": {
      const payload = event.payload;
      const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
      const nextProject = {
        id: payload.projectId,
        title: payload.title,
        workspaceRoot: payload.workspaceRoot,
        defaultModelSelection: payload.defaultModelSelection,
        scripts: payload.scripts,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt: null,
      };
      return {
        ...nextBase,
        projects: existing
          ? nextBase.projects.map((entry) => (entry.id === payload.projectId ? nextProject : entry))
          : [...nextBase.projects, nextProject],
      };
    }

    case "project.meta-updated": {
      const payload = event.payload;
      return {
        ...nextBase,
        projects: nextBase.projects.map((project) =>
          project.id === payload.projectId
            ? {
                ...project,
                ...(payload.title !== undefined ? { title: payload.title } : {}),
                ...(payload.workspaceRoot !== undefined
                  ? { workspaceRoot: payload.workspaceRoot }
                  : {}),
                ...(payload.defaultModelSelection !== undefined
                  ? { defaultModelSelection: payload.defaultModelSelection }
                  : {}),
                ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                updatedAt: payload.updatedAt,
              }
            : project,
        ),
      };
    }

    case "project.deleted": {
      const payload = event.payload;
      return {
        ...nextBase,
        projects: nextBase.projects.map((project) =>
          project.id === payload.projectId
            ? {
                ...project,
                deletedAt: payload.deletedAt,
                updatedAt: payload.deletedAt,
              }
            : project,
        ),
      };
    }

    case "thread.created": {
      const payload = event.payload;
      const thread: OrchestrationThread = {
        id: payload.threadId,
        projectId: payload.projectId,
        title: payload.title,
        modelSelection: payload.modelSelection,
        runtimeMode: payload.runtimeMode,
        interactionMode: payload.interactionMode,
        branch: payload.branch,
        worktreePath: payload.worktreePath,
        latestTurn: null,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      };
      const existing = nextBase.threads.find((entry) => entry.id === thread.id);
      return {
        ...nextBase,
        threads: existing
          ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
          : [...nextBase.threads, thread],
      };
    }

    case "thread.deleted": {
      const payload = event.payload;
      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          deletedAt: payload.deletedAt,
          updatedAt: payload.deletedAt,
        }),
      };
    }

    case "thread.meta-updated": {
      const payload = event.payload;
      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
          ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
          ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
          updatedAt: payload.updatedAt,
        }),
      };
    }

    case "thread.runtime-mode-set": {
      const payload = event.payload;
      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          runtimeMode: payload.runtimeMode,
          updatedAt: payload.updatedAt,
        }),
      };
    }

    case "thread.interaction-mode-set": {
      const payload = event.payload;
      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          interactionMode: payload.interactionMode,
          updatedAt: payload.updatedAt,
        }),
      };
    }

    case "thread.turn-start-requested": {
      const payload = event.payload;
      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          ...(payload.modelSelection !== undefined ? { modelSelection: payload.modelSelection } : {}),
          runtimeMode: payload.runtimeMode,
          interactionMode: payload.interactionMode,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.message-sent": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const message: OrchestrationMessage = {
        id: payload.messageId,
        role: payload.role,
        text: payload.text,
        ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
        turnId: payload.turnId,
        streaming: payload.streaming,
        createdAt: payload.createdAt,
        updatedAt: payload.updatedAt,
      };

      const existingMessage = thread.messages.find((entry) => entry.id === message.id);
      const messages = existingMessage
        ? thread.messages.map((entry) =>
            entry.id === message.id
              ? {
                  ...entry,
                  text: message.streaming
                    ? `${entry.text}${message.text}`
                    : message.text.length > 0
                      ? message.text
                      : entry.text,
                  streaming: message.streaming,
                  updatedAt: message.updatedAt,
                  turnId: message.turnId,
                  ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
                }
              : entry,
          )
        : [...thread.messages, message];
      const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);
      const latestTurn =
        payload.role === "assistant" &&
        payload.turnId !== null &&
        (thread.latestTurn === null || thread.latestTurn.turnId === payload.turnId)
          ? {
              turnId: payload.turnId,
              state: payload.streaming
                ? ("running" as const)
                : thread.latestTurn?.state === "interrupted"
                  ? ("interrupted" as const)
                  : thread.latestTurn?.state === "error"
                    ? ("error" as const)
                    : ("completed" as const),
              requestedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? thread.latestTurn.requestedAt
                  : payload.createdAt,
              startedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? (thread.latestTurn.startedAt ?? payload.createdAt)
                  : payload.createdAt,
              completedAt: payload.streaming
                ? thread.latestTurn?.turnId === payload.turnId
                  ? (thread.latestTurn.completedAt ?? null)
                  : null
                : payload.updatedAt,
              assistantMessageId: payload.messageId,
              ...(thread.latestTurn?.sourceProposedPlan !== undefined
                ? { sourceProposedPlan: thread.latestTurn.sourceProposedPlan }
                : {}),
            }
          : thread.latestTurn;

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          messages: cappedMessages,
          latestTurn,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.session-set": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const session: OrchestrationSession = payload.session;

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          session,
          latestTurn:
            session.status === "running" && session.activeTurnId !== null
              ? {
                  turnId: session.activeTurnId,
                  state: "running",
                  requestedAt:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? thread.latestTurn.requestedAt
                      : session.updatedAt,
                  startedAt:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? (thread.latestTurn.startedAt ?? session.updatedAt)
                      : session.updatedAt,
                  completedAt: null,
                  assistantMessageId:
                    thread.latestTurn?.turnId === session.activeTurnId
                      ? thread.latestTurn.assistantMessageId
                      : null,
                }
              : thread.latestTurn,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.turn-interrupt-requested": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const interruptedTurn =
        payload.turnId !== undefined
          ? thread.latestTurn?.turnId === payload.turnId
            ? thread.latestTurn
            : null
          : thread.latestTurn?.state === "running"
            ? thread.latestTurn
            : null;
      if (!interruptedTurn) {
        return {
          ...nextBase,
          threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
            updatedAt: event.occurredAt,
          }),
        };
      }

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          latestTurn: {
            ...interruptedTurn,
            state: "interrupted",
            completedAt: interruptedTurn.completedAt ?? payload.createdAt,
          },
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.proposed-plan-upserted": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const proposedPlans = [
        ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
        payload.proposedPlan,
      ]
        .toSorted(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
        )
        .slice(-200);

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          proposedPlans,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.turn-diff-completed": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const checkpoint: OrchestrationCheckpointSummary = {
        turnId: payload.turnId,
        checkpointTurnCount: payload.checkpointTurnCount,
        checkpointRef: payload.checkpointRef,
        status: payload.status,
        files: payload.files,
        assistantMessageId: payload.assistantMessageId,
        completedAt: payload.completedAt,
      };

      const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
      if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
        return nextBase;
      }

      const checkpoints = [
        ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
        checkpoint,
      ]
        .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
        .slice(-MAX_THREAD_CHECKPOINTS);

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          checkpoints,
          latestTurn: {
            turnId: payload.turnId,
            state: checkpointStatusToLatestTurnState(payload.status),
            requestedAt:
              thread.latestTurn?.turnId === payload.turnId
                ? thread.latestTurn.requestedAt
                : payload.completedAt,
            startedAt:
              thread.latestTurn?.turnId === payload.turnId
                ? (thread.latestTurn.startedAt ?? payload.completedAt)
                : payload.completedAt,
            completedAt: payload.completedAt,
            assistantMessageId: payload.assistantMessageId,
          },
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.reverted": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const checkpoints = thread.checkpoints
        .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
        .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
        .slice(-MAX_THREAD_CHECKPOINTS);
      const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
      const messages = retainThreadMessagesAfterRevert(
        thread.messages,
        retainedTurnIds,
        payload.turnCount,
      ).slice(-MAX_THREAD_MESSAGES);
      const proposedPlans = retainThreadProposedPlansAfterRevert(
        thread.proposedPlans,
        retainedTurnIds,
      ).slice(-200);
      const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

      const latestCheckpoint = checkpoints.at(-1) ?? null;
      const latestTurn =
        latestCheckpoint === null
          ? null
          : {
              turnId: latestCheckpoint.turnId,
              state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
              requestedAt: latestCheckpoint.completedAt,
              startedAt: latestCheckpoint.completedAt,
              completedAt: latestCheckpoint.completedAt,
              assistantMessageId: latestCheckpoint.assistantMessageId,
            };

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          checkpoints,
          messages,
          proposedPlans,
          activities,
          latestTurn,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.activity-appended": {
      const payload = event.payload;
      const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
      if (!thread) {
        return nextBase;
      }

      const activities = [
        ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
        payload.activity,
      ]
        .toSorted(compareThreadActivities)
        .slice(-500);

      return {
        ...nextBase,
        threads: updateOrchestrationThread(nextBase.threads, payload.threadId, {
          activities,
          updatedAt: event.occurredAt,
        }),
      };
    }

    default:
      return nextBase;
  }
}
