import { useCallback, useMemo, type ComponentProps } from "react"
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewTheme,
  type GetTabContextMenuItemsParams,
} from "dockview"

import "dockview/dist/styles/dockview.css"

import {
  WorkbenchDockHeaderActions,
  WorkbenchDockHeaderControls,
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockTab,
  WorkbenchDockWatermark,
} from "@/features/projects/components/workbench/WorkbenchDockPanels"
import { useWorkbenchDockRuntime } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { cn } from "@/lib/utils"

const WORKBENCH_TAB_GROUP_COLORS = [
  { id: "agent", value: "var(--primary)", label: "Agent" },
  { id: "preview", value: "oklch(0.68 0.15 225)", label: "Preview" },
  { id: "runtime", value: "oklch(0.70 0.16 145)", label: "Runtime" },
  { id: "utility", value: "oklch(0.72 0.14 70)", label: "Utility" },
] as const

function buildCozeaDockviewTheme(baseTheme: DockviewTheme): DockviewTheme {
  return {
    ...baseTheme,
    gap: 0,
    tabAnimation: "smooth",
    dndOverlayBorder: "1px solid var(--dv-drag-over-border-color)",
    dndPanelOverlay: "group",
    dndTabIndicator: "line",
    tabGroupIndicator: "wrap",
    edgeGroupCollapsedSize: 32,
  }
}

function resolveTabGroupPreset(component: string): {
  label: string
  color: string
} {
  switch (component) {
    case "assistantChat":
      return { label: "Agent", color: "agent" }
    case "browser":
    case "devServer":
    case "mobileSimulator":
      return { label: "Preview", color: "preview" }
    case "terminal":
      return { label: "Runtime", color: "runtime" }
    default:
      return { label: "Utility", color: "utility" }
  }
}

function getFloatingBoxForComponent(component: string): {
  width: number
  height: number
  x: number
  y: number
} {
  switch (component) {
    case "assistantChat":
      return { width: 560, height: 720, x: 56, y: 48 }
    case "terminal":
      return { width: 760, height: 420, x: 72, y: 72 }
    case "browser":
    case "devServer":
    case "mobileSimulator":
      return { width: 900, height: 640, x: 72, y: 56 }
    case "changes":
      return { width: 760, height: 720, x: 64, y: 48 }
    default:
      return { width: 560, height: 420, x: 48, y: 48 }
  }
}

function getPopoutBoxForComponent(component: string): {
  left: number
  top: number
  width: number
  height: number
} {
  const screenLeft = window.screenX || 0
  const screenTop = window.screenY || 0
  switch (component) {
    case "assistantChat":
      return { left: screenLeft + 80, top: screenTop + 80, width: 620, height: 820 }
    case "terminal":
      return { left: screenLeft + 90, top: screenTop + 100, width: 900, height: 520 }
    case "browser":
    case "devServer":
    case "mobileSimulator":
      return { left: screenLeft + 80, top: screenTop + 70, width: 1100, height: 780 }
    case "changes":
      return { left: screenLeft + 90, top: screenTop + 70, width: 900, height: 820 }
    default:
      return { left: screenLeft + 80, top: screenTop + 80, width: 720, height: 560 }
  }
}

interface WorkbenchDockviewCanvasProps {
  dockviewKey: string
  className?: string
  onReady: ComponentProps<typeof DockviewReact>["onReady"]
}

export function WorkbenchDockviewCanvas({
  dockviewKey,
  className,
  onReady,
}: WorkbenchDockviewCanvasProps) {
  const runtime = useWorkbenchDockRuntime()
  const isDarkTheme = className?.includes("dockview-theme-dark") ?? false
  const dockviewTheme = useMemo(
    () => buildCozeaDockviewTheme(isDarkTheme ? themeDark : themeLight),
    [isDarkTheme],
  )

  const getTabContextMenuItems = useCallback(
    (params: GetTabContextMenuItemsParams) => {
      const panel = params.panel
      const preset = resolveTabGroupPreset(panel.api.component)
      const workbench = selectProjectWorkbench(
        runtime.projectId,
        runtime.laneId,
        runtime.workspaceId,
      )(useProjectWorkbenchStore.getState())
      const tile = workbench?.tiles[panel.id] ?? null
      const currentTabGroup = params.api.getTabGroupForPanel({
        groupId: params.group.id,
        panelId: panel.id,
      })

      return [
        {
          label: panel.api.isMaximized() ? "Restore" : "Maximize",
          action: () => {
            if (panel.api.isMaximized()) {
              panel.api.exitMaximized()
            } else {
              panel.api.maximize()
            }
          },
        },
        {
          label: "Float",
          action: () => params.api.addFloatingGroup(
            panel,
            getFloatingBoxForComponent(panel.api.component),
          ),
        },
        {
          label: "Pop out",
          action: () => {
            void params.api.addPopoutGroup(panel, {
              position: getPopoutBoxForComponent(panel.api.component),
              onDidOpen: (event) => {
                event.window.document.title = panel.api.title ?? "Cozea Panel"
              },
              onWillClose: () => {
                params.api.focus()
              },
            }).catch((error) => {
              console.warn("[WorkbenchDockview] Failed to pop out panel", error)
            })
          },
        },
        "separator" as const,
        ...(currentTabGroup
          ? [{
              label: `Remove from ${currentTabGroup.label}`,
              action: () => {
                params.api.removePanelFromTabGroup({
                  groupId: params.group.id,
                  panelId: panel.id,
                })
              },
            }]
          : []),
        {
          label: `Group as ${preset.label}`,
          action: () => {
            const existingGroup = params.api
              .getTabGroups({ groupId: params.group.id })
              .find((group) => group.label === preset.label)
            const tabGroup =
              existingGroup ??
              params.api.createTabGroup({
                groupId: params.group.id,
                label: preset.label,
                color: preset.color,
              })
            params.api.addPanelToTabGroup({
              groupId: params.group.id,
              tabGroupId: tabGroup.id,
              panelId: panel.id,
            })
          },
        },
        {
          label: "New group from panel",
          action: () => {
            const tabGroup = params.api.createTabGroup({
              groupId: params.group.id,
              label: tile?.title ?? panel.api.title ?? preset.label,
              color: preset.color,
            })
            params.api.addPanelToTabGroup({
              groupId: params.group.id,
              tabGroupId: tabGroup.id,
              panelId: panel.id,
            })
          },
        },
        "separator" as const,
        ...(tile?.type === "assistantChat"
          ? [{
              label: "Duplicate agent",
              action: () => runtime.onDuplicateAssistantTile(panel.id),
            }]
          : []),
        "close" as const,
        "closeOthers" as const,
        "closeAll" as const,
      ]
    },
    [runtime],
  )

  return (
    <DockviewReact
      key={dockviewKey}
      className={cn("cozea-workbench-dockview h-full w-full min-w-0", className)}
      components={WORKBENCH_DOCK_COMPONENTS}
      defaultTabComponent={WorkbenchDockTab}
      leftHeaderActionsComponent={WorkbenchDockHeaderControls}
      rightHeaderActionsComponent={WorkbenchDockHeaderActions}
      watermarkComponent={WorkbenchDockWatermark}
      getTabContextMenuItems={getTabContextMenuItems}
      getTabGroupChipContextMenuItems={() => ["rename", "colorPicker"]}
      tabGroupColors={[...WORKBENCH_TAB_GROUP_COLORS]}
      tabGroupAccent="palette"
      theme={dockviewTheme}
      floatingGroupBounds="boundedWithinViewport"
      noPanelsOverlay="watermark"
      singleTabMode="default"
      onReady={onReady}
    />
  )
}
