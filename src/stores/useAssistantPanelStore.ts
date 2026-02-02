import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Id } from '../../convex/_generated/dataModel'

type AssistantPanelMode = 'closed' | 'panel' | 'fullscreen'

// Panel width constraints
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 2400
const DEFAULT_PANEL_WIDTH = 400

export interface PendingAttachment {
  type: 'image'
  data: string // base64 data URL
  name: string
  context?: {
    pagePath?: string
    pageFile?: string
    projectName?: string
    serverPort?: number
  }
}

interface AssistantPanelState {
  mode: AssistantPanelMode
  pendingPrompt: string | null
  pendingAttachments: PendingAttachment[]
  triggerClearChat: number
  panelWidth: number
  chatTitle: string

  // Conversation history state
  currentConversationId: Id<"aiConversations"> | null
  isHistoryOpen: boolean

  // Actions
  open: () => void
  close: () => void
  togglePanel: () => void
  setMode: (mode: AssistantPanelMode) => void
  expandToFullscreen: () => void
  collapseToPanel: () => void
  setPendingPrompt: (prompt: string | null) => void
  openWithPrompt: (prompt: string) => void
  addPendingAttachment: (attachment: PendingAttachment) => void
  removePendingAttachment: (index: number) => void
  clearPendingAttachments: () => void
  openWithScreenshot: (screenshot: PendingAttachment, prompt?: string) => void
  requestClearChat: () => void
  setPanelWidth: (width: number) => void
  resetPanelWidth: () => void
  setChatTitle: (title: string) => void

  // Conversation history actions
  setCurrentConversationId: (id: Id<"aiConversations"> | null) => void
  openHistory: () => void
  closeHistory: () => void
  startNewConversation: () => void
}

export const useAssistantPanelStore = create<AssistantPanelState>()(
  persist(
    (set) => ({
      mode: 'closed',
      pendingPrompt: null,
      pendingAttachments: [],
      triggerClearChat: 0,
      panelWidth: DEFAULT_PANEL_WIDTH,
      chatTitle: 'New Chat',
      currentConversationId: null,
      isHistoryOpen: false,

      open: () => set({ mode: 'panel' }),

      close: () => set({ mode: 'closed' }),

      togglePanel: () => set((state) => ({
        mode: state.mode === 'closed' ? 'panel' : 'closed'
      })),

      setMode: (mode) => set({ mode }),

      expandToFullscreen: () => set({ mode: 'fullscreen' }),

      collapseToPanel: () => set({ mode: 'panel' }),

      setPendingPrompt: (prompt) => set({ pendingPrompt: prompt }),

      openWithPrompt: (prompt) => set({ mode: 'panel', pendingPrompt: prompt }),

      addPendingAttachment: (attachment) => set((state) => ({
        pendingAttachments: [...state.pendingAttachments, attachment]
      })),

      removePendingAttachment: (index) => set((state) => ({
        pendingAttachments: state.pendingAttachments.filter((_, i) => i !== index)
      })),

      clearPendingAttachments: () => set({ pendingAttachments: [] }),

      openWithScreenshot: (screenshot, prompt) => set({
        mode: 'panel',
        pendingAttachments: [screenshot],
        pendingPrompt: prompt || null,
      }),

      requestClearChat: () => set((state) => ({
        triggerClearChat: state.triggerClearChat + 1,
      })),

      setPanelWidth: (width) => set({
        panelWidth: Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width)),
      }),

      resetPanelWidth: () => set({ panelWidth: DEFAULT_PANEL_WIDTH }),
      setChatTitle: (title) => set({ chatTitle: title }),

      // Conversation history actions
      setCurrentConversationId: (id) => set({ currentConversationId: id }),

      openHistory: () => set({ isHistoryOpen: true }),

      closeHistory: () => set({ isHistoryOpen: false }),

      startNewConversation: () => set((state) => ({
        currentConversationId: null,
        chatTitle: 'New Chat',
        triggerClearChat: state.triggerClearChat + 1,
      })),
    }),
    {
      name: 'cozea-assistant-panel',
      storage: createJSONStorage(() => localStorage),
      // Persist panel width and open/closed state so it stays as the user left it
      partialize: (state) => ({ panelWidth: state.panelWidth, mode: state.mode }),
    }
  )
)
