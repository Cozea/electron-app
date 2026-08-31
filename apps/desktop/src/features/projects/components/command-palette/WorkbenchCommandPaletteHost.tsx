import { useCallback, useEffect, useState } from "react"

import { featureFlags } from "@/lib/featureFlags"
import {
  isTerminalElementFocused,
  resolveShortcutCommand,
} from "@/lib/keybindings/matchShortcut"
import { CommandPalette } from "./CommandPalette"
import {
  onOpenCommandPalette,
  onToggleCommandPalette,
} from "./commandPaletteBus"
import { useKeybindingsConfig } from "./useKeybindingsConfig"
import {
  executeKeybindingCommand,
  useWorkbenchCommandRegistry,
} from "./useWorkbenchCommandRegistry"

export interface WorkbenchCommandPaletteHostProps {
  readonly projectId: string | null
  readonly laneId: string
  readonly workspaceId: string | null
  readonly projectRootPath: string | null
  readonly openSettings: () => void
  readonly closeSettings: () => void
  readonly isSettingsOpen: boolean
}

export function WorkbenchCommandPaletteHost(props: WorkbenchCommandPaletteHostProps) {
  const enabled = featureFlags.paletteEnabled
  const [open, setOpen] = useState(false)
  const [initialQuery, setInitialQuery] = useState("")
  const { keybindings, issues } = useKeybindingsConfig()

  const commands = useWorkbenchCommandRegistry({
    projectId: props.projectId,
    laneId: props.laneId,
    workspaceId: props.workspaceId,
    projectRootPath: props.projectRootPath,
    openSettings: props.openSettings,
    closeSettings: props.closeSettings,
    isSettingsOpen: props.isSettingsOpen,
  })

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setInitialQuery("")
  }, [])

  useEffect(() => {
    if (!enabled) return

    const unsubscribeOpen = onOpenCommandPalette((detail) => {
      setInitialQuery(detail.query ?? "")
      setOpen(true)
    })
    const unsubscribeToggle = onToggleCommandPalette(() => {
      setOpen((current) => !current)
    })

    return () => {
      unsubscribeOpen()
      unsubscribeToggle()
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.repeat) return

      const terminalFocus = isTerminalElementFocused(event.target)
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus,
          terminalOpen: terminalFocus,
        },
      })

      if (!command) return

      // When the palette is already open, only handle its own toggle (and Escape via dialog).
      if (open && command !== "commandPalette.toggle") {
        return
      }

      // Let editable fields keep typing except for palette toggle / global chords with mod.
      const target = event.target as HTMLElement | null
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      if (isEditable && command !== "commandPalette.toggle") {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (command === "commandPalette.toggle") {
        setOpen((current) => !current)
        return
      }

      executeKeybindingCommand(command, commands)
    }

    window.addEventListener("keydown", onKeyDown, { capture: true })
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true })
  }, [commands, enabled, keybindings, open])

  if (!enabled) {
    return null
  }

  return (
    <CommandPalette
      open={open}
      onOpenChange={handleOpenChange}
      commands={commands}
      keybindings={keybindings}
      issues={issues}
      initialQuery={initialQuery}
    />
  )
}
