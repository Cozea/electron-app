import type {
  ContextMenuItem,
  ModelSelection,
  ProviderKind,
  ProviderInteractionMode,
  RuntimeMode,
  ServerProvider,
} from "@cozea/assistant-contracts";
import { ThreadId } from "@cozea/assistant-contracts";
import type { AppState } from "@/features/assistant/model/assistantStore";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@/features/assistant/chat/session-logic";
import type {
  AssistantConversationContext,
  AssistantProjectAssociation,
} from "./assistantHistoryStore";
import { hasDraftContent, type AssistantContentDraft } from "./assistantDraftRepository";

export interface AssistantHistoryEntry {
  id: string;
  threadId: string | null;
  draftId: string;
  assistantProjectId: string | null;
  title: string;
  updatedAt: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  context: AssistantConversationContext;
  status: string;
  instanceLabel?: string;
}

export function historyHasPendingRequests(state: AppState, threadId: string): boolean {
  const raw = state.orchestrationReadModel?.threads.find((thread) => thread.id === threadId) as
    | { hasPendingApprovals?: boolean; hasPendingUserInput?: boolean }
    | undefined;
  const activities = Object.values(state.activityByThreadId[ThreadId.makeUnsafe(threadId)] ?? {});
  return Boolean(
    raw?.hasPendingApprovals ||
    raw?.hasPendingUserInput ||
    derivePendingApprovals(activities).length ||
    derivePendingUserInputs(activities).length,
  );
}

export function selectAssistantHistory(input: {
  projectId: string;
  provider: ProviderKind;
  state: AppState;
  projects: Record<string, AssistantProjectAssociation>;
  conversations: Record<string, AssistantProjectAssociation>;
  drafts: Record<string, AssistantContentDraft>;
  providers?: readonly ServerProvider[];
}): AssistantHistoryEntry[] {
  const entries: AssistantHistoryEntry[] = [];
  for (const thread of Object.values(input.state.threadShellById)) {
    const context = input.conversations[thread.id] ?? input.projects[thread.projectId];
    if (!context || context.projectId !== input.projectId) continue;
    const instance = input.providers?.find(
      (candidate) => candidate.instanceId === thread.modelSelection.instanceId,
    );
    const provider =
      thread.modelSelection.provider ??
      instance?.provider ??
      instance?.driver ??
      context.provider ??
      thread.modelSelection.instanceId;
    if (provider !== input.provider) continue;
    const raw = input.state.orchestrationReadModel?.threads.find(
      (candidate) => candidate.id === thread.id,
    );
    if (raw?.deletedAt || (raw as { archivedAt?: string } | undefined)?.archivedAt) continue;
    const session = input.state.threadSessionById[thread.id];
    const awaiting = historyHasPendingRequests(input.state, thread.id);
    const draft = input.drafts[`thread:${thread.id}`];
    const pendingDraft = draft && hasDraftContent(draft);
    entries.push({
      id: `thread:${thread.id}`,
      threadId: thread.id,
      draftId: `history:${thread.id}`,
      assistantProjectId: thread.projectId,
      title: thread.title,
      updatedAt:
        pendingDraft && draft.updatedAt > (thread.updatedAt ?? thread.createdAt)
          ? draft.updatedAt
          : (thread.updatedAt ?? thread.createdAt),
      modelSelection: {
        ...(draft?.modelSelection ?? thread.modelSelection),
        provider: input.provider,
      },
      runtimeMode: draft?.runtimeMode ?? thread.runtimeMode,
      interactionMode: draft?.interactionMode ?? thread.interactionMode,
      instanceLabel: instance?.displayName ?? instance?.badgeLabel,
      context: {
        ...context,
        rootPath: thread.worktreePath ?? context.rootPath,
        branch: thread.branch ?? context.branch,
      },
      status: awaiting
        ? "Needs attention"
        : session?.orchestrationStatus === "running"
          ? "Running"
          : pendingDraft
            ? "Draft"
            : "",
    });
  }
  for (const draft of Object.values(input.drafts)) {
    if (
      draft.threadId ||
      draft.projectId !== input.projectId ||
      draft.modelSelection.provider !== input.provider ||
      !hasDraftContent(draft)
    )
      continue;
    entries.push({
      id: draft.key,
      threadId: null,
      draftId: draft.key.slice("draft:".length),
      assistantProjectId: draft.assistantProjectId,
      title: draft.text.trim().split("\n")[0] || "Unsent attachments",
      updatedAt: draft.updatedAt,
      modelSelection: draft.modelSelection,
      runtimeMode: draft.runtimeMode,
      interactionMode: draft.interactionMode,
      context: draft,
      status: "Draft",
    });
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export const HISTORY_PAGE_SIZE = 20;
export function buildAssistantHistoryMenu(
  entries: readonly AssistantHistoryEntry[],
  page: number,
  currentId: string,
  rootPath: string,
): ContextMenuItem[] {
  const lastPage = Math.max(0, Math.ceil(entries.length / HISTORY_PAGE_SIZE) - 1);
  const currentPage = Math.min(Math.max(0, page), lastPage);
  const instances = new Set(entries.map((entry) => entry.modelSelection.instanceId));
  return [
    { id: "new", label: "New chat" },
    { id: "separator", type: "separator" },
    ...entries.slice(currentPage * HISTORY_PAGE_SIZE, (currentPage + 1) * HISTORY_PAGE_SIZE).map(
      (entry): ContextMenuItem => ({
        id: entry.id,
        type: "checkbox",
        checked: currentId === entry.id,
        label: entry.title.slice(0, 80),
        sublabel: [
          entry.status,
          new Date(entry.updatedAt).toLocaleDateString(),
          instances.size > 1
            ? (entry.instanceLabel ?? String(entry.modelSelection.instanceId))
            : "",
          entry.context.branch,
          entry.context.rootPath !== rootPath ? entry.context.rootPath : "",
        ]
          .filter(Boolean)
          .join(" · "),
      }),
    ),
    ...(entries.length ? [] : [{ id: "empty", label: "No conversations yet", enabled: false }]),
    ...(currentPage > 0 ? [{ id: "newer", label: "Newer conversations…" }] : []),
    ...(currentPage < lastPage ? [{ id: "older", label: "Older conversations…" }] : []),
  ];
}

export function historyPlacement(input: {
  currentThreadId: string | null;
  currentDraftId: string;
  target: AssistantHistoryEntry;
  existingTileId: string | null;
  busy: boolean;
}): "current" | "focus" | "replace" | "tab" {
  if (
    input.target.threadId
      ? input.target.threadId === input.currentThreadId
      : input.target.draftId === input.currentDraftId && !input.currentThreadId
  )
    return "current";
  if (input.existingTileId) return "focus";
  return input.busy ? "tab" : "replace";
}
