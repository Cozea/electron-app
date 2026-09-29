import { useMemo } from "react"
import { useQuery } from "convex/react"
import { api } from "../../../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"
import { useTheme } from "@/contexts/ThemeContext"

import type { KeybindingCommand } from "@cozea/assistant-contracts"

import { resolveDevAppPreviewManifestPath } from "@/features/devapps/model/devAppPreviewSelection"
import { useNavigateTo } from "@/lib/navigation"
import { type WorkbenchTileType } from "@/lib/workbenchTileContract"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"
import { commandLabel } from "./commandLabels"
import type { CommandPaletteCommand } from "./CommandPalette.logic"
import { toggleCommandPalette } from "./commandPaletteBus"

export interface WorkbenchCommandRegistryContext {
  readonly projectId: string | null
  readonly laneId?: string | null
  readonly workspaceId?: string | null
  readonly projectRootPath?: string | null
  readonly openSettings?: () => void
  readonly closeSettings?: () => void
  readonly isSettingsOpen?: boolean
}

function findActiveTileOfType(
  projectId: string,
  laneId: string,
  workspaceId: string | null,
  type: WorkbenchTileType,
) {
  const workbench = selectProjectWorkbench(
    projectId,
    laneId,
    workspaceId,
  )(useProjectWorkbenchStore.getState())
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
  const navigateTo = useNavigateTo()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const { principalId } = useAuth()
  const { setTheme } = useTheme()
  const accessibleProjects = useQuery(
    api.projects.listSummariesForCurrentUser,
    principalId ? { principalId } : "skip",
  )

  return useMemo(() => {
    const { projectId, laneId, workspaceId } = context

    const navigationCommands: CommandPaletteCommand[] = [
      {
        id: "nav.projects",
        title: "Navigation: Projects",
        description: "Go to projects overview",
        group: "Navigation",
        searchTerms: ["projects", "home", "launch", "overview"],
        run: () => {
          void navigateTo({ to: "projects" })
        },
      },
      {
        id: "nav.store",
        title: "Navigation: DevApps Store",
        description: "Browse and install DevApps",
        group: "Navigation",
        searchTerms: ["devapps", "store", "marketplace", "apps"],
        run: () => {
          void navigateTo({ to: "store" })
        },
      },
      {
        id: "nav.skills",
        title: "Navigation: Agent Skills",
        description: "View and manage agent skills",
        group: "Navigation",
        searchTerms: ["skills", "agent", "builds", "capabilities"],
        run: () => {
          void navigateTo({ to: "skills" })
        },
      },
      {
        id: "nav.tasks",
        title: "Navigation: Scheduled Tasks",
        description: "View and configure scheduled tasks",
        group: "Navigation",
        searchTerms: ["scheduled", "tasks", "cron", "schedules"],
        run: () => {
          void navigateTo({ to: "skills", view: "schedules" })
        },
      },
      {
        id: "nav.inbox",
        title: "Navigation: Inbox",
        description: "View notifications and alerts",
        group: "Navigation",
        searchTerms: ["inbox", "notifications", "alerts", "messages"],
        run: () => {
          void navigateTo({ to: "inbox" })
        },
      },
      {
        id: "nav.settingsAccount",
        title: "Settings: Account",
        description: "Device identity and account preferences",
        group: "Settings",
        searchTerms: ["account", "profile", "identity", "device", "settings"],
        run: () => {
          void navigateTo({ to: "settings", section: "account" })
        },
      },
      {
        id: "nav.settingsAppearance",
        title: "Settings: Appearance",
        description: "Themes, retro icons, and display",
        group: "Settings",
        searchTerms: ["appearance", "theme", "dark", "light", "colors", "icons", "settings"],
        run: () => {
          void navigateTo({ to: "settings", section: "appearance" })
        },
      },
      {
        id: "nav.settingsTooling",
        title: "Settings: Tooling",
        description: "AI providers, local runtimes, and tooling",
        group: "Settings",
        searchTerms: ["tooling", "providers", "ai", "models", "antigravity", "settings"],
        run: () => {
          void navigateTo({ to: "settings", section: "tooling" })
        },
      },
      {
        id: "nav.settingsOrganizations",
        title: "Settings: Organizations",
        description: "Organization memberships and device groups",
        group: "Settings",
        searchTerms: ["organizations", "orgs", "teams", "groups", "settings"],
        run: () => {
          void navigateTo({ to: "settings", section: "organizations" })
        },
      },
      {
        id: "nav.settingsDevApps",
        title: "Settings: DevApps",
        description: "Development apps and packages configuration",
        group: "Settings",
        searchTerms: ["devapps", "packages", "apps", "settings"],
        run: () => {
          void navigateTo({ to: "settings", section: "devapps" })
        },
      },
      {
        id: "theme.setDark",
        title: "Theme: Dark",
        description: "Switch to dark theme",
        group: "Preferences",
        searchTerms: ["theme", "dark", "mode", "color"],
        run: () => {
          setTheme("dark")
        },
      },
      {
        id: "theme.setLight",
        title: "Theme: Light",
        description: "Switch to light theme",
        group: "Preferences",
        searchTerms: ["theme", "light", "mode", "color"],
        run: () => {
          setTheme("light")
        },
      },
      {
        id: "theme.setSystem",
        title: "Theme: System",
        description: "Match system appearance",
        group: "Preferences",
        searchTerms: ["theme", "system", "auto", "mode", "color"],
        run: () => {
          setTheme("system")
        },
      },
    ]

    const projectCommands: CommandPaletteCommand[] = (accessibleProjects ?? []).map((p) => ({
      id: `project.open.${p._id}`,
      title: `Project: ${p.name}`,
      description: `Open ${p.name} workbench`,
      group: "Projects",
      searchTerms: [p.name, p.slug ?? "", "project", "open", "switch"],
      run: () => {
        void navigateTo({ to: "workbench", projectId: String(p._id) })
      },
    }))

    const baseCommands: CommandPaletteCommand[] = [
      {
        id: "commandPalette.toggle",
        keybindingCommand: "commandPalette.toggle",
        title: commandLabel("commandPalette.toggle"),
        group: "Actions",
        searchTerms: ["commandPalette.toggle", commandLabel("commandPalette.toggle")],
        run: () => {
          toggleCommandPalette()
        },
      },
      ...navigationCommands,
      ...projectCommands,
    ]

    if (!projectId || !laneId) {
      return baseCommands
    }

    const resolvedLaneId = laneId
    const resolvedWorkspaceId = workspaceId ?? null

    const addOrFocusTile = (type: Extract<WorkbenchTileType, "terminal" | "assistantChat" | "browser" | "tasks" | "selection">) => {
      if (type === "selection" || type === "tasks") {
        workbenchActions.addTile(projectId, resolvedLaneId, type, undefined, resolvedWorkspaceId)
        return
      }
      const existing = findActiveTileOfType(projectId, resolvedLaneId, resolvedWorkspaceId, type)
      if (type === "terminal" || type === "assistantChat" || type === "browser") {
        if (existing && type !== "assistantChat") {
          // Toggle: focus existing terminal/browser; for chat always allow new via chat.new
          workbenchActions.setActiveTile(projectId, resolvedLaneId, existing.id, resolvedWorkspaceId)
          return
        }
      }
      workbenchActions.addTile(projectId, resolvedLaneId, type, undefined, resolvedWorkspaceId)
    }

    const closeActiveOfType = (type: WorkbenchTileType) => {
      const workbench = selectProjectWorkbench(
        projectId,
        resolvedLaneId,
        resolvedWorkspaceId,
      )(useProjectWorkbenchStore.getState())
      if (!workbench) return
      const activeId = workbench.activeTileId
      const active = activeId ? workbench.tiles[activeId] : null
      if (active?.type === type) {
        workbenchActions.removeTile(projectId, resolvedLaneId, active.id, resolvedWorkspaceId)
        return
      }
      const first = findActiveTileOfType(projectId, resolvedLaneId, resolvedWorkspaceId, type)
      if (first) {
        workbenchActions.removeTile(projectId, resolvedLaneId, first.id, resolvedWorkspaceId)
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

    const workbenchCommands: CommandPaletteCommand[] = [
      runKeybinding("terminal.toggle", () => {
        const existing = findActiveTileOfType(projectId, resolvedLaneId, resolvedWorkspaceId, "terminal")
        if (existing) {
          const workbench = selectProjectWorkbench(
            projectId,
            resolvedLaneId,
            resolvedWorkspaceId,
          )(useProjectWorkbenchStore.getState())
          if (workbench?.activeTileId === existing.id) {
            workbenchActions.removeTile(projectId, resolvedLaneId, existing.id, resolvedWorkspaceId)
          } else {
            workbenchActions.setActiveTile(projectId, resolvedLaneId, existing.id, resolvedWorkspaceId)
          }
          return
        }
        workbenchActions.addTile(projectId, resolvedLaneId, "terminal", undefined, resolvedWorkspaceId)
      }),
      runKeybinding("terminal.new", () => {
        workbenchActions.addTile(projectId, resolvedLaneId, "terminal", undefined, resolvedWorkspaceId)
      }),
      runKeybinding("terminal.split", () => {
        workbenchActions.addTile(projectId, resolvedLaneId, "terminal", undefined, resolvedWorkspaceId)
      }),
      runKeybinding("terminal.close", () => {
        closeActiveOfType("terminal")
      }),
      runKeybinding("chat.new", () => {
        workbenchActions.addTile(projectId, resolvedLaneId, "assistantChat", undefined, resolvedWorkspaceId)
      }),
      runKeybinding("chat.newLocal", () => {
        workbenchActions.addTile(projectId, resolvedLaneId, "assistantChat", {
          title: "Local chat",
        }, resolvedWorkspaceId)
      }),
      runKeybinding("diff.toggle", () => {
        void navigateTo({ to: "workbench", projectId: projectId, changes: true })
      }),
      runKeybinding("editor.openFavorite", () => {
        addOrFocusTile("selection")
      }),
      runKeybinding("modelPicker.toggle", () => {
        window.dispatchEvent(new CustomEvent("cozea:toggle-model-picker"))
        const chat = findActiveTileOfType(projectId, resolvedLaneId, resolvedWorkspaceId, "assistantChat")
        if (chat) {
          workbenchActions.setActiveTile(projectId, resolvedLaneId, chat.id, resolvedWorkspaceId)
        } else {
          workbenchActions.addTile(projectId, resolvedLaneId, "assistantChat", undefined, resolvedWorkspaceId)
        }
      }),
      {
        id: "workbench.openSettings",
        title: "Workbench: Open Settings",
        description: "Open project settings overlay",
        group: "Workbench",
        searchTerms: ["settings", "preferences", "config"],
        run: () => {
          context.openSettings?.()
        },
      },
      {
        id: "workbench.openTasks",
        title: "Workbench: Open Tasks",
        description: "Open the project tasks board",
        group: "Workbench",
        searchTerms: ["tasks", "board", "todo"],
        run: () => {
          void navigateTo({ to: "tasks", projectId: projectId })
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
      {
        id: "workbench.previewDevApp",
        title: "Workbench: Preview DevApp Package",
        description: "Open a cozea-devapp.json package from this project",
        group: "Workbench",
        searchTerms: ["devapp", "development", "package", "preview", "cozea-devapp.json"],
        run: async () => {
          if (!workspaceId || !context.projectRootPath) {
            await showDevAppPreviewSelectionError(
              "This workspace is not ready to open a development preview yet.",
            )
            return
          }

          const selection = await window.electronAPI.dialog.selectFile({
            title: "Select cozea-devapp.json",
            filters: [{ name: "Cozea DevApp manifest", extensions: ["json"] }],
          })
          if (!selection.success || !selection.path) return

          const relativePath = resolveDevAppPreviewManifestPath(
            context.projectRootPath,
            selection.path,
          )
          if (!relativePath) {
            await showDevAppPreviewSelectionError(
              "Choose a cozea-devapp.json file from inside this project.",
            )
            return
          }

          workbenchActions.addTile(
            projectId,
            resolvedLaneId,
            "devAppPreview",
            {
              devAppPreviewRelativePath: relativePath,
            },
            resolvedWorkspaceId,
          )
        },
      },
    ]

    return [...baseCommands, ...workbenchCommands]
  }, [
    accessibleProjects,
    context.isSettingsOpen,
    context.laneId,
    context.openSettings,
    context.projectRootPath,
    context.projectId,
    context.workspaceId,
    navigateTo,
    setTheme,
    workbenchActions,
  ])
}

async function showDevAppPreviewSelectionError(detail: string): Promise<void> {
  await window.electronAPI.dialog.showMessageBox({
    type: "error",
    buttons: ["OK"],
    defaultId: 0,
    title: "Could not preview DevApp",
    message: "Cozea couldn't open that development package.",
    detail,
    noLink: true,
  })
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
