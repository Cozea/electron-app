import { create } from "zustand";
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
  messages: [],
  activities: [],
  proposedPlans: [],
  turnDiffSummaries: [],
  isStreaming: false,
  error: null,
};

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
  return {
    id: String(a.id ?? a.activityId ?? ""),
    turnId: (a.turnId as TurnId | null) ?? null,
    kind: String(a.kind ?? "tool.call"),
    summary: String(a.summary ?? ""),
    detailJson: typeof a.detailJson === "string" ? a.detailJson : null,
    createdAt: String(a.createdAt ?? new Date().toISOString()),
  } as unknown as OrchestrationThreadActivity;
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
    const snap = snapshot as Record<string, unknown>;

    const messages = Array.isArray(snap.messages) ? snap.messages.map(mapMessage) : [];
    const activities = Array.isArray(snap.activities) ? snap.activities.map(mapActivity) : [];
    const proposedPlans = Array.isArray(snap.proposedPlans) ? snap.proposedPlans.map(mapProposedPlan) : [];
    const turnDiffSummaries = Array.isArray(snap.checkpoints)
      ? snap.checkpoints.map(mapTurnDiffSummary)
      : Array.isArray(snap.turnDiffSummaries)
        ? snap.turnDiffSummaries.map(mapTurnDiffSummary)
        : [];

    set((state) => ({
      byThreadId: {
        ...state.byThreadId,
        [threadId]: {
          threadId,
          messages,
          activities,
          proposedPlans,
          turnDiffSummaries,
          isStreaming: false,
          error: null,
        },
      },
    }));
  },

  applyEvent: (threadId, event) => {
    set((state) => {
      const current = state.byThreadId[threadId] ?? {
        ...EMPTY_THREAD_DETAIL,
        threadId,
      };

      const payload = (event as unknown as { payload: Record<string, unknown> }).payload ?? {};

      switch (event.type) {
        case "thread.message-sent": {
          const messageId = String(payload.messageId ?? "");
          const isStreaming = Boolean(payload.streaming);
          const chunkText = String(payload.text ?? "");
          const role = (payload.role ?? "assistant") as "user" | "assistant" | "system";

          const existingIndex = current.messages.findIndex((m) => m.id === messageId);

          let nextMessages: ChatMessage[];
          if (existingIndex >= 0) {
            const existing = current.messages[existingIndex]!;
            const updated: ChatMessage = {
              ...existing,
              text: existing.text + chunkText,
              streaming: isStreaming,
              completedAt: isStreaming ? undefined : typeof payload.updatedAt === "string" ? payload.updatedAt : existing.completedAt,
            };
            nextMessages = current.messages.map((m, idx) => (idx === existingIndex ? updated : m));
          } else {
            const newMsg: ChatMessage = {
              id: messageId as MessageId,
              role,
              text: chunkText,
              turnId: (payload.turnId as TurnId | null) ?? null,
              createdAt: String(payload.createdAt ?? new Date().toISOString()),
              streaming: isStreaming,
            };
            nextMessages = [...current.messages, newMsg];
          }

          return {
            byThreadId: {
              ...state.byThreadId,
              [threadId]: {
                ...current,
                messages: nextMessages,
                isStreaming,
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
                turnDiffSummaries: [
                  ...current.turnDiffSummaries.filter((d) => d.turnId !== diffSummary.turnId),
                  diffSummary,
                ],
                isStreaming: false,
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
                isStreaming: true,
                error: null,
              },
            },
          };
        }

        default:
          return state;
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
