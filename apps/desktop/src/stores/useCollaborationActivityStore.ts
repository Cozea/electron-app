import { create } from "zustand"

const TYPING_IDLE_MS = 2500

let aiTypingTimer: ReturnType<typeof setTimeout> | null = null

interface CollaborationActivityState {
  isAiTyping: boolean
  isAgentWorking: boolean
  lastActivityAt: number
  actions: {
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
    isAiTyping: false,
    isAgentWorking: false,
    lastActivityAt: 0,
    actions: {
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
        if (aiTypingTimer) {
          clearTimeout(aiTypingTimer)
          aiTypingTimer = null
        }
        set({
          isAiTyping: false,
          isAgentWorking: false,
          lastActivityAt: 0,
        })
      },
    },
  })
)
