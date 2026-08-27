import { useEffect, useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon as __SearchHugeIcon } from "@hugeicons/core-free-icons"

import type {
  KeybindingCommand,
  ResolvedKeybindingsConfig,
  ServerConfigIssue,
} from "@cozea/assistant-contracts"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { shortcutLabelForCommand } from "@/lib/keybindings/matchShortcut"
import {
  filterCommandPaletteCommands,
  formatKeybindingIssueMessage,
  groupCommandPaletteCommands,
  type CommandPaletteCommand,
} from "./CommandPalette.logic"

export interface CommandPaletteProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly commands: ReadonlyArray<CommandPaletteCommand>
  readonly keybindings: ResolvedKeybindingsConfig
  readonly issues: readonly ServerConfigIssue[]
  readonly initialQuery?: string
}

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  keybindings,
  issues,
  initialQuery = "",
}: CommandPaletteProps) {
  const [query, setQuery] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setQuery(initialQuery)
    setActiveIndex(0)
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [initialQuery, open])

  const filtered = useMemo(
    () => filterCommandPaletteCommands({ commands, query }),
    [commands, query],
  )
  const groups = useMemo(() => groupCommandPaletteCommands(filtered), [filtered])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1))
    }
  }, [activeIndex, filtered.length])

  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>("[data-active='true']")
    active?.scrollIntoView({ block: "nearest" })
  }, [activeIndex, filtered])

  const runCommand = async (command: CommandPaletteCommand | undefined) => {
    if (!command) return
    onOpenChange(false)
    await command.run()
  }

  const keybindingIssues = issues.filter((issue) => issue.kind.startsWith("keybindings."))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-command-palette=""
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActiveIndex((current) =>
              filtered.length === 0 ? 0 : (current + 1) % filtered.length,
            )
          } else if (event.key === "ArrowUp") {
            event.preventDefault()
            setActiveIndex((current) =>
              filtered.length === 0
                ? 0
                : (current - 1 + filtered.length) % filtered.length,
            )
          } else if (event.key === "Enter") {
            event.preventDefault()
            void runCommand(filtered[activeIndex])
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Command palette</DialogTitle>
          <DialogDescription>Search and run workbench commands</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <HugeiconsIcon icon={__SearchHugeIcon} className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commands…"
            aria-label="Search commands"
            className="h-11 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
          <Kbd className="shrink-0">Esc</Kbd>
        </div>

        {keybindingIssues.length > 0 ? (
          <div className="border-b border-border/70 px-3 py-2">
            <Alert variant="destructive" className="rounded-lg px-3 py-2">
              <AlertTitle className="text-xs">Keybindings config issues</AlertTitle>
              <AlertDescription className="text-xs">
                <ul className="mt-1 list-disc space-y-0.5 ps-4">
                  {keybindingIssues.slice(0, 3).map((issue, index) => (
                    <li key={`${issue.kind}-${index}`}>
                      {formatKeybindingIssueMessage(issue)}
                    </li>
                  ))}
                </ul>
                {keybindingIssues.length > 3 ? (
                  <p className="mt-1 text-muted-foreground">
                    +{keybindingIssues.length - 3} more
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <ScrollArea className="max-h-[min(420px,50vh)]">
          <div ref={listRef} className="p-2" role="listbox" aria-label="Commands">
            {filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No matching commands
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.value} className="mb-2">
                  <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const flatIndex = filtered.findIndex((entry) => entry.id === item.id)
                      const isActive = flatIndex === activeIndex
                      const shortcut = item.keybindingCommand
                        ? shortcutLabelForCommand(
                            keybindings,
                            item.keybindingCommand as KeybindingCommand,
                          )
                        : null
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            data-active={isActive ? "true" : "false"}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                              isActive
                                ? "bg-accent text-accent-foreground"
                                : "text-foreground hover:bg-muted/70",
                            )}
                            onMouseEnter={() => setActiveIndex(flatIndex)}
                            onClick={() => {
                              void runCommand(item)
                            }}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{item.title}</span>
                              {item.description ? (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {item.description}
                                </span>
                              ) : null}
                            </span>
                            {shortcut ? <Kbd className="shrink-0">{shortcut}</Kbd> : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
