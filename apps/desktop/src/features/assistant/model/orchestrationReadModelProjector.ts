/**
 * Legacy shell/project projection with shared canonical detail-event reduction.
 * Session/turn authority must match native thread streams, even on fallback WS.
 */
import type {
  OrchestrationCheckpointSummary,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationThread,
  ThreadId,
} from "@cozea/assistant-contracts";

import { applyThreadDetailEvent, type ThreadDetailState } from "../../../../../../packages/client-runtime/src/state/threadReducer";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;

function updateOrchestrationThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function capDetailRows<T>(rows: ReadonlyArray<T>, maximum: number): ReadonlyArray<T> {
  return rows.length > maximum ? rows.slice(-maximum) : rows;
}

function legacySession(session: ThreadDetailState["session"]): OrchestrationThread["session"] {
  if (!session) return null;
  if (session.runtimeMode !== "approval-required" && session.runtimeMode !== "full-access") {
    throw new Error("Native-only runtime mode cannot enter the legacy read model");
  }
  return { ...session, runtimeMode: session.runtimeMode };
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
          ...(payload.modelSelection !== undefined
            ? { modelSelection: payload.modelSelection }
            : {}),
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
          ...(payload.modelSelection !== undefined
            ? { modelSelection: payload.modelSelection }
            : {}),
          runtimeMode: payload.runtimeMode,
          interactionMode: payload.interactionMode,
          updatedAt: event.occurredAt,
        }),
      };
    }

    case "thread.message-sent":
    case "thread.session-set":
    case "thread.session-stop-requested":
    case "thread.turn-interrupt-requested":
    case "thread.proposed-plan-upserted":
    case "thread.turn-diff-completed":
    case "thread.reverted":
    case "thread.activity-appended": {
      const index = nextBase.threads.findIndex(thread => thread.id === event.payload.threadId);
      const thread = nextBase.threads[index];
      if (!thread) return nextBase;
      // Project only shared detail fields. Legacy shell metadata and project
      // contracts remain owned by this adapter, not the native reducer.
      const detail: ThreadDetailState = {
        messages: thread.messages, activities: thread.activities,
        proposedPlans: thread.proposedPlans, checkpoints: thread.checkpoints,
        session: thread.session, latestTurn: thread.latestTurn,
      };
      // Legacy callers may omit the active turn when requesting interruption.
      // Resolve that API shorthand before entering the explicit native reducer.
      const detailEvent = event.type === "thread.turn-interrupt-requested" &&
        event.payload.turnId === undefined && thread.latestTurn?.state === "running"
          ? { ...event, payload: { ...event.payload, turnId: thread.latestTurn.turnId } }
          : event;
      const result = applyThreadDetailEvent(detail, detailEvent);
      if (result.kind !== "updated") return nextBase;
      const projected = result.thread;
      const checkpoints = projected.checkpoints;
      // The canonical reducer also supports partial old detail fixtures; this
      // full legacy read-model boundary requires complete checkpoints.
      if (!checkpoints.every((checkpoint): checkpoint is OrchestrationCheckpointSummary =>
        checkpoint.checkpointTurnCount !== undefined && checkpoint.checkpointRef !== undefined)) {
        throw new Error("Legacy read model requires complete checkpoints");
      }
      const latestTurn = projected.latestTurn &&
        projected.latestTurn !== thread.latestTurn &&
        projected.latestTurn.turnId === thread.latestTurn?.turnId &&
        thread.latestTurn.sourceProposedPlan !== undefined
          ? { ...projected.latestTurn, sourceProposedPlan: thread.latestTurn.sourceProposedPlan }
          : projected.latestTurn;
      const updated: OrchestrationThread = {
        ...thread,
        messages: capDetailRows(projected.messages, 2000),
        activities: capDetailRows(projected.activities, 500),
        proposedPlans: capDetailRows(projected.proposedPlans, 200),
        checkpoints: capDetailRows(checkpoints, 500),
        session: projected.session === thread.session ? thread.session : legacySession(projected.session),
        latestTurn,
        updatedAt: event.occurredAt,
      };
      const threads = [...nextBase.threads];
      threads[index] = updated;
      return { ...nextBase, threads };
    }

    default:
      return nextBase;
  }
}
