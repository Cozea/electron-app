import { useMemo } from "react"

import type { KeybindingCommand } from "@cozea/assistant-contracts"

import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { useNavigate } from "@/lib/router"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
  type WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import { commandLabel } from "./commandLabels"
import type { CommandPaletteCommand } from "./CommandPalette.logic"
import { toggleCommandPalette } from "./commandPaletteBus"

export interface WorkbenchCommandRegistryContext {
  readonly projectId: string | null
  readonly laneId: string
  readonly workspaceId: string | null
  readonly openSettings: () => void
  readonly closeSettings: () => void
  readonly isSettingsOpen: boolean
}

function findActiveTileOfType(
  projectId: string,
  laneId: string,
  workspaceId: string | null,
  type: WorkbenchTileType,
) {
  const workbench = selectProjectWorkbench(
    useProjectWorkbenchStore.getState(),
    projectId,
    laneId,
    workspaceId,
  )
  if (!workbench) return null
  const activeId = workbench.activeTileId
  if (activeId && workbench.tiles[activeId]?.type === type) {
    return workbench.tiles[activeId]
  }
  for (const tileId of workbench.order) {
    const tile = workbench.tiles[tileId]
    if (tile?.type === type) return tile
  }
  return null
}

export function useWorkbenchCommandRegistry(
  context: WorkbenchCommandRegistryContext,
): CommandPaletteCommand[] {
  const navigate = useNavigate()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)

  return useMemo(() => {
    const { projectId, laneId, workspaceId } = context
    if (!projectId) return []

    const addOrFocusTile = (type: Extract<WorkbenchTileType, "terminal" | "assistantChat" | "browser" | "tasks" | "selection">) => {
      if (type === "selection" || type === "tasks") {
        workbenchActions.addTile(projectId, laneId, type, undefined, workspaceId)
        return
      }
      const existing = findActiveTileOfType(projectId, laneId, workspaceId, type)
      if (type === "terminal" || type === "assistantChat" || type === "browser") {
        if (existing && type !== "assistantChat") {
          // Toggle: focus existing terminal/browser; for chat always allow new via chat.new
          workbenchActions.setActiveTile(projectId, laneId, existing.id, workspaceId)
          return
        }
      }
      workbenchActions.addTile(projectId, laneId, type, undefined, workspaceId)
    }

    const closeActiveOfType = (type: WorkbenchTileType) => {
      const workbench = selectProjectWorkbench(
        useProjectWorkbenchStore.getState(),
        projectId,
        laneId,
        workspaceId,
      )
      if (!workbench) return
      const activeId = workbench.activeTileId
      const active = activeId ? workbench.tiles[activeId] : null
      if (active?.type === type) {
        workbenchActions.removeTile(projectId, laneId, active.id, workspaceId)
        return
      }
      const first = findActiveTileOfType(projectId, laneId, workspaceId, type)
      if (first) {
        workbenchActions.removeTile(projectId, laneId, first.id, workspaceId)
      }
    }

    const runKeybinding = (command: KeybindingCommand, run: () => void): CommandPaletteCommand => ({
      id: command,
      keybindingCommand: command,
      title: commandLabel(command),
      group: "Actions",
      searchTerms: [command, commandLabel(command)],
      run,
    })

    const commands: CommandPaletteCommand[] = [
      runKeybinding("commandPalette.toggle", () => {
        toggleCommandPalette()
      }),
      runKeybinding("terminal.toggle", () => {
        const existing = findActiveTileOfType(projectId, laneId, workspaceId, "terminal")
        if (existing) {
          const workbench = selectProjectWorkbench(
            useProjectWorkbenchStore.getState(),
            projectId,
            laneId,
            workspaceId,
          )
          if (workbench?.activeTileId === existing.id) {
            workbenchActions.removeTile(projectId, laneId, existing.id, workspaceId)
          } else {
            workbenchActions.setActiveTile(projectId, laneId, existing.id, workspaceId)
          }
          return
        }
        workbenchActions.addTile(projectId, laneId, "terminal", undefined, workspaceId)
      }),
      runKeybinding("terminal.new", () => {
        workbenchActions.addTile(projectId, laneId, "terminal", undefined, workspaceId)
      }),
      runKeybinding("terminal.split", () => {
        workbenchActions.addTile(projectId, laneId, "terminal", undefined, workspaceId)
      }),
      runKeybinding("terminal.close", () => {
        closeActiveOfType("terminal")
      }),
      runKeybinding("chat.new", () => {
        workbenchActions.addTile(projectId, laneId, "assistantChat", undefined, workspaceId)
      }),
      runKeybinding("chat.newLocal", () => {
        workbenchActions.addTile(projectId, laneId, "assistantChat", {
          title: "Local chat",
        }, workspaceId)
      }),
      runKeybinding("diff.toggle", () => {
        void navigate(buildProjectPath(projectId, "changes"))
      }),
      runKeybinding("editor.openFavorite", () => {
        addOrFocusTile("selection")
      }),
      runKeybinding("modelPicker.toggle", () => {
        window.dispatchEvent(new CustomEvent("cozea:toggle-model-picker"))
        const chat = findActiveTileOfType(projectId, laneId, workspaceId, "assistantChat")
        if (chat) {
          workbenchActions.setActiveTile(projectId, laneId, chat.id, workspaceId)
        } else {
          workbenchActions.addTile(projectId, laneId, "assistantChat", undefined, workspaceId)
        }
      }),
      {
        id: "workbench.openSettings",
        title: "Workbench: Open Settings",
        description: "Open project settings overlay",
        group: "Workbench",
        searchTerms: ["settings", "preferences", "config"],
        run: () => {
          context.openSettings()
        },
      },
      {
        id: "workbench.openTasks",
        title: "Workbench: Open Tasks",
        description: "Open the project tasks board",
        group: "Workbench",
        searchTerms: ["tasks", "board", "todo"],
        run: () => {
          void navigate(buildProjectPath(projectId, "tasks"))
        },
      },
      {
        id: "workbench.openBrowser",
        title: "Workbench: Open Browser",
        description: "Add or focus a browser tile",
        group: "Workbench",
        searchTerms: ["browser", "preview", "webview"],
        run: () => {
          addOrFocusTile("browser")
        },
      },
      {
        id: "workbench.openLauncher",
        title: "Workbench: Add DevApp",
        description: "Open the tile launcher / selection surface",
        group: "Workbench",
        searchTerms: ["launcher", "devapp", "add tile", "selection"],
        run: () => {
          addOrFocusTile("selection")
        },
      },
    ]

    return commands
  }, [
    context.isSettingsOpen,
    context.laneId,
    context.openSettings,
    context.projectId,
    context.workspaceId,
    navigate,
    workbenchActions,
  ])
}

export function executeKeybindingCommand(
  command: KeybindingCommand,
  commands: ReadonlyArray<CommandPaletteCommand>,
): boolean {
  const match = commands.find((entry) => entry.keybindingCommand === command || entry.id === command)
  if (!match) return false
  void match.run()
  return true
}
