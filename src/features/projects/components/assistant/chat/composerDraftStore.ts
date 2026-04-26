import { type ModelSelection, type ProviderInteractionMode, type RuntimeMode } from "@cozea/assistant-contracts"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export interface AssistantComposerDraftState {
  modelSelection?: ModelSelection
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
}

interface AssistantComposerDraftStoreState {
  draftsByTargetKey: Record<string, AssistantComposerDraftState>
  upsertDraft: (targetKey: string, patch: AssistantComposerDraftState) => void
  adoptDraft: (fromTargetKey: string, toTargetKey: string) => void
  clearDraft: (targetKey: string) => void
}

export const useAssistantComposerDraftStore = create<AssistantComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByTargetKey: {},
      upsertDraft: (targetKey, patch) => {
        if (!targetKey) {
          return
        }
        set((state) => ({
          draftsByTargetKey: {
            ...state.draftsByTargetKey,
            [targetKey]: {
              ...state.draftsByTargetKey[targetKey],
              ...patch,
            },
          },
        }))
      },
      adoptDraft: (fromTargetKey, toTargetKey) => {
        if (!fromTargetKey || !toTargetKey || fromTargetKey === toTargetKey) {
          return
        }
        const existingDraft = get().draftsByTargetKey[fromTargetKey]
        if (!existingDraft) {
          return
        }
        set((state) => {
          const nextDrafts = { ...state.draftsByTargetKey }
          nextDrafts[toTargetKey] = {
            ...nextDrafts[toTargetKey],
            ...existingDraft,
          }
          delete nextDrafts[fromTargetKey]
          return { draftsByTargetKey: nextDrafts }
        })
      },
      clearDraft: (targetKey) => {
        if (!targetKey) {
          return
        }
        set((state) => {
          if (!(targetKey in state.draftsByTargetKey)) {
            return state
          }
          const nextDrafts = { ...state.draftsByTargetKey }
          delete nextDrafts[targetKey]
          return { draftsByTargetKey: nextDrafts }
        })
      },
    }),
    {
      name: "cozea:assistant-composer-drafts:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        draftsByTargetKey: state.draftsByTargetKey,
      }),
    },
  ),
)

export function getAssistantComposerDraft(targetKey: string | null | undefined) {
  if (!targetKey) {
    return null
  }
  return useAssistantComposerDraftStore.getState().draftsByTargetKey[targetKey] ?? null
}
