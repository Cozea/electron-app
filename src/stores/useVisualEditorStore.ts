import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
  path?: number[]
  boundingRect: { x: number; y: number; width: number; height: number }
  computedStyles?: Partial<ElementStyles>
  htmlSnippet: string
  textContent?: string
}

export type InspectorSide = 'left' | 'right'

interface VisualEditorState {
  // Whether the visual editor sidebar is open
  isOpen: boolean

  // Current width of the visual editor panel
  panelWidth: number

  // Which side of the window the inspector panel is on
  inspectorSide: InspectorSide

  // Switching sides: close anim on current side, then open anim on new side
  isSwitchingSide: boolean
  pendingInspectorSide: InspectorSide | null
  openingAfterSwitch: boolean

  // Actions for side switch (completeSideSwitch called when close transition ends)
  completeSideSwitch: () => void
  setOpeningAfterSwitchComplete: () => void

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
  setPanelWidth: (width: number) => void
  setInspectorSide: (side: InspectorSide) => void
  toggleInspectorSide: () => void

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
  panelWidth: 300,
  selectedElement: null,
  pendingChanges: {},
  pendingTextChange: null,
  styleState: 'default' as StyleState,
  activeTab: 'styling' as EditorTab,
  searchQuery: '',
  inspectorSide: 'right' as InspectorSide,
  isSwitchingSide: false,
  pendingInspectorSide: null,
  openingAfterSwitch: false,
}

function isSameSelectedElement(
  current: SelectedElement | null,
  next: SelectedElement | null,
): boolean {
  if (!current || !next) return false

  if (
    current.path &&
    next.path &&
    current.path.length > 0 &&
    current.path.length === next.path.length
  ) {
    return current.path.every((segment, index) => segment === next.path?.[index])
  }

  return (
    current.selector === next.selector &&
    current.tagName === next.tagName &&
    current.id === next.id &&
    current.className === next.className
  )
}

export const useVisualEditorStore = create<VisualEditorState>()(
  persist(
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

    setPanelWidth: (panelWidth) => set((state) => {
      state.panelWidth = panelWidth
    }),

    setInspectorSide: (inspectorSide) => set((state) => {
      state.inspectorSide = inspectorSide
    }),

    toggleInspectorSide: () => set((state) => {
      if (state.isSwitchingSide || state.openingAfterSwitch) return
      if (state.isOpen) {
        state.isSwitchingSide = true
        state.pendingInspectorSide = state.inspectorSide === 'left' ? 'right' : 'left'
      } else {
        state.inspectorSide = state.inspectorSide === 'left' ? 'right' : 'left'
      }
    }),

    completeSideSwitch: () => set((state) => {
      if (!state.isSwitchingSide || state.pendingInspectorSide == null) return
      state.inspectorSide = state.pendingInspectorSide
      state.isSwitchingSide = false
      state.pendingInspectorSide = null
      state.openingAfterSwitch = true
    }),

    setOpeningAfterSwitchComplete: () => set((state) => {
      state.openingAfterSwitch = false
    }),

    setSelectedElement: (element) => set((state) => {
      const preservePendingChanges = isSameSelectedElement(state.selectedElement, element)

      if (element) {
        console.log('[VisualEditor][store:setSelectedElement]', {
          selector: element.selector,
          tagName: element.tagName,
          path: element.path ?? null,
          textContent: element.textContent ?? null,
          preservePendingChanges,
          prevPath: state.selectedElement?.path ?? null,
          prevSelector: state.selectedElement?.selector ?? null,
          computedStylesKeys: element.computedStyles ? Object.keys(element.computedStyles).slice(0, 10) : [],
          computedStyles: {
            fontFamily: element.computedStyles?.fontFamily ?? null,
            fontSize: element.computedStyles?.fontSize ?? null,
            fontWeight: element.computedStyles?.fontWeight ?? null,
            lineHeight: element.computedStyles?.lineHeight ?? null,
            letterSpacing: element.computedStyles?.letterSpacing ?? null,
            textAlign: element.computedStyles?.textAlign ?? null,
            color: element.computedStyles?.color ?? null,
            paddingTop: element.computedStyles?.paddingTop ?? null,
          },
        })
      } else {
        console.log('[VisualEditor][store:setSelectedElement]', null)
      }

      state.selectedElement = element
      if (!preservePendingChanges) {
        state.pendingChanges = {}
        state.pendingTextChange = null
      }
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
  })),
    {
      name: 'visual-editor-store',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ inspectorSide: state.inspectorSide, panelWidth: state.panelWidth }),
    }
  )
)
