import { memo, useCallback, useMemo, type ComponentProps } from "react"
import {
  DockviewReact,
  themeAbyssSpaced,
  themeLightSpaced,
  type DockviewTheme,
  type GetTabContextMenuItemsParams,
} from "dockview-react"

import "dockview-react/dist/styles/dockview.css"
import "@/features/projects/components/workbench/workbench.css"

import {
  WorkbenchDockHeaderActions,
  WorkbenchDockHeaderControls,
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockTab,
  WorkbenchDockWatermark,
} from "@/features/projects/components/workbench/WorkbenchDockPanels"
import {
  resolveTabGroupPreset,
} from "@/features/projects/lib/workbenchDockview"
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

function buildCozeaDockviewTheme(
  baseTheme: DockviewTheme,
  themeScheme: "dark" | "light",
): DockviewTheme {
  return {
    ...baseTheme,
    name: `cozea-${baseTheme.name}`,
    className: `${baseTheme.className} cozea-workbench-dockview-theme cozea-workbench-dockview-theme--${themeScheme}`,
    colorScheme: themeScheme,
    tabAnimation: "smooth",
    tabGroupIndicator: "wrap",
    // Tighter inter-tile gap than the Spaced theme default (10px) so adjacent
    // tiles sit closer while still reading as separate cards.
    gap: 6,
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
  themeScheme: "dark" | "light"
  onReady: ComponentProps<typeof DockviewReact>["onReady"]
}

// Memo boundary: dockview re-pushes props into every tab/panel portal root
// whenever this component renders, so parent cascades (layout/surface churn)
// must stop here. All props are primitives or stable callbacks.
export const WorkbenchDockviewCanvas = memo(function WorkbenchDockviewCanvas({
  dockviewKey,
  className,
  themeScheme,
  onReady,
}: WorkbenchDockviewCanvasProps) {
  const runtime = useWorkbenchDockRuntime()
  const dockviewTheme = useMemo(
    () => buildCozeaDockviewTheme(
      themeScheme === "dark" ? themeAbyssSpaced : themeLightSpaced,
      themeScheme,
    ),
    [themeScheme],
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
    <div className={cn("cozea-workbench-dockview-host h-full min-h-0 w-full min-w-0", className)}>
      <DockviewReact
        key={dockviewKey}
        className="cozea-workbench-dockview h-full min-h-0 w-full min-w-0"
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
        // Basic OSS overflow list (not enterprise search/MRU). Explicit so a
        // future theme/option churn cannot silently disable it.
        disableTabsOverflowList={false}
        hideBorders
        noPanelsOverlay="watermark"
        singleTabMode="default"
        onReady={onReady}
      />
    </div>
  )
})
