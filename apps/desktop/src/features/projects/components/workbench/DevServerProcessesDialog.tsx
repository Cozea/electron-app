import { useEffect, useMemo, useState } from "react"

import type { DevServerAuxiliaryProcessConfig } from "@shared/electronApiTypes"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  EMPTY_DEV_SERVER_AUXILIARY_PROCESSES,
  MAX_DEV_SERVER_AUXILIARY_PROCESSES,
  MAX_DEV_SERVER_PROCESS_COMMAND_LENGTH,
  MAX_DEV_SERVER_PROCESS_NAME_LENGTH,
  normalizeDevServerAuxiliaryProcesses,
  useDevServerProcessConfigStore,
} from "@/features/projects/devserver/devServerProcessConfigStore"
import {
  restartDevServerRun,
  updateDevServerRunAuxiliaryProcesses,
} from "@/features/projects/devserver/devServerRunStore"
import { useTranslation } from "@/lib/i18n"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon as __AddHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
} from "@hugeicons/core-free-icons"

interface DevServerProcessesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  runKey: string
  running: boolean
}

function createProcess(): DevServerAuxiliaryProcessConfig {
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `process-${Date.now()}`,
    name: "",
    command: "",
  }
}

export function DevServerProcessesDialog({
  open,
  onOpenChange,
  workspaceId,
  runKey,
  running,
}: DevServerProcessesDialogProps) {
  const { t } = useTranslation()
  const savedProcesses = useDevServerProcessConfigStore(
    (state) =>
      state.byWorkspace[workspaceId] ?? EMPTY_DEV_SERVER_AUXILIARY_PROCESSES,
  )
  const saveProcesses = useDevServerProcessConfigStore(
    (state) => state.actions.setForWorkspace,
  )
  const [draft, setDraft] = useState<DevServerAuxiliaryProcessConfig[]>(savedProcesses)
  // Saved processes read as a compact list; details belong to the one row the
  // user is actually editing, so expansion is single-select.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(savedProcesses.map((process) => ({ ...process })))
      setExpandedId(null)
    }
  }, [open, savedProcesses])

  // A row added by the user opens straight into its name field. Expanding an
  // existing row leaves focus on the trigger, where keyboard users expect it.
  useEffect(() => {
    if (!pendingFocusId) return
    document.getElementById(`dev-process-name-${pendingFocusId}`)?.focus()
    setPendingFocusId(null)
  }, [pendingFocusId])

  const isValid = useMemo(
    () => draft.every((process) => process.name.trim() && process.command.trim()),
    [draft],
  )

  const updateProcess = (
    id: string,
    update: Partial<DevServerAuxiliaryProcessConfig>,
  ) => {
    setDraft((current) =>
      current.map((process) => (process.id === id ? { ...process, ...update } : process)),
    )
  }

  const removeProcess = (id: string) => {
    setDraft((current) => current.filter((item) => item.id !== id))
    setExpandedId((current) => (current === id ? null : current))
  }

  const addProcess = () => {
    const next = createProcess()
    setDraft((current) => [...current, next])
    setExpandedId(next.id)
    setPendingFocusId(next.id)
  }

  const handleSave = () => {
    if (!isValid) return
    const normalized = normalizeDevServerAuxiliaryProcesses(draft)
    saveProcesses(workspaceId, normalized)
    updateDevServerRunAuxiliaryProcesses(runKey, normalized)
    onOpenChange(false)
    if (running) {
      void restartDevServerRun(runKey)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(82vh,44rem)] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="text-lg">{t("workbench.devserver.processes.title")}</DialogTitle>
          <DialogDescription className="text-xs leading-5">
            {t("workbench.devserver.processes.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5">
          <div className="flex h-12 items-center justify-between border-b border-border/60">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">
                {t("workbench.devserver.processes.frontend")}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("workbench.devserver.processes.automatic")}
              </div>
            </div>
            <span className="rounded-md bg-secondary px-2 py-1 text-xs font-medium text-muted-foreground">
              {t("workbench.devserver.processes.default")}
            </span>
          </div>

          {draft.map((process) => {
            const expanded = expandedId === process.id
            const trimmedName = process.name.trim()
            const trimmedCommand = process.command.trim()
            return (
              <Collapsible
                key={process.id}
                open={expanded}
                onOpenChange={(nextOpen) =>
                  setExpandedId(nextOpen ? process.id : null)
                }
              >
                <div className="border-b border-border/60">
                  <CollapsibleTrigger
                    className="flex h-12 w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    aria-label={t("workbench.devserver.processes.toggleDetails")}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {trimmedName || t("workbench.devserver.processes.untitled")}
                      </div>
                      <div
                        className={cn(
                          "truncate text-[11px] text-muted-foreground",
                          trimmedCommand && "font-mono",
                        )}
                      >
                        {trimmedCommand || t("workbench.devserver.processes.noCommand")}
                      </div>
                    </div>
                    <HugeiconsIcon
                      icon={__ChevronDownHugeIcon}
                      className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                        expanded && "rotate-180",
                      )}
                    />
                  </CollapsibleTrigger>

                  <CollapsiblePanel>
                    <div className="space-y-3 pb-4">
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <Label htmlFor={`dev-process-name-${process.id}`} className="text-xs">
                            {t("workbench.devserver.processes.name")}
                          </Label>
                          <Input
                            id={`dev-process-name-${process.id}`}
                            value={process.name}
                            maxLength={MAX_DEV_SERVER_PROCESS_NAME_LENGTH}
                            placeholder={t("workbench.devserver.processes.namePlaceholder")}
                            onChange={(event) =>
                              updateProcess(process.id, { name: event.target.value })
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label={t("workbench.devserver.processes.remove")}
                          onClick={() => removeProcess(process.id)}
                        >
                          <HugeiconsIcon icon={__DeleteHugeIcon} className="size-4" />
                        </Button>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor={`dev-process-command-${process.id}`} className="text-xs">
                          {t("workbench.devserver.processes.command")}
                        </Label>
                        <Input
                          id={`dev-process-command-${process.id}`}
                          value={process.command}
                          maxLength={MAX_DEV_SERVER_PROCESS_COMMAND_LENGTH}
                          className="font-mono text-xs"
                          placeholder={t("workbench.devserver.processes.commandPlaceholder")}
                          onChange={(event) =>
                            updateProcess(process.id, { command: event.target.value })
                          }
                        />
                      </div>
                    </div>
                  </CollapsiblePanel>
                </div>
              </Collapsible>
            )
          })}

          {draft.length < MAX_DEV_SERVER_AUXILIARY_PROCESSES ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="my-3 -ml-2 text-muted-foreground"
              onClick={addProcess}
            >
              <HugeiconsIcon icon={__AddHugeIcon} className="size-4" />
              {t("workbench.devserver.processes.add")}
            </Button>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/60 px-5 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={!isValid} onClick={handleSave}>
            {running
              ? t("workbench.devserver.processes.saveRestart")
              : t("workbench.devserver.processes.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
