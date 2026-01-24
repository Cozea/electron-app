import { create } from 'zustand'

interface ChatPanelState {
    isOpen: boolean
    mode: 'docked' | 'fullscreen'
    actions: {
        toggle: () => void
        setMode: (mode: 'docked' | 'fullscreen') => void
        open: () => void
        close: () => void
    }
}

export const useChatPanelStore = create<ChatPanelState>((set) => ({
    isOpen: false,
    mode: 'docked',
    actions: {
        toggle: () => set((state) => ({ isOpen: !state.isOpen })),
        setMode: (mode) => set({ mode }),
        open: () => set({ isOpen: true }),
        close: () => set({ isOpen: false }),
    }
}))
