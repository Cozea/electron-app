/**
 * The single registration point for persisted workbench tile types.
 *
 * A tile implementation still owns its data and React component, but every shell-level
 * behavior is declared here once: title, tab identity, Dockview lifetime and sizing,
 * grouping, detach geometry, hosted-browser policy, and header ownership. Consumers must
 * ask this registry rather than maintaining their own lists of tile type strings.
 */

export type WorkbenchTileType =
  | "browser"
  | "memory"
  | "terminal"
  | "devServer"
  | "llama"
  | "mobileSimulator"
  | "orgDevApp"
  | "devAppPreview"
  | "selection"
  | "tasks"
  | "assistantChat"

export type RenderableWorkbenchTileType = Exclude<WorkbenchTileType, "tasks">
export type WorkbenchDockComponentName = RenderableWorkbenchTileType | "changes"
export type WorkbenchPanelRenderer = "always" | "onlyWhenVisible"
/**
 * Implementations are independent from persisted tile identities. A new tile type may
 * reuse one of these renderers by adding only its descriptor below; a genuinely new UI
 * adds one implementation to the renderer catalog as well.
 */
export type WorkbenchPanelRendererKey =
  | "assistantChat"
  | "memory"
  | "browser"
  | "devAppPreview"
  | "devServer"
  | "llama"
  | "mobileSimulator"
  | "orgDevApp"
  | "selection"
  | "terminal"
export type WorkbenchHeaderControlsKind = "browser" | "runtimePreview" | "registered"
export type WorkbenchManifestSource = "assistant" | "surface" | "published" | "none"
export type WorkbenchFallbackIcon =
  | "messages"
  | "memory"
  | "terminal"
  | "browser"
  | "add"
  | "devServer"
  | "llama"
  | "published"
  | "mobileSimulator"
  | null

export interface WorkbenchPanelConstraints {
  minimumWidth: number
  minimumHeight: number
}

export interface WorkbenchTabGroupPreset {
  label: string
  color: string
}

export interface WorkbenchFloatingBox {
  width: number
  height: number
  x: number
  y: number
}

export interface WorkbenchPopoutBox {
  leftOffset: number
  topOffset: number
  width: number
  height: number
}

export interface WorkbenchDockDefinition {
  renderer: WorkbenchPanelRenderer
  constraints: WorkbenchPanelConstraints
  tabGroup: WorkbenchTabGroupPreset
  floatingBox: WorkbenchFloatingBox
  popoutBox: WorkbenchPopoutBox
  /** Hosted `<webview>` surfaces cannot leave the main renderer window. */
  browserBacked: boolean
  /** The dock header, rather than the tile body, owns the primary controls. */
  headerControls: WorkbenchHeaderControlsKind
}

export interface WorkbenchTileDefinition {
  defaultTitle: string
  tabLabel: string
  manifestSource: WorkbenchManifestSource
  fallbackIcon: WorkbenchFallbackIcon
  panelRenderer: WorkbenchPanelRendererKey | null
  dock: WorkbenchDockDefinition | null
}

const RUNTIME_CONSTRAINTS = { minimumWidth: 320, minimumHeight: 220 } as const
const ASSISTANT_CONSTRAINTS = { minimumWidth: 320, minimumHeight: 240 } as const
const SELECTION_CONSTRAINTS = { minimumWidth: 260, minimumHeight: 180 } as const
const CHANGES_CONSTRAINTS = { minimumWidth: 280, minimumHeight: 260 } as const

const AGENT_GROUP = { label: "Agent", color: "agent" } as const
const PREVIEW_GROUP = { label: "Preview", color: "preview" } as const
const RUNTIME_GROUP = { label: "Runtime", color: "runtime" } as const
const UTILITY_GROUP = { label: "Utility", color: "utility" } as const

const DEFAULT_FLOATING_BOX = { width: 560, height: 420, x: 48, y: 48 } as const
const ASSISTANT_FLOATING_BOX = { width: 560, height: 720, x: 56, y: 48 } as const
const TERMINAL_FLOATING_BOX = { width: 760, height: 420, x: 72, y: 72 } as const
const PREVIEW_FLOATING_BOX = { width: 900, height: 640, x: 72, y: 56 } as const
const CHANGES_FLOATING_BOX = { width: 760, height: 720, x: 64, y: 48 } as const

const DEFAULT_POPOUT_BOX = { leftOffset: 80, topOffset: 80, width: 720, height: 560 } as const
const ASSISTANT_POPOUT_BOX = { leftOffset: 80, topOffset: 80, width: 620, height: 820 } as const
const TERMINAL_POPOUT_BOX = { leftOffset: 90, topOffset: 100, width: 900, height: 520 } as const
const PREVIEW_POPOUT_BOX = { leftOffset: 80, topOffset: 70, width: 1100, height: 780 } as const
const CHANGES_POPOUT_BOX = { leftOffset: 90, topOffset: 70, width: 900, height: 820 } as const

function dockDefinition(options: Partial<WorkbenchDockDefinition> = {}): WorkbenchDockDefinition {
  return {
    renderer: "always",
    constraints: RUNTIME_CONSTRAINTS,
    tabGroup: PREVIEW_GROUP,
    floatingBox: PREVIEW_FLOATING_BOX,
    popoutBox: PREVIEW_POPOUT_BOX,
    browserBacked: false,
    headerControls: "registered",
    ...options,
  }
}

export const WORKBENCH_TILE_REGISTRY = {
  browser: {
    defaultTitle: "Browser",
    tabLabel: "Browser",
    manifestSource: "surface",
    fallbackIcon: "browser",
    panelRenderer: "browser",
    dock: dockDefinition({ browserBacked: true, headerControls: "browser" }),
  },
  terminal: {
    defaultTitle: "Terminal",
    tabLabel: "Terminal",
    manifestSource: "surface",
    fallbackIcon: "terminal",
    panelRenderer: "terminal",
    dock: dockDefinition({
      tabGroup: RUNTIME_GROUP,
      floatingBox: TERMINAL_FLOATING_BOX,
      popoutBox: TERMINAL_POPOUT_BOX,
    }),
  },
  devServer: {
    defaultTitle: "Dev Server",
    tabLabel: "Dev Server",
    manifestSource: "surface",
    fallbackIcon: "devServer",
    panelRenderer: "devServer",
    dock: dockDefinition({ browserBacked: true, headerControls: "runtimePreview" }),
  },
  memory: {
    defaultTitle: "Memory",
    tabLabel: "Memory",
    manifestSource: "surface",
    fallbackIcon: "memory",
    panelRenderer: "memory",
    dock: dockDefinition({
      constraints: ASSISTANT_CONSTRAINTS,
      tabGroup: AGENT_GROUP,
    }),
  },
  llama: {
    defaultTitle: "Llama",
    tabLabel: "Llama",
    manifestSource: "surface",
    fallbackIcon: "llama",
    panelRenderer: "llama",
    dock: dockDefinition({
      constraints: ASSISTANT_CONSTRAINTS,
      tabGroup: AGENT_GROUP,
    }),
  },
  mobileSimulator: {
    defaultTitle: "Mobile Simulator",
    tabLabel: "Simulator",
    manifestSource: "surface",
    fallbackIcon: "mobileSimulator",
    panelRenderer: "mobileSimulator",
    dock: dockDefinition({ headerControls: "runtimePreview" }),
  },
  orgDevApp: {
    defaultTitle: "DevApp",
    tabLabel: "DevApp",
    manifestSource: "published",
    fallbackIcon: "published",
    panelRenderer: "orgDevApp",
    dock: dockDefinition({ browserBacked: true }),
  },
  devAppPreview: {
    defaultTitle: "DevApp (development)",
    tabLabel: "DevApp preview",
    manifestSource: "published",
    fallbackIcon: "published",
    panelRenderer: "devAppPreview",
    dock: dockDefinition({ browserBacked: true }),
  },
  selection: {
    defaultTitle: "Add DevApp",
    tabLabel: "Add",
    manifestSource: "none",
    fallbackIcon: "add",
    panelRenderer: "selection",
    dock: dockDefinition({
      renderer: "onlyWhenVisible",
      constraints: SELECTION_CONSTRAINTS,
      tabGroup: UTILITY_GROUP,
      floatingBox: DEFAULT_FLOATING_BOX,
      popoutBox: DEFAULT_POPOUT_BOX,
    }),
  },
  tasks: {
    defaultTitle: "Tasks",
    tabLabel: "Panel",
    manifestSource: "none",
    fallbackIcon: null,
    panelRenderer: null,
    dock: null,
  },
  assistantChat: {
    defaultTitle: "AI Agent",
    tabLabel: "Agent",
    manifestSource: "assistant",
    fallbackIcon: "messages",
    panelRenderer: "assistantChat",
    dock: dockDefinition({
      constraints: ASSISTANT_CONSTRAINTS,
      tabGroup: AGENT_GROUP,
      floatingBox: ASSISTANT_FLOATING_BOX,
      popoutBox: ASSISTANT_POPOUT_BOX,
    }),
  },
} as const satisfies Record<WorkbenchTileType, WorkbenchTileDefinition>

export const CHANGES_DOCK_DEFINITION: WorkbenchDockDefinition = dockDefinition({
  renderer: "onlyWhenVisible",
  constraints: CHANGES_CONSTRAINTS,
  tabGroup: UTILITY_GROUP,
  floatingBox: CHANGES_FLOATING_BOX,
  popoutBox: CHANGES_POPOUT_BOX,
})

export const RENDERABLE_WORKBENCH_TILE_TYPES = Object.keys(WORKBENCH_TILE_REGISTRY).filter(
  (type): type is RenderableWorkbenchTileType =>
    WORKBENCH_TILE_REGISTRY[type as WorkbenchTileType].dock !== null,
)

export function isWorkbenchTileType(value: unknown): value is WorkbenchTileType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(WORKBENCH_TILE_REGISTRY, value)
  )
}

export function getWorkbenchTileDefinition(type: WorkbenchTileType): WorkbenchTileDefinition {
  return WORKBENCH_TILE_REGISTRY[type]
}

export function getWorkbenchDockDefinition(
  component: string | null | undefined,
): WorkbenchDockDefinition | null {
  if (component === "changes") return CHANGES_DOCK_DEFINITION
  if (!isWorkbenchTileType(component)) return null
  return WORKBENCH_TILE_REGISTRY[component].dock
}

export function isBrowserBackedWorkbenchTile(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("type" in value)) return false
  const type = (value as { type?: unknown }).type
  return isWorkbenchTileType(type) && WORKBENCH_TILE_REGISTRY[type].dock?.browserBacked === true
}
