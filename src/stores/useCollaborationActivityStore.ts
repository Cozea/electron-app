// @ts-nocheck
import { create } from "zustand"

const TYPING_IDLE_MS = 2500

let monacoTypingTimer: ReturnType<typeof setTimeout> | null = null
let aiTypingTimer: ReturnType<typeof setTimeout> | null = null

interface CollaborationActivityState {
  isMonacoTyping: boolean
  isAiTyping: boolean
  isAgentWorking: boolean
  lastActivityAt: number
  actions: {
    pingMonacoTyping: () => void
    pingAiTyping: () => void
    setAgentWorking: (isWorking: boolean) => void
    reset: () => void
  }
}

function nowTimestamp(): number {
  return Date.now()
}

export const useCollaborationActivityStore = create<CollaborationActivityState>(
  (set) => ({
    isMonacoTyping: false,
    isAiTyping: false,
    isAgentWorking: false,
    lastActivityAt: 0,
    actions: {
      pingMonacoTyping: () => {
        if (monacoTypingTimer) {
          clearTimeout(monacoTypingTimer)
        }
        const now = nowTimestamp()
        set({ isMonacoTyping: true, lastActivityAt: now })
        monacoTypingTimer = setTimeout(() => {
          set({ isMonacoTyping: false })
          monacoTypingTimer = null
        }, TYPING_IDLE_MS)
      },
      pingAiTyping: () => {
        if (aiTypingTimer) {
          clearTimeout(aiTypingTimer)
        }
        const now = nowTimestamp()
        set({ isAiTyping: true, lastActivityAt: now })
        aiTypingTimer = setTimeout(() => {
          set({ isAiTyping: false })
          aiTypingTimer = null
        }, TYPING_IDLE_MS)
      },
      setAgentWorking: (isWorking: boolean) => {
        set((state) => ({
          isAgentWorking: isWorking,
          lastActivityAt: isWorking ? nowTimestamp() : state.lastActivityAt,
        }))
      },
      reset: () => {
        if (monacoTypingTimer) {
          clearTimeout(monacoTypingTimer)
          monacoTypingTimer = null
        }
        if (aiTypingTimer) {
          clearTimeout(aiTypingTimer)
          aiTypingTimer = null
        }
        set({
          isMonacoTyping: false,
          isAiTyping: false,
          isAgentWorking: false,
          lastActivityAt: 0,
        })
      },
    },
  })
)
