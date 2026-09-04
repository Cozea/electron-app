import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ProviderKind } from "@cozea/assistant-contracts";

import type { AppState } from "@/features/assistant/model/assistantStore";
import type { WorkbenchProjectState } from "@/lib/workbenchStore";

export interface AssistantConversationContext {
  projectId: string;
  workspaceId: string;
  laneId: string;
  rootPath: string;
  branch: string | null;
}

export interface AssistantProjectAssociation extends AssistantConversationContext {
  assistantProjectId: string;
  provider?: ProviderKind;
}

interface AssistantHistoryState {
  projects: Record<string, AssistantProjectAssociation>;
  conversations: Record<string, AssistantProjectAssociation>;
  rememberProject: (association: AssistantProjectAssociation) => boolean;
  rememberConversation: (threadId: string, association: AssistantProjectAssociation) => void;
  forgetConversation: (threadId: string) => void;
  forgetProject: (projectId: string) => void;
}

export const useAssistantHistoryStore = create<AssistantHistoryState>()(
  persist(
    (set, get) => ({
      projects: {},
      conversations: {},
      rememberProject: (association) => {
        const previous = get().projects[association.assistantProjectId];
        // A runtime identity cannot silently move between Cozea projects.
        if (previous && previous.projectId !== association.projectId) return false;
        if (!previous)
          set((state) => ({
            projects: { ...state.projects, [association.assistantProjectId]: association },
          }));
        return true;
      },
      rememberConversation: (threadId, association) => {
        if (!get().rememberProject(association)) return;
        const previous = get().conversations[threadId];
        if (previous) {
          if (!previous.provider && association.provider)
            set((state) => ({
              conversations: {
                ...state.conversations,
                [threadId]: { ...previous, provider: association.provider },
              },
            }));
          return; // Preserve the originating checkout, not the latest viewing tile.
        }
        set((state) => ({ conversations: { ...state.conversations, [threadId]: association } }));
      },
      forgetConversation: (threadId) =>
        set((state) => {
          const conversations = { ...state.conversations };
          delete conversations[threadId];
          return { conversations };
        }),
      forgetProject: (projectId) =>
        set((state) => ({
          projects: Object.fromEntries(
            Object.entries(state.projects).filter(([, value]) => value.projectId !== projectId),
          ),
          conversations: Object.fromEntries(
            Object.entries(state.conversations).filter(
              ([, value]) => value.projectId !== projectId,
            ),
          ),
        })),
    }),
    {
      name: "cozea:assistant-history-associations:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ projects, conversations }) => ({ projects, conversations }),
    },
  ),
);

/** Exact, catalog-backed matches only. Never infer ownership from a repo URL/name. */
export function backfillAssistantHistory(
  state: AppState,
  contexts: readonly AssistantConversationContext[],
  workbenches: Record<string, WorkbenchProjectState>,
): void {
  const history = useAssistantHistoryStore.getState();
  for (const runtimeProject of Object.values(state.projectById)) {
    const candidates = contexts.filter((context) => context.rootPath === runtimeProject.cwd);
    if (new Set(candidates.map((candidate) => candidate.projectId)).size !== 1) continue;
    const context = candidates[0];
    if (!context) continue;
    const association = { ...context, assistantProjectId: runtimeProject.id };
    if (!history.rememberProject(association)) continue;
    for (const threadId of state.threadIdsByProjectId[runtimeProject.id] ?? []) {
      const thread = state.threadShellById[threadId];
      if (!thread) continue;
      const executionRoot = thread.worktreePath ?? runtimeProject.cwd;
      const executionContexts = contexts.filter(
        (candidate) =>
          candidate.projectId === context.projectId && candidate.rootPath === executionRoot,
      );
      const tiles = Object.values(workbenches).flatMap((bench) =>
        bench.projectId === context.projectId
          ? Object.values(bench.tiles).flatMap((tile) =>
              tile.type === "assistantChat" &&
              tile.threadId === threadId &&
              tile.assistantProjectId === runtimeProject.id &&
              executionContexts.some((candidate) => candidate.workspaceId === bench.workspaceId)
                ? [
                    {
                      ...association,
                      workspaceId: bench.workspaceId ?? context.workspaceId,
                      laneId: bench.laneId,
                      provider: tile.provider ?? undefined,
                    },
                  ]
                : [],
            )
          : [],
      );
      const origin = tiles[0] ?? { ...association, ...executionContexts[0] };
      history.rememberConversation(threadId, {
        ...origin,
        rootPath: thread.worktreePath ?? origin.rootPath,
        branch: thread.branch ?? null,
      });
    }
  }
}

export function conversationContextMatches(
  origin: AssistantConversationContext,
  current: AssistantConversationContext,
): boolean {
  return (
    origin.projectId === current.projectId &&
    origin.workspaceId === current.workspaceId &&
    origin.rootPath === current.rootPath &&
    (!origin.branch || origin.branch === current.branch)
  );
}
