import { type ModelSelection, type ProviderInteractionMode, type RuntimeMode } from "@cozea/assistant-contracts"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { ReviewCommentContext } from "./reviewCommentContext"
import { type ElementContextDraft, elementContextDedupKey } from "@/features/browser/elementContext"

export interface AssistantComposerDraftState {
  modelSelection?: ModelSelection
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
  reviewComments?: ReadonlyArray<ReviewCommentContext>
  elementContexts?: ReadonlyArray<ElementContextDraft>
}

interface AssistantComposerDraftStoreState {
  draftsByTargetKey: Record<string, AssistantComposerDraftState>
  lastModelSelectionByInstanceId: Record<string, ModelSelection>
  upsertDraft: (targetKey: string, patch: AssistantComposerDraftState) => void
  adoptDraft: (fromTargetKey: string, toTargetKey: string) => void
  clearDraft: (targetKey: string) => void
  clearDrafts: (targetKeys: readonly string[]) => void
  addReviewComment: (targetKey: string, comment: ReviewCommentContext) => void
  removeReviewComment: (targetKey: string, commentId: string) => void
  clearReviewComments: (targetKey: string) => void
  addElementContext: (targetKey: string, context: ElementContextDraft) => void
  removeElementContext: (targetKey: string, contextId: string) => void
  clearElementContexts: (targetKey: string) => void
}

export const useAssistantComposerDraftStore = create<AssistantComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByTargetKey: {},
      lastModelSelectionByInstanceId: {},
      upsertDraft: (targetKey, patch) => {
        if (!targetKey) {
          return
        }
        set((state) => {
          const modelSelection = patch.modelSelection
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...state.draftsByTargetKey[targetKey],
                ...patch,
              },
            },
            ...(modelSelection
              ? {
                  lastModelSelectionByInstanceId: {
                    ...state.lastModelSelectionByInstanceId,
                    [modelSelection.instanceId]: modelSelection,
                  },
                }
              : {}),
          }
        })
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
      clearDrafts: (targetKeys) => {
        const keysToClear = new Set(targetKeys.filter(Boolean))
        if (keysToClear.size === 0) {
          return
        }
        set((state) => {
          const nextDrafts = { ...state.draftsByTargetKey }
          let changed = false
          for (const targetKey of keysToClear) {
            if (!(targetKey in nextDrafts)) continue
            delete nextDrafts[targetKey]
            changed = true
          }
          return changed ? { draftsByTargetKey: nextDrafts } : state
        })
      },
      addReviewComment: (targetKey, comment) => {
        if (!targetKey || !comment) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey] ?? {}
          const existingComments = existing.reviewComments ?? []
          const filtered = existingComments.filter((entry) => entry.id !== comment.id)
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                reviewComments: [...filtered, { ...comment }],
              },
            },
          }
        })
      },
      removeReviewComment: (targetKey, commentId) => {
        if (!targetKey || !commentId) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey]
          if (!existing || !existing.reviewComments) return state
          const filtered = existing.reviewComments.filter((entry) => entry.id !== commentId)
          if (filtered.length === existing.reviewComments.length) return state
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                reviewComments: filtered,
              },
            },
          }
        })
      },
      clearReviewComments: (targetKey) => {
        if (!targetKey) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey]
          if (!existing || !existing.reviewComments || existing.reviewComments.length === 0) {
            return state
          }
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                reviewComments: [],
              },
            },
          }
        })
      },
      addElementContext: (targetKey, context) => {
        if (!targetKey || !context) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey] ?? {}
          const existingContexts = existing.elementContexts ?? []
          const dedupKey = elementContextDedupKey(context)
          if (existingContexts.some((entry) => elementContextDedupKey(entry) === dedupKey)) {
            return state
          }
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                elementContexts: [...existingContexts, { ...context }],
              },
            },
          }
        })
      },
      removeElementContext: (targetKey, contextId) => {
        if (!targetKey || !contextId) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey]
          if (!existing || !existing.elementContexts) return state
          const filtered = existing.elementContexts.filter((entry) => entry.id !== contextId)
          if (filtered.length === existing.elementContexts.length) return state
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                elementContexts: filtered,
              },
            },
          }
        })
      },
      clearElementContexts: (targetKey) => {
        if (!targetKey) return
        set((state) => {
          const existing = state.draftsByTargetKey[targetKey]
          if (!existing || !existing.elementContexts || existing.elementContexts.length === 0) {
            return state
          }
          return {
            draftsByTargetKey: {
              ...state.draftsByTargetKey,
              [targetKey]: {
                ...existing,
                elementContexts: [],
              },
            },
          }
        })
      },
    }),
    {
      name: "cozea:assistant-composer-drafts:v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        draftsByTargetKey: state.draftsByTargetKey,
        lastModelSelectionByInstanceId: state.lastModelSelectionByInstanceId,
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
