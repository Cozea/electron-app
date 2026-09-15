import { useTranslation } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { MouseEvent } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvailableExternalEditor, ExternalEditorId } from "@shared/electronApiTypes"
import {
  openProjectFileInExternalEditor,
  orderDetectedEditors,
  PREVIEW_EDITOR_PREFERENCE_KEY,
  readStoredExternalEditorPreference,
  resolvePreferredExternalEditorId,
} from "@/features/settings/model/externalEditorPreference"
import { getExternalEditorIcon, GenericCodeIcon } from "@/features/settings/model/externalEditorIcons"

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon as __ChevronDownHugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchHeaderEditorControlProps {
  workspaceId: string | null
  /** When the project drawer is open, use sidebar palette so icons read on glass/vibrancy. */
  adjacentOpenSidebar?: boolean
}

export function WorkbenchHeaderEditorControl({
  workspaceId,
  adjacentOpenSidebar = false,
}: WorkbenchHeaderEditorControlProps) {
  const { t } = useTranslation()
  const [availableEditors, setAvailableEditors] = useState<AvailableExternalEditor[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState<ExternalEditorId | null>(() =>
    readStoredExternalEditorPreference(),
  )

  useEffect(() => {
    let cancelled = false

    void window.electronAPI.editor
      .listAvailableEditors()
      .then((editors) => {
        if (cancelled) return
        setAvailableEditors(editors)
      })
      .catch(() => {
        if (cancelled) return
        setAvailableEditors([])
      })

    return () => {
      cancelled = true
    }
  }, [])

  const orderedEditors = useMemo(
    () => orderDetectedEditors(availableEditors),
    [availableEditors],
  )

  useEffect(() => {
    const resolvedEditorId = resolvePreferredExternalEditorId(
      orderedEditors,
      selectedEditorId,
    )
    if (resolvedEditorId === selectedEditorId) return
    setSelectedEditorId(resolvedEditorId)
  }, [orderedEditors, selectedEditorId])

  useEffect(() => {
    if (!selectedEditorId) return
    window.localStorage.setItem(PREVIEW_EDITOR_PREFERENCE_KEY, selectedEditorId)
  }, [selectedEditorId])

  const selectedEditor = useMemo(
    () => orderedEditors.find((editor) => editor.id === selectedEditorId) ?? orderedEditors[0] ?? null,
    [orderedEditors, selectedEditorId],
  )

  const handleOpenProjectInEditor = useCallback(() => {
    if (!workspaceId) return

    void openProjectFileInExternalEditor({
      availableEditors: orderedEditors,
      filePath: ".",
      preferredEditorId: selectedEditor?.id ?? selectedEditorId,
      workspaceId,
    }).then((result) => {
      if (!result.success) {
        console.error("[Workbench] Failed to open project in external editor", result.error)
      }
    })
  }, [orderedEditors, workspaceId, selectedEditorId, selectedEditor])

  const handleShowEditorPicker = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (orderedEditors.length === 0) return

      const rect = event.currentTarget.getBoundingClientRect()
      const { editorId } = await window.electronAPI.contextMenu.showOpenInEditorPicker({
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 4),
        editors: orderedEditors.map((editor) => ({ id: editor.id, name: editor.name })),
        selectedEditorId: selectedEditor?.id ?? selectedEditorId,
      })
      if (editorId) {
        setSelectedEditorId(editorId)
      }
    },
    [orderedEditors, selectedEditorId, selectedEditor],
  )

  const SelectedEditorIcon = selectedEditor ? getExternalEditorIcon(selectedEditor.id) : GenericCodeIcon
  const hasPicker = orderedEditors.length > 1

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "inline-flex items-center rounded-md border shadow-xs shrink-0",
            adjacentOpenSidebar
              ? "border-sidebar-border/50 bg-sidebar/60"
              : "border-border/50 bg-background/60",
          )}
        >
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-7 px-2 text-xs border-0 font-normal transition-colors shrink-0",
              hasPicker ? "rounded-l-md rounded-r-none" : "rounded-md",
              adjacentOpenSidebar
                ? "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
            )}
            onClick={handleOpenProjectInEditor}
            disabled={!workspaceId || !selectedEditor}
            aria-label={
              selectedEditor
                ? t("workbench.editor.openIn").replace("{editor}", selectedEditor.name)
                : t("workbench.editor.noEditor")
            }
          >
            <SelectedEditorIcon className="size-3.5 shrink-0 transition-colors" />
          </Button>

          {hasPicker ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 w-5 p-0 rounded-l-none rounded-r-md border-y-0 border-r-0 border-l transition-colors shrink-0",
                adjacentOpenSidebar
                  ? "border-sidebar-border/40 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-accent/60",
              )}
              aria-label="Choose editor"
              aria-haspopup="menu"
              disabled={!workspaceId}
              onClick={handleShowEditorPicker}
            >
              <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-2.5 shrink-0" />
            </Button>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {selectedEditor ? t("workbench.editor.openIn").replace("{editor}", selectedEditor.name) : t("workbench.editor.noEditor")}
      </TooltipContent>
    </Tooltip>
  )
}
