import { create } from "zustand";
import { markLiveText, markSnapshotText } from "./messageTextArrival";
import type {
  MessageId,
  OrchestrationEvent,
  OrchestrationThreadActivity,
  ThreadId,
  TurnId,
} from "@cozea/assistant-contracts";
import type {
  ChatMessage,
  ProposedPlan,
  TurnDiffSummary,
} from "./types";

export interface ThreadDetailRecord {
  readonly threadId: string;
  readonly lastSequence: number;
  readonly messages: ChatMessage[];
  readonly activities: OrchestrationThreadActivity[];
  readonly proposedPlans: ProposedPlan[];
  readonly turnDiffSummaries: TurnDiffSummary[];
  readonly isStreaming: boolean;
  readonly error: string | null;
}

interface ThreadDetailStoreState {
  readonly byThreadId: Record<string, ThreadDetailRecord>;
  getThreadDetail: (threadId: string | null | undefined) => ThreadDetailRecord | null;
  ingestSnapshot: (threadId: string, snapshot: unknown) => void;
  applyEvent: (threadId: string, event: OrchestrationEvent) => void;
  resetThread: (threadId: string) => void;
}

const EMPTY_THREAD_DETAIL: ThreadDetailRecord = {
  threadId: "",
  lastSequence: 0,
  messages: [],
  activities: [],
  proposedPlans: [],
  turnDiffSummaries: [],
  isStreaming: false,
  error: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readSequence(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function sessionIsStreaming(snapshot: Record<string, unknown>, messages: ChatMessage[]): boolean {
  if (messages.some((message) => message.streaming)) return true;

  const session = asRecord(snapshot.session);
  return session?.status === "starting" || session?.status === "running";
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
  const m = raw as Record<string, unknown>;
  const attachments = Array.isArray(m.attachments)
    ? m.attachments.map((a: unknown) => {
        const item = a as Record<string, unknown>;
        return {
          type: "image" as const,
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
          mimeType: String(item.mimeType ?? "image/png"),
          sizeBytes: Number(item.sizeBytes ?? 0),
          previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : undefined,
        };
      })
    : undefined;

  return {
    id: String(m.id ?? m.messageId ?? "") as MessageId,
    role: (m.role ?? "assistant") as "user" | "assistant" | "system",
    text: String(m.text ?? ""),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    turnId: (m.turnId as TurnId | null) ?? null,
    createdAt: String(m.createdAt ?? new Date().toISOString()),
    completedAt: m.streaming ? undefined : typeof m.updatedAt === "string" ? m.updatedAt : undefined,
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
    implementationThreadId: typeof p.implementationThreadId === "string" ? (p.implementationThreadId as ThreadId) : null,
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
    assistantMessageId: typeof c.assistantMessageId === "string" ? (c.assistantMessageId as MessageId) : undefined,
    checkpointTurnCount: typeof c.checkpointTurnCount === "number" ? c.checkpointTurnCount : undefined,
    checkpointRef: typeof c.checkpointRef === "string" ? (c.checkpointRef as any) : undefined,
    files,
  };
}

export const useThreadDetailStore = create<ThreadDetailStoreState>((set, get) => ({
  byThreadId: {},

  getThreadDetail: (threadId) => {
    if (!threadId) return null;
    return get().byThreadId[threadId] ?? null;
  },

  ingestSnapshot: (threadId, snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const envelope = snapshot as Record<string, unknown>;
    // T3 wraps thread detail as { snapshotSequence, thread }. Accept the old
    // direct-thread shape too so the store remains compatible with substrate.
    const snap = asRecord(envelope.thread) ?? envelope;
    const hasSnapshotSequence = typeof envelope.snapshotSequence === "number";
    const snapshotSequence = readSequence(envelope.snapshotSequence);

    const messages = Array.isArray(snap.messages) ? snap.messages.map(mapMessage) : [];
    const activities = Array.isArray(snap.activities) ? snap.activities.map(mapActivity) : [];
    const proposedPlans = Array.isArray(snap.proposedPlans) ? snap.proposedPlans.map(mapProposedPlan) : [];
    const turnDiffSummaries = Array.isArray(snap.checkpoints)
      ? snap.checkpoints.map(mapTurnDiffSummary)
      : Array.isArray(snap.turnDiffSummaries)
        ? snap.turnDiffSummaries.map(mapTurnDiffSummary)
        : [];

    set((state) => {
      const current = state.byThreadId[threadId];
      if (current && hasSnapshotSequence && snapshotSequence < current.lastSequence) {
        return state;
      }

      markSnapshotText(messages);

      return {
        byThreadId: {
          ...state.byThreadId,
          [threadId]: {
            threadId,
            lastSequence: hasSnapshotSequence
              ? snapshotSequence
              : (current?.lastSequence ?? 0),
            messages,
            activities,
            proposedPlans,
            turnDiffSummaries,
            isStreaming: sessionIsStreaming(snap, messages),
            error: sessionError(snap),
          },
        },
      };
    });
  },

  applyEvent: (threadId, event) => {
    set((state) => {
      const current = state.byThreadId[threadId] ?? {
        ...EMPTY_THREAD_DETAIL,
        threadId,
      };
      const eventSequence = readSequence(event.sequence);
      if (eventSequence > 0 && eventSequence <= current.lastSequence) {
        return state;
      }

      const payload = (event as unknown as { payload: Record<string, unknown> }).payload ?? {};
      const lastSequence = Math.max(current.lastSequence, eventSequence);

      switch (event.type) {
        case "thread.message-sent": {
          const messageId = String(payload.messageId ?? "");
          const isStreaming = Boolean(payload.streaming);
          const chunkText = String(payload.text ?? "");
          const incomingMessage = mapMessage({ ...payload, id: messageId });

          const existingIndex = current.messages.findIndex((m) => m.id === messageId);

          let nextMessages: ChatMessage[];
          if (existingIndex >= 0) {
            const existing = current.messages[existingIndex]!;
            const updated: ChatMessage = {
              ...existing,
              text: isStreaming
                ? existing.text + chunkText
                : chunkText.length > 0
                  ? chunkText
                  : existing.text,
              streaming: isStreaming,
              completedAt: isStreaming ? undefined : typeof payload.updatedAt === "string" ? payload.updatedAt : existing.completedAt,
              ...(incomingMessage.attachments !== undefined
                ? { attachments: incomingMessage.attachments }
                : {}),
            };
            markLiveText(updated, existing);
            nextMessages = current.messages.map((m, idx) => (idx === existingIndex ? updated : m));
          } else {
            markLiveText(incomingMessage);
            nextMessages = [...current.messages, incomingMessage];
          }

          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                messages: nextMessages,
                // `streaming` belongs to this individual message segment, not
                // the whole turn. T3 can finalize an assistant preamble and
                // then keep the turn alive while a tool runs. Only terminal
                // turn/session events should clear the aggregate busy state.
                isStreaming: current.isStreaming || isStreaming,
              },
            },
          };
        }

        case "thread.activity-appended": {
          const activity = mapActivity(payload.activity ?? payload);
          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                activities: [...current.activities, activity],
              },
            },
          };
        }

        case "thread.turn-diff-completed": {
          const diffSummary = mapTurnDiffSummary(payload);
          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                turnDiffSummaries: [
                  ...current.turnDiffSummaries.filter((d) => d.turnId !== diffSummary.turnId),
                  diffSummary,
                ],
              },
            },
          };
        }

        case "thread.turn-start-requested": {
          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                isStreaming: true,
                error: null,
              },
            },
          };
        }

        case "thread.session-set": {
          const session = asRecord(payload.session);
          const status = session?.status;
          const lastError = session?.lastError;
          const errorRecord = asRecord(lastError);
          const error = typeof lastError === "string"
            ? lastError
            : typeof errorRecord?.message === "string"
              ? errorRecord.message
              : null;
          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                isStreaming: status === "starting" || status === "running",
                error,
              },
            },
          };
        }

        case "thread.session-stop-requested": {
          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                lastSequence,
                isStreaming: false,
              },
            },
          };
        }

        default:
          return eventSequence > current.lastSequence
            ? {
                byThreadId: {
                  ...state.byThreadId,
                  [threadId]: {
                    ...current,
                    lastSequence,
                  },
                },
              }
            : state;
      }
    });
  },

  resetThread: (threadId) => {
    set((state) => {
      const next = { ...state.byThreadId };
      delete next[threadId];
      return { byThreadId: next };
    });
  },
}));
