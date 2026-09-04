import { memo, useCallback, useMemo, type ComponentProps } from "react"
import {
  DockviewReact,
  themeAbyssSpaced,
  themeLightSpaced,
  type DockviewGroupPanel,
  type DockviewTheme,
  type GetTabContextMenuItemsParams,
  type IDockviewPanel,
} from "dockview-react"

import "dockview-react/dist/styles/dockview.css"
import "@/features/workbench/workbench.css"

import {
  WorkbenchDockHeaderActions,
  WorkbenchDockHeaderControls,
  WORKBENCH_DOCK_COMPONENTS,
  WorkbenchDockTab,
  WorkbenchDockWatermark,
} from "@/features/workbench/WorkbenchDockPanels"
import { resolveTabGroupPreset } from "@/features/workbench/model/workbenchDockview"
import {
  getWorkbenchDockDefinition,
  getWorkbenchTileDefinition,
  isBrowserBackedWorkbenchTile,
} from "@/features/workbench/model/workbenchTileRegistry"
import { useWorkbenchDockRuntime } from "@/features/workbench/WorkbenchDockRuntimeContext"
import { selectProjectWorkbench, useProjectWorkbenchStore } from "@/lib/workbenchStore"
import { cn } from "@/lib/utils"
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"

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
    // "none" is dockview's flat underline mode (not off). We hide the line in
    // CSS; chips/grouping stay.
    tabGroupIndicator: "none",
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
  return (
    getWorkbenchDockDefinition(component)?.floatingBox ??
    getWorkbenchTileDefinition("selection").dock!.floatingBox
  )
}

function getPopoutBoxForComponent(component: string): {
  left: number
  top: number
  width: number
  height: number
} {
  const screenLeft = window.screenX || 0
  const screenTop = window.screenY || 0
  const box =
    getWorkbenchDockDefinition(component)?.popoutBox ??
    getWorkbenchTileDefinition("selection").dock!.popoutBox
  return {
    left: screenLeft + box.leftOffset,
    top: screenTop + box.topOffset,
    width: box.width,
    height: box.height,
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
    () =>
      buildCozeaDockviewTheme(
        themeScheme === "dark" ? themeAbyssSpaced : themeLightSpaced,
        themeScheme,
      ),
    [themeScheme],
  )

  const getTabContextMenuItems = useCallback(
    (params: GetTabContextMenuItemsParams) => {
      params.event.preventDefault()
      params.event.stopPropagation()

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

      // A tab already living in a floating overlay or a popout window gets the
      // inverse action instead of being offered a second detach it cannot do.
      const groupLocation = params.group.api.location.type
      const isDetached = groupLocation === "floating" || groupLocation === "popout"
      const tabCount = params.group.panels.length
      const hasSiblingTabs = tabCount > 1
      const browserBackedPanel = isBrowserBackedWorkbenchTile(tile)
      const groupContainsBrowserBackedPanel = params.group.panels.some((candidate) =>
        isBrowserBackedWorkbenchTile(workbench?.tiles[candidate.id] ?? null),
      )

      const popOut = (item: IDockviewPanel | DockviewGroupPanel) => {
        void params.api
          .addPopoutGroup(item, {
            position: getPopoutBoxForComponent(panel.api.component),
            onDidOpen: (event) => {
              event.window.document.title = panel.api.title ?? "Cozea Panel"
            },
            onWillClose: () => {
              params.api.focus()
            },
          })
          .catch((error) => {
            console.warn("[WorkbenchDockview] Failed to pop out panel", error)
          })
      }

      const isSoleSelection = tile?.type === "selection" && (workbench?.order.length ?? 0) <= 1
      const items: ContextMenuItem<string>[] = []

      if (!isDetached) {
        items.push({
          id: panel.api.isMaximized() ? "restore" : "maximize",
          label: panel.api.isMaximized() ? "Restore" : "Maximize",
          icon: getNativeMenuIcon("maximize"),
        })
      }

      if (isDetached) {
        items.push({
          id: "dock",
          label: groupLocation === "popout" ? "Return to main window" : "Dock",
          icon: getNativeMenuIcon("dock"),
        })
      } else if (!isSoleSelection) {
        items.push({
          id: "float-tab",
          label: hasSiblingTabs ? "Float tab" : "Float",
          icon: getNativeMenuIcon("float"),
        })
        if (hasSiblingTabs) {
          items.push({
            id: "float-all",
            label: `Float all ${tabCount} tabs`,
            icon: getNativeMenuIcon("float"),
          })
        }
        if (!browserBackedPanel) {
          items.push({
            id: "popout-tab",
            label: hasSiblingTabs ? "Pop out tab" : "Pop out",
            icon: getNativeMenuIcon("popout"),
          })
        }
        if (hasSiblingTabs && !groupContainsBrowserBackedPanel) {
          items.push({
            id: "popout-all",
            label: `Pop out all ${tabCount} tabs`,
            icon: getNativeMenuIcon("popout"),
          })
        }
      }

      if (!isSoleSelection) {
        items.push({ id: "sep-grouping", type: "separator" })

        if (currentTabGroup) {
          items.push({
            id: "remove-from-group",
            label: `Remove from ${currentTabGroup.label}`,
          })
        }
        items.push({
          id: "group-as-preset",
          label: `Group as ${preset.label}`,
        })
        items.push({
          id: "new-group-from-panel",
          label: "New group from panel",
        })

        items.push({ id: "sep-closing", type: "separator" })

        if (tile?.type === "assistantChat") {
          items.push({
            id: "duplicate-agent",
            label: "Duplicate agent",
            icon: getNativeMenuIcon("copy"),
          })
        }

        items.push({
          id: "close",
          label: "Close",
          icon: getNativeMenuIcon("close"),
        })
        if (hasSiblingTabs) {
          items.push({
            id: "close-others",
            label: "Close Others",
            icon: getNativeMenuIcon("close"),
          })
          items.push({
            id: "close-all",
            label: "Close All",
            icon: getNativeMenuIcon("delete"),
          })
        }
      }

      const position = {
        x: Math.round(params.event.clientX),
        y: Math.round(params.event.clientY),
      }

      void showDesktopContextMenu(items, position).then((action) => {
        if (!action) return

        switch (action) {
          case "maximize":
            panel.api.maximize()
            break
          case "restore":
            panel.api.exitMaximized()
            break
          case "dock":
            params.group.api.moveTo({ position: "right" })
            break
          case "float-tab":
            params.api.addFloatingGroup(panel, getFloatingBoxForComponent(panel.api.component))
            break
          case "float-all":
            params.api.addFloatingGroup(
              params.group,
              getFloatingBoxForComponent(panel.api.component),
            )
            break
          case "popout-tab":
            popOut(panel)
            break
          case "popout-all":
            popOut(params.group)
            break
          case "remove-from-group":
            params.api.removePanelFromTabGroup({
              groupId: params.group.id,
              panelId: panel.id,
            })
            break
          case "group-as-preset": {
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
            break
          }
          case "new-group-from-panel": {
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
            break
          }
          case "duplicate-agent":
            runtime.onDuplicateAssistantTile(panel.id)
            break
          case "close":
            panel.api.close()
            break
          case "close-others":
            params.group.panels.filter((p) => p !== panel).forEach((p) => p.api.close())
            break
          case "close-all":
            [...params.group.panels].forEach((p) => p.api.close())
            break
        }
      })

      return []
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
        // Electron is an embedded webview: dockview's default `auto` uses HTML5
        // DnD for mouse, and `dragstart` often never fires. Pointer strategy is
        // the documented path for that environment (cloud VM smoke needed it).
        dndStrategy="pointer"
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
