import { Fragment, type ReactNode, createElement, useEffect } from "react";
import type {
  MessageId,
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
  TurnId,
} from "@cozea/assistant-contracts";
import {
  createEmptyOrchestrationReadModel,
  projectOrchestrationReadModelEvent,
} from "@/stores/orchestrationReadModelProjector";
import { resolveModelSlugForProvider } from "@cozea/assistant-shared/model";
import { create } from "zustand";
import {
  type ChatMessage,
  type Project,
  type ProposedPlan,
  type Thread,
  type ThreadSession,
  type TurnDiffSummary,
} from "./types";
import { normalizeThreadSession } from "./threadSession";
import { normalizeThreadError } from "@/features/projects/components/assistant/lib/assistantErrors";
import { Debouncer } from "@tanstack/react-pacer";
import { resolveWsHttpOrigin } from "@/lib/desktopBridgeClient";

// ── State ────────────────────────────────────────────────────────────

export interface ThreadShell
  extends Omit<
    Thread,
    "session" | "messages" | "proposedPlans" | "latestTurn" | "turnDiffSummaries" | "activities"
  > {}

export interface ThreadTurnState {
  latestTurn: Thread["latestTurn"];
}

export interface AppState {
  projectIds: ProjectId[];
  projectById: Record<ProjectId, Project>;
  projectIdByCwd: Record<string, ProjectId>;
  threadIds: ThreadId[];
  threadIdsByProjectId: Record<ProjectId, ThreadId[]>;
  threadShellById: Record<ThreadId, ThreadShell>;
  threadSessionById: Record<ThreadId, ThreadSession | null>;
  threadTurnStateById: Record<ThreadId, ThreadTurnState>;
  messageIdsByThreadId: Record<ThreadId, MessageId[]>;
  messageByThreadId: Record<ThreadId, Record<MessageId, ChatMessage>>;
  activityIdsByThreadId: Record<ThreadId, string[]>;
  activityByThreadId: Record<ThreadId, Record<string, Thread["activities"][number]>>;
  proposedPlanIdsByThreadId: Record<ThreadId, string[]>;
  proposedPlanByThreadId: Record<ThreadId, Record<string, ProposedPlan>>;
  turnDiffIdsByThreadId: Record<ThreadId, TurnId[]>;
  turnDiffSummaryByThreadId: Record<ThreadId, Record<TurnId, TurnDiffSummary>>;
  threadsHydrated: boolean;
  /** Canonical server read model; updated by snapshot hydrate + WS domain events. */
  orchestrationReadModel: OrchestrationReadModel;
}

const PERSISTED_STATE_KEY = "cozea:assistant:renderer-state:v8";

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ACTIVITIES: Thread["activities"] = [];
const EMPTY_PROPOSED_PLANS: ProposedPlan[] = [];
const EMPTY_TURN_DIFF_SUMMARIES: TurnDiffSummary[] = [];
const EMPTY_MESSAGE_MAP: Record<MessageId, ChatMessage> = {};
const EMPTY_ACTIVITY_MAP: Record<string, Thread["activities"][number]> = {};
const EMPTY_PROPOSED_PLAN_MAP: Record<string, ProposedPlan> = {};
const EMPTY_TURN_DIFF_MAP: Record<TurnId, TurnDiffSummary> = {};
const EMPTY_THREAD_IDS: ThreadId[] = [];

const initialState: AppState = {
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
  orchestrationReadModel: createEmptyOrchestrationReadModel(new Date().toISOString()),
};
const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];

// ── Persist helpers ──────────────────────────────────────────────────

function readPersistedState(): AppState {
  if (typeof window === "undefined") return initialState;
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as {
      expandedProjectCwds?: string[];
      projectOrderCwds?: string[];
    };
    persistedExpandedProjectCwds.clear();
    persistedProjectOrderCwds.length = 0;
    for (const cwd of parsed.expandedProjectCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0) {
        persistedExpandedProjectCwds.add(cwd);
      }
    }
    for (const cwd of parsed.projectOrderCwds ?? []) {
      if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
        persistedProjectOrderCwds.push(cwd);
      }
    }
    return { ...initialState };
  } catch {
    return initialState;
  }
}

function persistState(state: AppState): void {
  if (typeof window === "undefined") return;
  try {
    const projects = selectAssistantProjects(state);
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        expandedProjectCwds: projects
          .filter((project) => project.expanded)
          .map((project) => project.cwd),
        projectOrderCwds: projects.map((project) => project.cwd),
      }),
    );
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}
const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

// ── Identity and equality helpers ────────────────────────────────────

function scalarArrayEqual<T extends string>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function projectScriptsEqual(left: Project["scripts"], right: Project["scripts"]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((script, index) => jsonEqual(script, right[index]));
}

function projectsEqual(left: Project | undefined, right: Project): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.name === right.name &&
    left.cwd === right.cwd &&
    jsonEqual(left.defaultModelSelection, right.defaultModelSelection) &&
    left.expanded === right.expanded &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    projectScriptsEqual(left.scripts, right.scripts)
  );
}

function threadShellsEqual(left: ThreadShell | undefined, right: ThreadShell): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.codexThreadId === right.codexThreadId &&
    left.projectId === right.projectId &&
    left.title === right.title &&
    jsonEqual(left.modelSelection, right.modelSelection) &&
    left.runtimeMode === right.runtimeMode &&
    left.interactionMode === right.interactionMode &&
    left.error === right.error &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastVisitedAt === right.lastVisitedAt &&
    left.branch === right.branch &&
    left.worktreePath === right.worktreePath
  );
}

function threadSessionsEqual(
  left: ThreadSession | null | undefined,
  right: ThreadSession | null | undefined,
): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  return (
    left.provider === right.provider &&
    left.status === right.status &&
    left.activeTurnId === right.activeTurnId &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.lastError === right.lastError &&
    left.orchestrationStatus === right.orchestrationStatus
  );
}

function threadTurnStatesEqual(
  left: ThreadTurnState | undefined,
  right: ThreadTurnState,
): boolean {
  return left !== undefined && jsonEqual(left.latestTurn, right.latestTurn);
}

function retainThreadScopedRecord<T>(
  record: Record<ThreadId, T>,
  retainedThreadIds: ReadonlySet<ThreadId>,
): Record<ThreadId, T> {
  let changed = false;
  const next: Record<ThreadId, T> = {};
  for (const [threadId, value] of Object.entries(record) as Array<[ThreadId, T]>) {
    if (retainedThreadIds.has(threadId)) {
      next[threadId] = value;
    } else {
      changed = true;
    }
  }
  return changed ? next : record;
}

// ── Mapping helpers ──────────────────────────────────────────────────

function normalizeModelSelection(selection: OrchestrationReadModel["threads"][number]["modelSelection"]) {
  return {
    ...selection,
    model: resolveModelSlugForProvider(selection.provider, selection.model),
  };
}

function mapProjectsFromReadModel(
  incoming: OrchestrationReadModel["projects"],
  previous: Project[],
): Project[] {
  const previousById = new Map(previous.map((project) => [project.id, project] as const));
  const previousByCwd = new Map(previous.map((project) => [project.cwd, project] as const));
  const previousOrderById = new Map(previous.map((project, index) => [project.id, index] as const));
  const previousOrderByCwd = new Map(
    previous.map((project, index) => [project.cwd, index] as const),
  );
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const usePersistedOrder = previous.length === 0;

  const mappedProjects = incoming.map((project) => {
    const existing = previousById.get(project.id) ?? previousByCwd.get(project.workspaceRoot);
    return {
      id: project.id,
      name: project.title,
      cwd: project.workspaceRoot,
      defaultModelSelection:
        existing?.defaultModelSelection ??
        (project.defaultModelSelection
          ? normalizeModelSelection(project.defaultModelSelection)
          : null),
      expanded:
        existing?.expanded ??
        (persistedExpandedProjectCwds.size > 0
          ? persistedExpandedProjectCwds.has(project.workspaceRoot)
          : true),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      scripts: project.scripts.map((script) => ({ ...script })),
    } satisfies Project;
  });

  return mappedProjects
    .map((project, incomingIndex) => {
      const previousIndex =
        previousOrderById.get(project.id) ?? previousOrderByCwd.get(project.cwd);
      const persistedIndex = usePersistedOrder ? persistedOrderByCwd.get(project.cwd) : undefined;
      const orderIndex =
        previousIndex ??
        persistedIndex ??
        (usePersistedOrder ? persistedProjectOrderCwds.length : previous.length) + incomingIndex;
      return { project, incomingIndex, orderIndex };
    })
    .toSorted((a, b) => {
      const byOrder = a.orderIndex - b.orderIndex;
      if (byOrder !== 0) return byOrder;
      return a.incomingIndex - b.incomingIndex;
    })
    .map((entry) => {
      const existing =
        previousById.get(entry.project.id) ?? previousByCwd.get(entry.project.cwd);
      return existing && projectsEqual(existing, entry.project) ? existing : entry.project;
    });
}

function toAttachmentPreviewUrl(rawUrl: string): string {
  if (rawUrl.startsWith("/")) {
    return `${resolveWsHttpOrigin()}${rawUrl}`;
  }
  return rawUrl;
}

function attachmentPreviewRoutePath(attachmentId: string): string {
  return `/attachments/${encodeURIComponent(attachmentId)}`;
}

function mapMessage(message: OrchestrationReadModel["threads"][number]["messages"][number]): ChatMessage {
  const attachments = message.attachments?.map((attachment: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  }) => ({
    type: "image" as const,
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    previewUrl: toAttachmentPreviewUrl(attachmentPreviewRoutePath(attachment.id)),
  }));
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    turnId: message.turnId,
    createdAt: message.createdAt,
    streaming: message.streaming,
    ...(message.streaming ? {} : { completedAt: message.updatedAt }),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

function mapProposedPlan(proposedPlan: OrchestrationReadModel["threads"][number]["proposedPlans"][number]): ProposedPlan {
  return {
    id: proposedPlan.id,
    turnId: proposedPlan.turnId,
    planMarkdown: proposedPlan.planMarkdown,
    implementedAt: proposedPlan.implementedAt,
    implementationThreadId: proposedPlan.implementationThreadId,
    createdAt: proposedPlan.createdAt,
    updatedAt: proposedPlan.updatedAt,
  };
}

function mapTurnDiffSummary(checkpoint: OrchestrationReadModel["threads"][number]["checkpoints"][number]): TurnDiffSummary {
  return {
    turnId: checkpoint.turnId,
    completedAt: checkpoint.completedAt,
    status: checkpoint.status,
    assistantMessageId: checkpoint.assistantMessageId ?? undefined,
    checkpointTurnCount: checkpoint.checkpointTurnCount,
    checkpointRef: checkpoint.checkpointRef,
    files: checkpoint.files.map((file) => ({ ...file })),
  };
}

function mapThreadShell(
  thread: OrchestrationReadModel["threads"][number],
  previousShell: ThreadShell | undefined,
): ThreadShell {
  return {
    id: thread.id,
    codexThreadId: null,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: normalizeModelSelection(thread.modelSelection),
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    error: normalizeThreadError(thread.session?.lastError),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    lastVisitedAt: previousShell?.lastVisitedAt ?? thread.updatedAt,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
  };
}

function buildMessageSlice(thread: OrchestrationReadModel["threads"][number]) {
  const messages = thread.messages.map(mapMessage);
  return {
    ids: messages.map((message) => message.id),
    byId: Object.fromEntries(messages.map((message) => [message.id, message] as const)),
  };
}

function buildActivitySlice(thread: OrchestrationReadModel["threads"][number]) {
  return {
    ids: thread.activities.map((activity) => activity.id),
    byId: Object.fromEntries(thread.activities.map((activity) => [activity.id, { ...activity }] as const)),
  };
}

function buildProposedPlanSlice(thread: OrchestrationReadModel["threads"][number]) {
  const proposedPlans = thread.proposedPlans.map(mapProposedPlan);
  return {
    ids: proposedPlans.map((plan) => plan.id),
    byId: Object.fromEntries(proposedPlans.map((plan) => [plan.id, plan] as const)),
  };
}

function buildTurnDiffSlice(thread: OrchestrationReadModel["threads"][number]) {
  const turnDiffSummaries = thread.checkpoints.map(mapTurnDiffSummary);
  return {
    ids: turnDiffSummaries.map((summary) => summary.turnId),
    byId: Object.fromEntries(turnDiffSummaries.map((summary) => [summary.turnId, summary] as const)),
  };
}

// ── Thread derivation ────────────────────────────────────────────────

const collectedByIdsCache = new WeakMap<readonly string[], WeakMap<object, readonly unknown[]>>();
const threadCache = new WeakMap<
  ThreadShell,
  {
    session: ThreadSession | null;
    turnState: ThreadTurnState | undefined;
    messages: Thread["messages"];
    activities: Thread["activities"];
    proposedPlans: Thread["proposedPlans"];
    turnDiffSummaries: Thread["turnDiffSummaries"];
    thread: Thread;
  }
>();

function collectByIds<TKey extends string, TValue>(
  ids: readonly TKey[] | undefined,
  byId: Record<TKey, TValue> | undefined,
  emptyValue: TValue[],
): TValue[] {
  if (!ids || ids.length === 0 || !byId) {
    return emptyValue;
  }

  const cachedByRecord = collectedByIdsCache.get(ids);
  const cached = cachedByRecord?.get(byId);
  if (cached) {
    return cached as TValue[];
  }

  const nextValues = ids.flatMap((id) => {
    const value = byId[id];
    return value ? [value] : [];
  });
  const nextCachedByRecord = cachedByRecord ?? new WeakMap<object, readonly unknown[]>();
  nextCachedByRecord.set(byId, nextValues);
  if (!cachedByRecord) {
    collectedByIdsCache.set(ids, nextCachedByRecord);
  }
  return nextValues;
}

function selectThreadMessages(state: AppState, threadId: ThreadId): Thread["messages"] {
  return collectByIds(
    state.messageIdsByThreadId[threadId],
    state.messageByThreadId[threadId] ?? EMPTY_MESSAGE_MAP,
    EMPTY_MESSAGES,
  );
}

function selectThreadActivities(state: AppState, threadId: ThreadId): Thread["activities"] {
  return collectByIds(
    state.activityIdsByThreadId[threadId],
    state.activityByThreadId[threadId] ?? EMPTY_ACTIVITY_MAP,
    EMPTY_ACTIVITIES,
  );
}

function selectThreadProposedPlans(state: AppState, threadId: ThreadId): Thread["proposedPlans"] {
  return collectByIds(
    state.proposedPlanIdsByThreadId[threadId],
    state.proposedPlanByThreadId[threadId] ?? EMPTY_PROPOSED_PLAN_MAP,
    EMPTY_PROPOSED_PLANS,
  );
}

function selectThreadTurnDiffSummaries(
  state: AppState,
  threadId: ThreadId,
): Thread["turnDiffSummaries"] {
  return collectByIds(
    state.turnDiffIdsByThreadId[threadId],
    state.turnDiffSummaryByThreadId[threadId] ?? EMPTY_TURN_DIFF_MAP,
    EMPTY_TURN_DIFF_SUMMARIES,
  );
}

export function getThreadFromAssistantState(
  state: AppState,
  threadId: ThreadId | null | undefined,
): Thread | null {
  if (!threadId) return null;
  const shell = state.threadShellById[threadId];
  if (!shell) return null;

  const session = state.threadSessionById[threadId] ?? null;
  const turnState = state.threadTurnStateById[threadId];
  const messages = selectThreadMessages(state, threadId);
  const activities = selectThreadActivities(state, threadId);
  const proposedPlans = selectThreadProposedPlans(state, threadId);
  const turnDiffSummaries = selectThreadTurnDiffSummaries(state, threadId);
  const cached = threadCache.get(shell);

  if (
    cached &&
    cached.session === session &&
    cached.turnState === turnState &&
    cached.messages === messages &&
    cached.activities === activities &&
    cached.proposedPlans === proposedPlans &&
    cached.turnDiffSummaries === turnDiffSummaries
  ) {
    return cached.thread;
  }

  const thread: Thread = {
    ...shell,
    session,
    latestTurn: turnState?.latestTurn ?? null,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
  };

  threadCache.set(shell, {
    session,
    turnState,
    messages,
    activities,
    proposedPlans,
    turnDiffSummaries,
    thread,
  });

  return thread;
}

export function selectAssistantProjects(state: AppState): Project[] {
  return state.projectIds.flatMap((projectId) => {
    const project = state.projectById[projectId];
    return project ? [project] : [];
  });
}

export function selectAssistantThreads(state: AppState): Thread[] {
  return state.threadIds.flatMap((threadId) => {
    const thread = getThreadFromAssistantState(state, threadId);
    return thread ? [thread] : [];
  });
}

export function selectAssistantProjectById(
  state: AppState,
  projectId: ProjectId | string | null | undefined,
): Project | null {
  return projectId ? (state.projectById[projectId as ProjectId] ?? null) : null;
}

export function selectAssistantProjectByCwd(
  state: AppState,
  cwd: string | null | undefined,
): Project | null {
  return cwd ? (state.projectById[state.projectIdByCwd[cwd]] ?? null) : null;
}

export function selectAssistantProjectForTile(
  state: AppState,
  tile: { assistantProjectId?: string | null } | null | undefined,
  projectPath: string | null | undefined,
): Project | null {
  return (
    selectAssistantProjectById(state, tile?.assistantProjectId) ??
    selectAssistantProjectByCwd(state, projectPath)
  );
}

export function selectAssistantThreadById(
  state: AppState,
  threadId: ThreadId | string | null | undefined,
): Thread | null {
  return getThreadFromAssistantState(state, threadId as ThreadId | null | undefined);
}

export function createAssistantThreadSelectorById(
  threadId: ThreadId | string | null | undefined,
): (state: AppState) => Thread | null {
  let previousShell: ThreadShell | undefined;
  let previousSession: ThreadSession | null | undefined;
  let previousTurnState: ThreadTurnState | undefined;
  let previousMessageIds: MessageId[] | undefined;
  let previousMessagesById: Record<MessageId, ChatMessage> | undefined;
  let previousActivityIds: string[] | undefined;
  let previousActivitiesById: Record<string, Thread["activities"][number]> | undefined;
  let previousProposedPlanIds: string[] | undefined;
  let previousProposedPlansById: Record<string, ProposedPlan> | undefined;
  let previousTurnDiffIds: TurnId[] | undefined;
  let previousTurnDiffsById: Record<TurnId, TurnDiffSummary> | undefined;
  let previousThread: Thread | null = null;

  return (state) => {
    if (!threadId) return null;
    const id = threadId as ThreadId;
    const shell = state.threadShellById[id];
    if (!shell) {
      previousShell = undefined;
      previousThread = null;
      return null;
    }
    const session = state.threadSessionById[id] ?? null;
    const turnState = state.threadTurnStateById[id];
    const messageIds = state.messageIdsByThreadId[id];
    const messagesById = state.messageByThreadId[id];
    const activityIds = state.activityIdsByThreadId[id];
    const activitiesById = state.activityByThreadId[id];
    const proposedPlanIds = state.proposedPlanIdsByThreadId[id];
    const proposedPlansById = state.proposedPlanByThreadId[id];
    const turnDiffIds = state.turnDiffIdsByThreadId[id];
    const turnDiffsById = state.turnDiffSummaryByThreadId[id];

    if (
      previousThread &&
      previousShell === shell &&
      previousSession === session &&
      previousTurnState === turnState &&
      previousMessageIds === messageIds &&
      previousMessagesById === messagesById &&
      previousActivityIds === activityIds &&
      previousActivitiesById === activitiesById &&
      previousProposedPlanIds === proposedPlanIds &&
      previousProposedPlansById === proposedPlansById &&
      previousTurnDiffIds === turnDiffIds &&
      previousTurnDiffsById === turnDiffsById
    ) {
      return previousThread;
    }

    previousShell = shell;
    previousSession = session;
    previousTurnState = turnState;
    previousMessageIds = messageIds;
    previousMessagesById = messagesById;
    previousActivityIds = activityIds;
    previousActivitiesById = activitiesById;
    previousProposedPlanIds = proposedPlanIds;
    previousProposedPlansById = proposedPlansById;
    previousTurnDiffIds = turnDiffIds;
    previousTurnDiffsById = turnDiffsById;
    previousThread = getThreadFromAssistantState(state, threadId as ThreadId);
    return previousThread;
  };
}

export function createAssistantProjectSelectorForTile(input: {
  assistantProjectId?: string | null;
  projectPath?: string | null;
  /** Alias for projectPath; used when workspace catalog is active. */
  workspaceId?: string | null;
}): (state: AppState) => Project | null {
  const cwd = input.projectPath ?? input.workspaceId ?? null;
  return (state) =>
    selectAssistantProjectForTile(
      state,
      { assistantProjectId: input.assistantProjectId ?? null },
      cwd,
    );
}

// ── Pure state transition functions ────────────────────────────────────

function writeProjectCollection(
  state: AppState,
  incoming: OrchestrationReadModel["projects"],
): AppState {
  const projects = mapProjectsFromReadModel(incoming, selectAssistantProjects(state));
  const projectIds = projects.map((project) => project.id);
  const projectById = Object.fromEntries(projects.map((project) => [project.id, project] as const));
  const projectIdByCwd = Object.fromEntries(
    projects.map((project) => [project.cwd, project.id] as const),
  );

  const sameProjectIds = scalarArrayEqual(state.projectIds, projectIds);
  const sameProjectObjects =
    sameProjectIds && projects.every((project) => state.projectById[project.id] === project);

  if (
    sameProjectIds &&
    sameProjectObjects &&
    jsonEqual(state.projectIdByCwd, projectIdByCwd)
  ) {
    return state;
  }

  return {
    ...state,
    projectIds,
    projectById,
    projectIdByCwd,
  };
}

function previousRawThreadById(readModel: OrchestrationReadModel): Map<ThreadId, OrchestrationReadModel["threads"][number]> {
  return new Map(readModel.threads.map((thread) => [thread.id, thread] as const));
}

function writeThreadFromReadModel(
  state: AppState,
  thread: OrchestrationReadModel["threads"][number],
  previousRawThread: OrchestrationReadModel["threads"][number] | undefined,
): AppState {
  const previousShell = state.threadShellById[thread.id];
  const nextShell = mapThreadShell(thread, previousShell);
  const nextSession = normalizeThreadSession(thread.session);
  const nextTurnState: ThreadTurnState = {
    latestTurn: thread.latestTurn,
  };

  let nextState = state;

  if (!threadShellsEqual(previousShell, nextShell)) {
    nextState = {
      ...nextState,
      threadShellById: {
        ...nextState.threadShellById,
        [thread.id]: nextShell,
      },
    };
  }

  if (!threadSessionsEqual(nextState.threadSessionById[thread.id] ?? null, nextSession)) {
    nextState = {
      ...nextState,
      threadSessionById: {
        ...nextState.threadSessionById,
        [thread.id]: nextSession,
      },
    };
  }

  if (!threadTurnStatesEqual(nextState.threadTurnStateById[thread.id], nextTurnState)) {
    nextState = {
      ...nextState,
      threadTurnStateById: {
        ...nextState.threadTurnStateById,
        [thread.id]: nextTurnState,
      },
    };
  }

  if (previousRawThread?.messages !== thread.messages || !nextState.messageIdsByThreadId[thread.id]) {
    // Snapshot resyncs deserialize fresh objects, so raw identity always
    // differs even when nothing changed — and rebuilding every thread's
    // message slice froze the renderer for seconds on cold project switches.
    // A cheap content fingerprint (length + last id + last text length +
    // streaming flag) detects the identical case and keeps the existing slice.
    const existingIds = nextState.messageIdsByThreadId[thread.id];
    const existingById = nextState.messageByThreadId[thread.id];
    const lastRaw = thread.messages.at(-1);
    const lastExistingId = existingIds?.at(-1);
    const lastExisting = lastExistingId ? existingById?.[lastExistingId] : undefined;
    const sliceLooksCurrent =
      existingIds !== undefined &&
      existingById !== undefined &&
      existingIds.length === thread.messages.length &&
      lastRaw?.id === lastExistingId &&
      (lastRaw === undefined ||
        (lastExisting !== undefined &&
          (lastRaw.text?.length ?? 0) === (lastExisting.text?.length ?? 0) &&
          Boolean(lastRaw.streaming) === Boolean(lastExisting.streaming)));
    if (!sliceLooksCurrent) {
      const messageSlice = buildMessageSlice(thread);
      nextState = {
        ...nextState,
        messageIdsByThreadId: {
          ...nextState.messageIdsByThreadId,
          [thread.id]: messageSlice.ids,
        },
        messageByThreadId: {
          ...nextState.messageByThreadId,
          [thread.id]: messageSlice.byId,
        },
      };
    }
  }

  if (previousRawThread?.activities !== thread.activities || !nextState.activityIdsByThreadId[thread.id]) {
    const existingActivityIds = nextState.activityIdsByThreadId[thread.id];
    const activitySliceLooksCurrent =
      existingActivityIds !== undefined &&
      existingActivityIds.length === thread.activities.length &&
      existingActivityIds.at(-1) === thread.activities.at(-1)?.id;
    if (!activitySliceLooksCurrent) {
      const activitySlice = buildActivitySlice(thread);
      nextState = {
        ...nextState,
        activityIdsByThreadId: {
          ...nextState.activityIdsByThreadId,
          [thread.id]: activitySlice.ids,
        },
        activityByThreadId: {
          ...nextState.activityByThreadId,
          [thread.id]: activitySlice.byId,
        },
      };
    }
  }

  if (
    previousRawThread?.proposedPlans !== thread.proposedPlans ||
    !nextState.proposedPlanIdsByThreadId[thread.id]
  ) {
    const proposedPlanSlice = buildProposedPlanSlice(thread);
    nextState = {
      ...nextState,
      proposedPlanIdsByThreadId: {
        ...nextState.proposedPlanIdsByThreadId,
        [thread.id]: proposedPlanSlice.ids,
      },
      proposedPlanByThreadId: {
        ...nextState.proposedPlanByThreadId,
        [thread.id]: proposedPlanSlice.byId,
      },
    };
  }

  if (
    previousRawThread?.checkpoints !== thread.checkpoints ||
    !nextState.turnDiffIdsByThreadId[thread.id]
  ) {
    const turnDiffSlice = buildTurnDiffSlice(thread);
    nextState = {
      ...nextState,
      turnDiffIdsByThreadId: {
        ...nextState.turnDiffIdsByThreadId,
        [thread.id]: turnDiffSlice.ids,
      },
      turnDiffSummaryByThreadId: {
        ...nextState.turnDiffSummaryByThreadId,
        [thread.id]: turnDiffSlice.byId,
      },
    };
  }

  return nextState;
}

function writeThreadCollectionsFromReadModel(
  state: AppState,
  readModel: OrchestrationReadModel,
  previousReadModel: OrchestrationReadModel,
): AppState {
  const activeThreads = readModel.threads.filter((thread) => thread.deletedAt === null);
  const activeThreadIds = activeThreads.map((thread) => thread.id);
  const activeThreadIdSet = new Set(activeThreadIds);
  const threadIdsByProjectId: Record<ProjectId, ThreadId[]> = {};

  for (const thread of activeThreads) {
    threadIdsByProjectId[thread.projectId] = [
      ...(threadIdsByProjectId[thread.projectId] ?? EMPTY_THREAD_IDS),
      thread.id,
    ];
  }

  let nextState: AppState = {
    ...state,
    threadIds: scalarArrayEqual(state.threadIds, activeThreadIds)
      ? state.threadIds
      : activeThreadIds,
    threadIdsByProjectId: jsonEqual(state.threadIdsByProjectId, threadIdsByProjectId)
      ? state.threadIdsByProjectId
      : threadIdsByProjectId,
    threadShellById: retainThreadScopedRecord(state.threadShellById, activeThreadIdSet),
    threadSessionById: retainThreadScopedRecord(state.threadSessionById, activeThreadIdSet),
    threadTurnStateById: retainThreadScopedRecord(state.threadTurnStateById, activeThreadIdSet),
    messageIdsByThreadId: retainThreadScopedRecord(state.messageIdsByThreadId, activeThreadIdSet),
    messageByThreadId: retainThreadScopedRecord(state.messageByThreadId, activeThreadIdSet),
    activityIdsByThreadId: retainThreadScopedRecord(state.activityIdsByThreadId, activeThreadIdSet),
    activityByThreadId: retainThreadScopedRecord(state.activityByThreadId, activeThreadIdSet),
    proposedPlanIdsByThreadId: retainThreadScopedRecord(
      state.proposedPlanIdsByThreadId,
      activeThreadIdSet,
    ),
    proposedPlanByThreadId: retainThreadScopedRecord(state.proposedPlanByThreadId, activeThreadIdSet),
    turnDiffIdsByThreadId: retainThreadScopedRecord(state.turnDiffIdsByThreadId, activeThreadIdSet),
    turnDiffSummaryByThreadId: retainThreadScopedRecord(
      state.turnDiffSummaryByThreadId,
      activeThreadIdSet,
    ),
  };

  const previousThreads = previousRawThreadById(previousReadModel);
  for (const thread of activeThreads) {
    nextState = writeThreadFromReadModel(nextState, thread, previousThreads.get(thread.id));
  }

  return nextState;
}

export function syncServerReadModel(state: AppState, readModel: OrchestrationReadModel): AppState {
  const previousReadModel = state.orchestrationReadModel;
  let nextState: AppState = {
    ...state,
    orchestrationReadModel: readModel,
    threadsHydrated: true,
  };
  nextState = writeProjectCollection(
    nextState,
    readModel.projects.filter((project) => project.deletedAt === null),
  );
  nextState = writeThreadCollectionsFromReadModel(nextState, readModel, previousReadModel);
  return nextState;
}

/**
 * Merge consecutive `thread.message-sent` events for the same message (t3
 * `coalesceOrchestrationUiEvents`) so one store update can represent a burst of
 * streaming deltas.
 */
export function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments: event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }

    coalesced.push(event);
  }

  return coalesced;
}

export function applyOrchestrationDomainEventsToState(
  state: AppState,
  events: ReadonlyArray<OrchestrationEvent>,
): AppState {
  if (events.length === 0) {
    return state;
  }
  const previousReadModel = state.orchestrationReadModel;
  const coalesced = coalesceOrchestrationUiEvents(events);
  let readModel = previousReadModel;
  for (const event of coalesced) {
    readModel = projectOrchestrationReadModelEvent(readModel, event);
  }
  let nextState: AppState = {
    ...state,
    orchestrationReadModel: readModel,
    threadsHydrated: true,
  };
  nextState = writeProjectCollection(
    nextState,
    readModel.projects.filter((project) => project.deletedAt === null),
  );
  nextState = writeThreadCollectionsFromReadModel(nextState, readModel, previousReadModel);
  return nextState;
}

export function markThreadVisited(
  state: AppState,
  threadId: ThreadId,
  visitedAt?: string,
): AppState {
  const shell = state.threadShellById[threadId];
  if (!shell) return state;
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAtMs = shell.lastVisitedAt ? Date.parse(shell.lastVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }

  return ({
    ...state,
    threadShellById: {
      ...state.threadShellById,
      [threadId]: {
        ...shell,
        lastVisitedAt: at,
      },
    },
  });
}

export function markThreadUnread(state: AppState, threadId: ThreadId): AppState {
  const shell = state.threadShellById[threadId];
  const thread = getThreadFromAssistantState(state, threadId);
  if (!shell || !thread?.latestTurn?.completedAt) return state;
  const latestTurnCompletedAtMs = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) return state;
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (shell.lastVisitedAt === unreadVisitedAt) return state;
  return ({
    ...state,
    threadShellById: {
      ...state.threadShellById,
      [threadId]: {
        ...shell,
        lastVisitedAt: unreadVisitedAt,
      },
    },
  });
}

export function toggleProject(state: AppState, projectId: Project["id"]): AppState {
  const project = state.projectById[projectId];
  if (!project) return state;
  return setProjectExpanded(state, projectId, !project.expanded);
}

export function setProjectExpanded(
  state: AppState,
  projectId: Project["id"],
  expanded: boolean,
): AppState {
  const project = state.projectById[projectId];
  if (!project || project.expanded === expanded) return state;
  return ({
    ...state,
    projectById: {
      ...state.projectById,
      [projectId]: {
        ...project,
        expanded,
      },
    },
  });
}

export function reorderProjects(
  state: AppState,
  draggedProjectId: Project["id"],
  targetProjectId: Project["id"],
): AppState {
  if (draggedProjectId === targetProjectId) return state;
  const draggedIndex = state.projectIds.findIndex((projectId) => projectId === draggedProjectId);
  const targetIndex = state.projectIds.findIndex((projectId) => projectId === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) return state;
  const projectIds = [...state.projectIds];
  const [draggedProject] = projectIds.splice(draggedIndex, 1);
  if (!draggedProject) return state;
  projectIds.splice(targetIndex, 0, draggedProject);
  return ({
    ...state,
    projectIds,
  });
}

export function setError(state: AppState, threadId: ThreadId, error: string | null): AppState {
  const shell = state.threadShellById[threadId];
  if (!shell || shell.error === error) return state;
  return ({
    ...state,
    threadShellById: {
      ...state.threadShellById,
      [threadId]: {
        ...shell,
        error,
      },
    },
  });
}

export function setThreadBranch(
  state: AppState,
  threadId: ThreadId,
  branch: string | null,
  worktreePath: string | null,
): AppState {
  const shell = state.threadShellById[threadId];
  if (!shell) return state;
  if (shell.branch === branch && shell.worktreePath === worktreePath) return state;
  const cwdChanged = shell.worktreePath !== worktreePath;
  return ({
    ...state,
    threadShellById: {
      ...state.threadShellById,
      [threadId]: {
        ...shell,
        branch,
        worktreePath,
      },
    },
    ...(cwdChanged
      ? {
          threadSessionById: {
            ...state.threadSessionById,
            [threadId]: null,
          },
        }
      : {}),
  });
}

// ── Zustand store ────────────────────────────────────────────────────

interface AppStore extends AppState {
  syncServerReadModel: (readModel: OrchestrationReadModel) => void;
  applyOrchestrationDomainEvents: (events: ReadonlyArray<OrchestrationEvent>) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId) => void;
  toggleProject: (projectId: Project["id"]) => void;
  setProjectExpanded: (projectId: Project["id"], expanded: boolean) => void;
  reorderProjects: (draggedProjectId: Project["id"], targetProjectId: Project["id"]) => void;
  setError: (threadId: ThreadId, error: string | null) => void;
  setThreadBranch: (threadId: ThreadId, branch: string | null, worktreePath: string | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  ...readPersistedState(),
  syncServerReadModel: (readModel) => set((state) => syncServerReadModel(state, readModel)),
  applyOrchestrationDomainEvents: (events) =>
    set((state) => applyOrchestrationDomainEventsToState(state, events)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId) => set((state) => markThreadUnread(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  setError: (threadId, error) => set((state) => setError(state, threadId, error)),
  setThreadBranch: (threadId, branch, worktreePath) =>
    set((state) => setThreadBranch(state, threadId, branch, worktreePath)),
}));

// Persist state changes with debouncing to avoid localStorage thrashing
useStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

// Flush pending writes synchronously before page unload to prevent data loss.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}

export function StoreProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    persistState(useStore.getState());
  }, []);
  return createElement(Fragment, null, children);
}
