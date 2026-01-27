import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

// Style state for pseudo-class editing
export type StyleState = 'default' | ':hover' | ':active' | ':focus'

// Active tab in the visual editor
export type EditorTab = 'styling' | 'attributes' | 'events'

// Element styles that can be edited via the visual editor
export interface ElementStyles {
  // Layout
  display: string
  position: string
  width: string
  height: string
  minWidth: string
  maxWidth: string
  minHeight: string
  maxHeight: string

  // Spacing
  padding: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
  margin: string
  marginTop: string
  marginRight: string
  marginBottom: string
  marginLeft: string

  // Flex/Grid
  flexDirection: string
  justifyContent: string
  alignItems: string
  gap: string
  flexWrap: string
  flexGrow: string
  flexShrink: string

  // Typography
  fontSize: string
  fontWeight: string
  fontStyle: string
  fontFamily: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  color: string
  textDecoration: string
  textTransform: string

  // Background
  backgroundColor: string
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
  backgroundRepeat: string

  // Border
  border: string
  borderWidth: string
  borderStyle: string
  borderColor: string
  borderRadius: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomLeftRadius: string
  borderBottomRightRadius: string

  // Effects
  opacity: string
  boxShadow: string
  overflow: string
  cursor: string
  zIndex: string
  transform: string
  transition: string
}

export interface SelectedElement {
  tagName: string
  className: string
  id?: string
  selector: string
  boundingRect: { x: number; y: number; width: number; height: number }
  computedStyles?: Partial<ElementStyles>
  htmlSnippet: string
  textContent?: string
}

interface VisualEditorState {
  // Whether the visual editor sidebar is open
  isOpen: boolean

  // Currently selected element
  selectedElement: SelectedElement | null

  // Pending style changes (not yet applied)
  pendingChanges: Partial<ElementStyles>

  // Pending text change
  pendingTextChange: string | null

  // Current style state (default, :hover, :active, :focus)
  styleState: StyleState

  // Active tab in the editor
  activeTab: EditorTab

  // Search query for filtering properties
  searchQuery: string

  // Actions
  open: () => void
  close: () => void
  toggle: () => void

  setSelectedElement: (element: SelectedElement | null) => void
  clearSelectedElement: () => void

  // Update a single pending style change
  updatePendingChange: (property: keyof ElementStyles, value: string) => void

  // Get value from pending changes or fall back to computed styles
  getPendingOrOriginal: (property: keyof ElementStyles) => string | undefined

  // Update pending text change
  updatePendingText: (text: string) => void

  // Get pending text or original text content
  getPendingOrOriginalText: () => string

  // Clear all pending changes
  clearPendingChanges: () => void

  // Set style state
  setStyleState: (state: StyleState) => void

  // Set active tab
  setActiveTab: (tab: EditorTab) => void

  // Set search query
  setSearchQuery: (query: string) => void

  // Reset the store
  reset: () => void
}

const initialState = {
  isOpen: false,
  selectedElement: null,
  pendingChanges: {},
  pendingTextChange: null,
  styleState: 'default' as StyleState,
  activeTab: 'styling' as EditorTab,
  searchQuery: '',
}

export const useVisualEditorStore = create<VisualEditorState>()(
  immer((set, get) => ({
    ...initialState,

    open: () => set((state) => {
      state.isOpen = true
    }),

    close: () => set((state) => {
      state.isOpen = false
      state.selectedElement = null
      state.pendingChanges = {}
      state.pendingTextChange = null
    }),

    toggle: () => set((state) => {
      state.isOpen = !state.isOpen
    }),

    setSelectedElement: (element) => set((state) => {
      state.selectedElement = element
      state.pendingChanges = {}
      state.pendingTextChange = null
      if (element) {
        state.isOpen = true
      }
    }),

    clearSelectedElement: () => set((state) => {
      state.selectedElement = null
      state.pendingChanges = {}
      state.pendingTextChange = null
    }),

    updatePendingChange: (property, value) => set((state) => {
      state.pendingChanges[property] = value
    }),

    getPendingOrOriginal: (property) => {
      const state = get()
      // Check pending changes first
      if (property in state.pendingChanges) {
        return state.pendingChanges[property]
      }
      // Fall back to computed styles
      return state.selectedElement?.computedStyles?.[property]
    },

    updatePendingText: (text) => set((state) => {
      state.pendingTextChange = text
    }),

    getPendingOrOriginalText: () => {
      const state = get()
      if (state.pendingTextChange !== null) {
        return state.pendingTextChange
      }
      return state.selectedElement?.textContent || ''
    },

    clearPendingChanges: () => set((state) => {
      state.pendingChanges = {}
      state.pendingTextChange = null
    }),

    setStyleState: (styleState) => set((state) => {
      state.styleState = styleState
    }),

    setActiveTab: (activeTab) => set((state) => {
      state.activeTab = activeTab
    }),

    setSearchQuery: (searchQuery) => set((state) => {
      state.searchQuery = searchQuery
    }),

    reset: () => set(() => initialState),
  }))
)
