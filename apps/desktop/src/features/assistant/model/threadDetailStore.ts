import { create } from "zustand";
import { Schema } from "effect";
import {
  type CheckpointRef,
  OrchestrationThread as ThreadSchema,
  OrchestrationMessage as MessageSchema,
  OrchestrationSession as SessionSchema,
  OrchestrationLatestTurn as LatestTurnSchema,
  type OrchestrationMessage,
  type OrchestrationSession,
  type OrchestrationEvent as NativeEvent,
} from "@cozea/contracts/t3";
import {
  applyThreadDetailEvent,
  settleMessageStreams,
  type ThreadDetailState,
  type DetailCheckpoint,
} from "@cozea/client-runtime";
import { markLiveText, markSnapshotText } from "./messageTextArrival";
import type {
  MessageId,
  OrchestrationEvent,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from "@cozea/assistant-contracts";
import type { ChatMessage, ProposedPlan, TurnDiffSummary } from "./types";

export interface ThreadDetailRecord {
  readonly threadId: string;
  readonly loaded: boolean;
  readonly snapshotSequence: number | null;
  readonly canonical: ThreadDetailState;
  readonly lastSequence: number;
  readonly messages: ChatMessage[];
  readonly activities: OrchestrationThreadActivity[];
  readonly proposedPlans: ProposedPlan[];
  readonly turnDiffSummaries: TurnDiffSummary[];
  readonly isStreaming: boolean;
  readonly turnSettled?: boolean;
  readonly error: string | null;
}

interface ThreadDetailStoreState {
  readonly byThreadId: Record<string, ThreadDetailRecord>;
  readonly deletedSequenceByThreadId: Record<string, number>;
  readonly evictedSequenceByThreadId: Record<string, number>;
  getThreadDetail: (threadId: string | null | undefined) => ThreadDetailRecord | null;
  ingestSnapshot: (threadId: string, snapshot: unknown) => void;
  applyEvent: (threadId: string, event: NativeEvent | OrchestrationEvent) => void;
  resetThread: (threadId: string) => void;
}

export interface ThreadDetailCachePolicy {
  readonly maxInactiveEntries: number;
  readonly maxApproximateBytes: number;
}

export interface ThreadDetailCacheDiagnostics {
  readonly retainedEntries: number;
  readonly inactiveEntries: number;
  readonly approximateBytes: number;
  readonly overBudgetWithPinnedEntries: boolean;
}

const DEFAULT_THREAD_DETAIL_CACHE_POLICY: ThreadDetailCachePolicy = {
  maxInactiveEntries: 24,
  maxApproximateBytes: 32 * 1024 * 1024,
};

let threadDetailCachePolicy = DEFAULT_THREAD_DETAIL_CACHE_POLICY;
let accessSequence = 0;
let mappedMessageCount = 0;
const retainCounts = new Map<string, number>();
const lastAccessByThreadId = new Map<string, number>();

function touchThreadDetail(threadId: string): void {
  lastAccessByThreadId.set(threadId, ++accessSequence);
}

function activityRequestId(activity: OrchestrationThreadActivity): string | null {
  const payload = asRecord(activity.payload);
  return typeof payload?.requestId === "string" ? payload.requestId : null;
}

function hasPendingUserAction(record: ThreadDetailRecord): boolean {
  const openApprovals = new Set<string>();
  const openQuestions = new Set<string>();
  for (const activity of record.activities) {
    const requestId = activityRequestId(activity);
    if (!requestId) continue;
    if (activity.kind === "approval.requested") openApprovals.add(requestId);
    else if (activity.kind === "approval.resolved") openApprovals.delete(requestId);
    else if (activity.kind === "user-input.requested") openQuestions.add(requestId);
    else if (activity.kind === "user-input.resolved") openQuestions.delete(requestId);
  }
  return openApprovals.size > 0 || openQuestions.size > 0;
}

function isThreadDetailPinned(threadId: string, record: ThreadDetailRecord): boolean {
  return (
    (retainCounts.get(threadId) ?? 0) > 0 ||
    record.isStreaming ||
    record.canonical.session?.status === "starting" ||
    record.canonical.session?.status === "running" ||
    record.canonical.latestTurn?.state === "running" ||
    hasPendingUserAction(record)
  );
}

function approximateThreadDetailBytes(record: ThreadDetailRecord): number {
  let characters = record.threadId.length + (record.error?.length ?? 0);
  for (const message of record.messages) {
    characters += message.id.length + message.text.length + message.createdAt.length;
    for (const attachment of message.attachments ?? []) {
      characters += attachment.id.length + attachment.name.length + attachment.mimeType.length;
    }
  }
  for (const activity of record.activities) {
    characters += activity.id.length + activity.kind.length + activity.summary.length;
  }
  for (const plan of record.proposedPlans) characters += plan.id.length + plan.planMarkdown.length;
  for (const summary of record.turnDiffSummaries) {
    characters += summary.turnId.length;
    for (const file of summary.files) characters += file.path.length;
  }
  // Most retained payload is JavaScript UTF-16 text. This intentionally stays
  // approximate so cache accounting never serializes activity payloads on the
  // streaming path.
  return characters * 2 + 1024;
}

function trimThreadDetailCache(): void {
  const state = useThreadDetailStore.getState();
  const rows = Object.entries(state.byThreadId).map(([threadId, record]) => ({
    threadId,
    record,
    bytes: approximateThreadDetailBytes(record),
    pinned: isThreadDetailPinned(threadId, record),
    lastAccess: lastAccessByThreadId.get(threadId) ?? 0,
  }));
  let approximateBytes = rows.reduce((total, row) => total + row.bytes, 0);
  let inactiveEntries = rows.filter((row) => !row.pinned).length;
  if (
    inactiveEntries <= threadDetailCachePolicy.maxInactiveEntries &&
    approximateBytes <= threadDetailCachePolicy.maxApproximateBytes
  ) {
    return;
  }

  const candidates = rows.filter((row) => !row.pinned).sort((a, b) => a.lastAccess - b.lastAccess);
  const byThreadId = { ...state.byThreadId };
  const evictedSequenceByThreadId = { ...state.evictedSequenceByThreadId };
  let changed = false;
  for (const candidate of candidates) {
    if (
      inactiveEntries <= threadDetailCachePolicy.maxInactiveEntries &&
      approximateBytes <= threadDetailCachePolicy.maxApproximateBytes
    ) {
      break;
    }
    delete byThreadId[candidate.threadId];
    evictedSequenceByThreadId[candidate.threadId] = Math.max(
      evictedSequenceByThreadId[candidate.threadId] ?? 0,
      candidate.record.lastSequence,
    );
    lastAccessByThreadId.delete(candidate.threadId);
    approximateBytes -= candidate.bytes;
    inactiveEntries -= 1;
    changed = true;
  }
  if (changed) useThreadDetailStore.setState({ byThreadId, evictedSequenceByThreadId });
}

export function retainThreadDetail(threadId: string): () => void {
  retainCounts.set(threadId, (retainCounts.get(threadId) ?? 0) + 1);
  touchThreadDetail(threadId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (retainCounts.get(threadId) ?? 1) - 1;
    if (next > 0) retainCounts.set(threadId, next);
    else retainCounts.delete(threadId);
    touchThreadDetail(threadId);
    trimThreadDetailCache();
  };
}

export function configureThreadDetailCache(
  policy: Partial<ThreadDetailCachePolicy>,
): () => void {
  const previous = threadDetailCachePolicy;
  threadDetailCachePolicy = { ...threadDetailCachePolicy, ...policy };
  trimThreadDetailCache();
  return () => {
    threadDetailCachePolicy = previous;
  };
}

export function getThreadDetailCacheDiagnostics(): ThreadDetailCacheDiagnostics {
  const rows = Object.entries(useThreadDetailStore.getState().byThreadId);
  const inactiveEntries = rows.filter(([threadId, record]) => !isThreadDetailPinned(threadId, record)).length;
  const approximateBytes = rows.reduce(
    (total, [, record]) => total + approximateThreadDetailBytes(record),
    0,
  );
  return {
    retainedEntries: rows.length,
    inactiveEntries,
    approximateBytes,
    overBudgetWithPinnedEntries:
      approximateBytes > threadDetailCachePolicy.maxApproximateBytes && inactiveEntries === 0,
  };
}

export function getThreadDetailProjectionDiagnostics(): { readonly mappedMessageCount: number } {
  return { mappedMessageCount };
}

const EMPTY_THREAD_DETAIL: ThreadDetailRecord = {
  threadId: "",
  lastSequence: 0,
  loaded: false,
  snapshotSequence: null,
  canonical: {
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    latestTurn: null,
  },
  messages: [],
  activities: [],
  proposedPlans: [],
  turnDiffSummaries: [],
  isStreaming: false,
  error: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readSequence(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function sessionIsStreaming(snapshot: Record<string, unknown>, messages: ChatMessage[]): boolean {
  const session = asRecord(snapshot.session);
  if (typeof session?.status === "string") {
    return session.status === "starting" || session.status === "running";
  }
  return messages.some((message) => message.streaming);
}

function sessionError(snapshot: Record<string, unknown>): string | null {
  const session = asRecord(snapshot.session);
  const lastError = session?.lastError;
  if (typeof lastError === "string" && lastError.length > 0) return lastError;

  const errorRecord = asRecord(lastError);
  if (typeof errorRecord?.message === "string" && errorRecord.message.length > 0) {
    return errorRecord.message;
  }
  return null;
}

function mapMessage(raw: unknown): ChatMessage {
  mappedMessageCount += 1;
  const m = raw as Record<string, unknown>;
  const attachments = Array.isArray(m.attachments)
    ? m.attachments.map((a: unknown) => {
        const item = a as Record<string, unknown>;
        return {
          ...(item.type === "image" || item.type === undefined
            ? { type: "image" as const }
            : item.type === "file"
              ? { type: "file" as const }
              : { type: "unsupported" as const, originalType: String(item.type) }),
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
          mimeType: String(item.mimeType ?? "image/png"),
          sizeBytes: Number(item.sizeBytes ?? 0),
          ...(item.type === "image" || item.type === undefined
            ? { previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : undefined }
            : {}),
        };
      })
    : undefined;

  return {
    id: String(m.id ?? m.messageId ?? "") as MessageId,
    role: (m.role ?? "assistant") as "user" | "assistant" | "system",
    text: String(m.text ?? ""),
    ...(attachments !== undefined ? { attachments } : {}),
    turnId: (m.turnId as TurnId | null) ?? null,
    createdAt: String(m.createdAt ?? new Date().toISOString()),
    completedAt: m.streaming
      ? undefined
      : typeof m.updatedAt === "string"
        ? m.updatedAt
        : undefined,
    streaming: Boolean(m.streaming),
  };
}

function mapActivity(raw: unknown): OrchestrationThreadActivity {
  const a = raw as Record<string, unknown>;
  let activityPayload = a.payload;
  if (activityPayload === undefined && typeof a.detailJson === "string") {
    try {
      activityPayload = JSON.parse(a.detailJson);
    } catch {
      activityPayload = {};
    }
  }
  const tone =
    a.tone === "info" || a.tone === "tool" || a.tone === "approval" || a.tone === "error"
      ? a.tone
      : "info";
  return {
    id: String(a.id ?? a.activityId ?? ""),
    turnId: (a.turnId as TurnId | null) ?? null,
    kind: String(a.kind ?? "tool.call"),
    tone,
    summary: String(a.summary ?? ""),
    payload: activityPayload ?? {},
    ...(typeof a.sequence === "number" ? { sequence: a.sequence } : {}),
    createdAt: String(a.createdAt ?? new Date().toISOString()),
  } as OrchestrationThreadActivity;
}

function mapProposedPlan(raw: unknown): ProposedPlan {
  const p = raw as Record<string, unknown>;
  return {
    id: String(p.id ?? p.planId ?? "") as any,
    turnId: (p.turnId as TurnId | null) ?? null,
    planMarkdown: String(p.planMarkdown ?? ""),
    implementedAt: typeof p.implementedAt === "string" ? p.implementedAt : null,
    implementationThreadId:
      typeof p.implementationThreadId === "string" ? (p.implementationThreadId as ThreadId) : null,
    createdAt: String(p.createdAt ?? new Date().toISOString()),
    updatedAt: String(p.updatedAt ?? new Date().toISOString()),
  };
}

function mapTurnDiffSummary(raw: unknown): TurnDiffSummary {
  const c = raw as Record<string, unknown>;
  const rawFiles = Array.isArray(c.files) ? c.files : [];
  const files = rawFiles.map((f: unknown) => {
    const item = f as Record<string, unknown>;
    return {
      path: String(item.path ?? ""),
      kind: typeof item.kind === "string" ? item.kind : undefined,
      additions: typeof item.additions === "number" ? item.additions : undefined,
      deletions: typeof item.deletions === "number" ? item.deletions : undefined,
    };
  });

  return {
    turnId: String(c.turnId ?? "") as TurnId,
    completedAt: String(c.completedAt ?? new Date().toISOString()),
    status: typeof c.status === "string" ? c.status : undefined,
    assistantMessageId:
      typeof c.assistantMessageId === "string" ? (c.assistantMessageId as MessageId) : undefined,
    checkpointTurnCount:
      typeof c.checkpointTurnCount === "number" ? c.checkpointTurnCount : undefined,
    checkpointRef: typeof c.checkpointRef === "string" ? (c.checkpointRef as CheckpointRef) : undefined,
    files,
  };
}

function normalizeMessage(raw: unknown): OrchestrationMessage {
  const m = asRecord(raw) ?? {};
  const parsed = Schema.decodeUnknownSync(MessageSchema)({
    ...m,
    id: m.id ?? m.messageId,
    role: m.role ?? "assistant",
    text: m.text ?? "",
    turnId: m.turnId ?? null,
    streaming: Boolean(m.streaming),
    createdAt: m.createdAt ?? "1970-01-01T00:00:00.000Z",
    updatedAt: m.updatedAt ?? m.createdAt ?? "1970-01-01T00:00:00.000Z",
  });
  return {
    ...parsed,
    ...(parsed.attachments
      ? {
          attachments: parsed.attachments.map((a, i) => {
            const previewUrl = asRecord(
              Array.isArray(m.attachments) ? m.attachments[i] : null,
            )?.previewUrl;
            return a.type === "image" && typeof previewUrl === "string" ? { ...a, previewUrl } : a;
          }),
        }
      : {}),
  };
}

function normalizeSession(raw: unknown, threadId: string): OrchestrationSession | null {
  if (raw == null) return null;
  const session = asRecord(raw) ?? {};
  const error =
    typeof session.lastError === "string"
      ? session.lastError
      : asRecord(session.lastError)?.message;
  return Schema.decodeUnknownSync(SessionSchema)({
    ...session,
    threadId: session.threadId ?? threadId,
    providerName: session.providerName ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: error ?? null,
    updatedAt: session.updatedAt ?? "1970-01-01T00:00:00.000Z",
  });
}

function normalizeCheckpoint(raw: unknown): DetailCheckpoint {
  const checkpoint = mapTurnDiffSummary(raw);
  return {
    ...checkpoint,
    status:
      checkpoint.status === "error" || checkpoint.status === "missing"
        ? checkpoint.status
        : "ready",
    assistantMessageId: checkpoint.assistantMessageId ?? null,
    files: checkpoint.files.map((file) => ({
      ...file,
      kind: file.kind ?? "modified",
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    })),
  };
}

function normalizeSnapshot(raw: Record<string, unknown>, threadId: string): ThreadDetailState {
  // Native snapshots keep their complete typed shell/detail metadata. The
  // explicit legacy branch accepts detail-only snapshots without inventing
  // project/model metadata or checkpoint turn counts.
  if (raw.id !== undefined && raw.projectId !== undefined && raw.modelSelection !== undefined) {
    return Schema.decodeUnknownSync(ThreadSchema)(raw);
  } else {
    return {
      messages: Array.isArray(raw.messages) ? raw.messages.map(normalizeMessage) : [],
      activities: Array.isArray(raw.activities) ? raw.activities.map(mapActivity) : [],
      proposedPlans: Array.isArray(raw.proposedPlans) ? raw.proposedPlans.map(mapProposedPlan) : [],
      checkpoints: Array.isArray(raw.checkpoints)
        ? raw.checkpoints.map(normalizeCheckpoint)
        : Array.isArray(raw.turnDiffSummaries)
          ? raw.turnDiffSummaries.map(normalizeCheckpoint)
          : [],
      session: normalizeSession(raw.session, threadId),
      latestTurn:
        raw.latestTurn == null ? null : Schema.decodeUnknownSync(LatestTurnSchema)(raw.latestTurn),
    };
  }
}

function messageId(raw: OrchestrationMessage): MessageId {
  return raw.id;
}

function project(
  canonical: ThreadDetailState,
  current?: ThreadDetailRecord,
  snapshot = false,
  changedMessageId: string | null = null,
) {
  const unchangedMessages =
    !snapshot && current && canonical.messages === current.canonical.messages;
  let messages: ChatMessage[];
  if (unchangedMessages) {
    messages = current.messages;
  } else if (
    !snapshot &&
    current &&
    changedMessageId !== null &&
    canonical.messages.length >= current.messages.length &&
    canonical.messages.length <= current.messages.length + 1
  ) {
    const currentIndex = current.messages.findIndex((message) => message.id === changedMessageId);
    const canonicalIndex = canonical.messages.findIndex(
      (message) => messageId(message) === changedMessageId,
    );
    const updatesExisting =
      currentIndex >= 0 &&
      canonicalIndex === currentIndex &&
      canonical.messages.length === current.messages.length;
    const appendsNew =
      currentIndex < 0 &&
      canonicalIndex === canonical.messages.length - 1 &&
      canonical.messages.length === current.messages.length + 1;
    if (updatesExisting || appendsNew) {
      const mapped = mapMessage(canonical.messages[canonicalIndex]!);
      markLiveText(mapped, updatesExisting ? current.messages[currentIndex] : undefined);
      messages = updatesExisting
        ? current.messages.map((message, index) => (index === currentIndex ? mapped : message))
        : [...current.messages, mapped];
    } else {
      const previousById = new Map(current.messages.map((message) => [message.id, message]));
      messages = canonical.messages.map((message) => {
        const mapped = mapMessage(message);
        markLiveText(mapped, previousById.get(mapped.id));
        return mapped;
      });
    }
  } else {
    const previousById = new Map(
      !snapshot && current ? current.messages.map((message) => [message.id, message]) : [],
    );
    const previousCanonicalById = new Map(
      !snapshot && current
        ? current.canonical.messages.map((message) => [messageId(message), message])
        : [],
    );
    messages = canonical.messages.map((message) => {
      const previous = !snapshot ? previousById.get(messageId(message)) : undefined;
      if (previous && previousCanonicalById.get(previous.id) === message) {
        return previous;
      }
      const mapped = mapMessage(message);
      if (!snapshot) markLiveText(mapped, previous);
      return mapped;
    });
  }
  if (snapshot) markSnapshotText(messages);
  return {
    messages,
    activities:
      current && canonical.activities === current.canonical.activities
        ? current.activities
        : [...canonical.activities],
    proposedPlans:
      current && canonical.proposedPlans === current.canonical.proposedPlans
        ? current.proposedPlans
        : [...canonical.proposedPlans],
    turnDiffSummaries:
      current && canonical.checkpoints === current.canonical.checkpoints
        ? current.turnDiffSummaries
        : canonical.checkpoints.map(mapTurnDiffSummary),
  };
}

export const useThreadDetailStore = create<ThreadDetailStoreState>((set, get) => ({
  byThreadId: {},
  deletedSequenceByThreadId: {},
  evictedSequenceByThreadId: {},
  getThreadDetail: (threadId) => {
    if (!threadId) return null;
    const detail = get().byThreadId[threadId] ?? null;
    if (detail) touchThreadDetail(threadId);
    return detail;
  },
  ingestSnapshot: (threadId, snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const envelope = asRecord(snapshot)!;
    const snapshotSequence =
      typeof envelope.snapshotSequence === "number"
        ? readSequence(envelope.snapshotSequence)
        : null;
    set((state) => {
      const current = state.byThreadId[threadId];
      const evictedSequence = state.evictedSequenceByThreadId[threadId] ?? 0;
      if (current && snapshotSequence !== null && snapshotSequence < current.lastSequence)
        return state;
      if (!current && snapshotSequence !== null && snapshotSequence < evictedSequence) return state;
      const deletedSequence = state.deletedSequenceByThreadId[threadId];
      if (
        deletedSequence !== undefined &&
        (snapshotSequence === null || snapshotSequence <= deletedSequence)
      )
        return state;
      if ("thread" in envelope && envelope.thread === null) {
        const next = { ...state.byThreadId };
        delete next[threadId];
        return {
          byThreadId: next,
          evictedSequenceByThreadId: state.evictedSequenceByThreadId,
          deletedSequenceByThreadId: {
            ...state.deletedSequenceByThreadId,
            [threadId]: snapshotSequence ?? current?.lastSequence ?? 0,
          },
        };
      }
      const raw = asRecord(envelope.thread) ?? envelope;
      if (typeof raw.id === "string" && raw.id !== threadId) return state;
      let canonical = normalizeSnapshot(raw, threadId);
      if (canonical.session && !["starting", "running"].includes(canonical.session.status)) {
        const latestTurn = canonical.latestTurn?.state === "running"
          ? { ...canonical.latestTurn,
              state: canonical.session.status === "error" ? "error" as const
                : canonical.session.status === "interrupted" || canonical.session.status === "stopped"
                  ? "interrupted" as const : "completed" as const,
              completedAt: canonical.session.updatedAt }
          : canonical.latestTurn;
        canonical = { ...canonical, latestTurn, messages: settleMessageStreams(canonical.messages, null,
          latestTurn?.completedAt ?? canonical.session.updatedAt) };
      }
      const projected = project(canonical, current, true);
      const isStreaming = sessionIsStreaming(raw, projected.messages);
      const deletedSequenceByThreadId = { ...state.deletedSequenceByThreadId };
      delete deletedSequenceByThreadId[threadId];
      const evictedSequenceByThreadId = { ...state.evictedSequenceByThreadId };
      delete evictedSequenceByThreadId[threadId];
      return {
        deletedSequenceByThreadId,
        evictedSequenceByThreadId,
        byThreadId: {
          ...state.byThreadId,
          [threadId]: {
            threadId,
            loaded: true,
            snapshotSequence,
            lastSequence: snapshotSequence ?? current?.lastSequence ?? 0,
            canonical,
            ...projected,
            isStreaming,
            turnSettled: canonical.session !== null && !isStreaming,
            error: sessionError(raw),
          },
        },
      };
    });
    touchThreadDetail(threadId);
    trimThreadDetailCache();
  },
  applyEvent: (threadId, incoming) => {
    set((state) => {
      const current = state.byThreadId[threadId] ?? { ...EMPTY_THREAD_DETAIL, threadId };
      const eventSequence = readSequence(incoming.sequence);
      if (eventSequence > 0 && eventSequence <= current.lastSequence) return state;
      const evictedSequence = state.evictedSequenceByThreadId[threadId] ?? 0;
      if (!state.byThreadId[threadId] && eventSequence > 0 && eventSequence <= evictedSequence)
        return state;
      const deletedSequence = state.deletedSequenceByThreadId[threadId];
      if (
        deletedSequence !== undefined &&
        (incoming.type !== "thread.created" || eventSequence <= deletedSequence)
      )
        return state;
      if (incoming.aggregateId && incoming.aggregateId !== threadId) return state;
      let canonical = current.canonical;
      let event = incoming;
      let changedMessageId: string | null = null;
      // Explicit compatibility defaults for the old substrate's partial events.
      switch (event.type) {
        case "thread.archived":
          event = {
            ...event,
            payload: {
              ...event.payload,
              updatedAt:
                "updatedAt" in event.payload ? event.payload.updatedAt : event.payload.archivedAt,
            },
          };
          break;
        case "thread.unarchived":
          event = {
            ...event,
            payload: {
              ...event.payload,
              updatedAt: "updatedAt" in event.payload ? event.payload.updatedAt : event.occurredAt,
            },
          };
          break;
        case "thread.message-sent": {
          const message = normalizeMessage(event.payload);
          changedMessageId = message.id;
          event = { ...event, payload: { ...event.payload, ...message, messageId: message.id } };
          break;
        }
        case "thread.activity-appended":
          event = {
            ...event,
            payload: {
              ...event.payload,
              activity: mapActivity(event.payload.activity ?? event.payload),
            },
          };
          break;
        case "thread.session-set": {
          const session = normalizeSession(event.payload.session, threadId);
          if (session === null) throw new Error("Session-set requires a session");
          event = {
            ...event,
            payload: {
              ...event.payload,
              session,
            },
          };
          break;
        }
      }
      const result = applyThreadDetailEvent(canonical, event);
      if (result.kind === "deleted") {
        const next = { ...state.byThreadId };
        delete next[threadId];
        return {
          byThreadId: next,
          evictedSequenceByThreadId: state.evictedSequenceByThreadId,
          deletedSequenceByThreadId: {
            ...state.deletedSequenceByThreadId,
            [threadId]: eventSequence,
          },
        };
      }
      if (result.kind === "updated") canonical = result.thread;
      let { isStreaming, turnSettled, error } = current;
      if (event.type === "thread.turn-start-requested") {
        isStreaming = true;
        turnSettled = false;
        error = null;
        // Only legacy sessions lack turn identity; native ownership remains intact.
        if (canonical.session?.activeTurnId == null) canonical = { ...canonical, session: null };
      } else if (event.type === "thread.session-set") {
        isStreaming =
          event.payload.session.status === "starting" || event.payload.session.status === "running";
        turnSettled = !isStreaming;
        error = event.payload.session.lastError;
      } else if (
        event.type === "thread.session-stop-requested" ||
        (event.type === "thread.turn-interrupt-requested" &&
          canonical.latestTurn?.state === "interrupted")
      ) {
        isStreaming = false;
        turnSettled = true;
      } else if (event.type === "thread.message-sent") {
        if (turnSettled && canonical.messages.some((m) => m.streaming)) {
          canonical = {
            ...canonical,
            messages: canonical.messages.map((m) => (m.streaming ? { ...m, streaming: false } : m)),
          };
        }
        isStreaming ||= !turnSettled && canonical.messages.some((m) => m.streaming);
      }
      const deletedSequenceByThreadId = { ...state.deletedSequenceByThreadId };
      delete deletedSequenceByThreadId[threadId];
      const evictedSequenceByThreadId = { ...state.evictedSequenceByThreadId };
      delete evictedSequenceByThreadId[threadId];
      return {
        deletedSequenceByThreadId,
        evictedSequenceByThreadId,
        byThreadId: {
          ...state.byThreadId,
          [threadId]: {
            ...current,
            canonical,
            ...project(canonical, current, false, changedMessageId),
            lastSequence: Math.max(current.lastSequence, eventSequence),
            isStreaming,
            turnSettled,
            error,
          },
        },
      };
    });
    touchThreadDetail(threadId);
    trimThreadDetailCache();
  },
  resetThread: (threadId) =>
    set((state) => {
      const next = { ...state.byThreadId };
      delete next[threadId];
      const deletedSequenceByThreadId = { ...state.deletedSequenceByThreadId };
      delete deletedSequenceByThreadId[threadId];
      const evictedSequenceByThreadId = { ...state.evictedSequenceByThreadId };
      delete evictedSequenceByThreadId[threadId];
      lastAccessByThreadId.delete(threadId);
      retainCounts.delete(threadId);
      return { byThreadId: next, deletedSequenceByThreadId, evictedSequenceByThreadId };
    }),
}));
