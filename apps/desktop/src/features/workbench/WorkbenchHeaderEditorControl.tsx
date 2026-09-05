import { useTranslation } from "@/lib/i18n"
import { useCallback, useEffect, useMemo, useState } from "react"
import { SiClion, SiDatagrip, SiGoland, SiIntellijidea, SiPhpstorm, SiPycharm, SiRider, SiRubymine, SiWebstorm } from "react-icons/si"
import { VscVscodeInsiders } from "react-icons/vsc"
import type { ComponentType, MouseEvent, SVGProps } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvailableExternalEditor, ExternalEditorId } from "@shared/electronApiTypes"
import {

  openProjectFileInExternalEditor,
  PREVIEW_EDITOR_PREFERENCE_KEY,
  readStoredExternalEditorPreference,
  resolvePreferredExternalEditorId,
} from "@/features/settings/model/externalEditorPreference"
import {
  AntigravityIcon,
  CursorIcon,
  FinderIcon,
  VisualStudioCodeIcon,
  ZedIcon,
} from "@/components/EditorBrandIcons"

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon as __ChevronDownHugeIcon, CodeCircleIcon as __Code2HugeIcon } from '@hugeicons/core-free-icons'

const Code2 = (props: any) => <HugeiconsIcon icon={__Code2HugeIcon} {...props} />

interface WorkbenchHeaderEditorControlProps {
  workspaceId: string | null
  /** When the project drawer is open, use sidebar palette so icons read on glass/vibrancy. */
  adjacentOpenSidebar?: boolean
}

interface OrderedEditorOption {
  editor: AvailableExternalEditor
  Icon: ComponentType<SVGProps<SVGSVGElement>>
}

const T3_STYLE_EDITOR_ORDER: ReadonlyArray<ExternalEditorId> = [
  "cursor",
  "vscode",
  "zed",
  "antigravity",
  "windsurf",
  "vscode-insiders",
  "vscodium",
  "webstorm",
  "intellij-idea",
  "phpstorm",
  "pycharm",
  "rider",
  "goland",
  "rubymine",
  "clion",
  "datagrip",
  "finder",
]

function getWorkbenchEditorIcon(editorId: ExternalEditorId): ComponentType<SVGProps<SVGSVGElement>> {
  switch (editorId) {
    case "vscode":
    case "vscodium":
      return VisualStudioCodeIcon
    case "vscode-insiders":
      return VscVscodeInsiders
    case "zed":
      return ZedIcon
    case "webstorm":
      return SiWebstorm
    case "intellij-idea":
      return SiIntellijidea
    case "phpstorm":
      return SiPhpstorm
    case "pycharm":
      return SiPycharm
    case "rider":
      return SiRider
    case "goland":
      return SiGoland
    case "rubymine":
      return SiRubymine
    case "clion":
      return SiClion
    case "datagrip":
      return SiDatagrip
    case "cursor":
      return CursorIcon
    case "windsurf":
      return Code2
    case "antigravity":
      return AntigravityIcon
    case "finder":
      return FinderIcon
    default:
      return Code2
  }
}

function orderDetectedEditors(availableEditors: ReadonlyArray<AvailableExternalEditor>): OrderedEditorOption[] {
  const byId = new Map(availableEditors.map((editor) => [editor.id, editor] as const))
  const seen = new Set<ExternalEditorId>()
  const ordered: OrderedEditorOption[] = []

  for (const editorId of T3_STYLE_EDITOR_ORDER) {
    const editor = byId.get(editorId)
    if (!editor) continue
    ordered.push({
      editor,
      Icon: getWorkbenchEditorIcon(editor.id),
    })
    seen.add(editor.id)
  }

  for (const editor of availableEditors) {
    if (seen.has(editor.id)) continue
    ordered.push({
      editor,
      Icon: getWorkbenchEditorIcon(editor.id),
    })
  }

  return ordered
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
      orderedEditors.map(({ editor }) => editor),
      selectedEditorId,
    )
    if (resolvedEditorId === selectedEditorId) return
    setSelectedEditorId(resolvedEditorId)
  }, [orderedEditors, selectedEditorId])

  useEffect(() => {
    if (!selectedEditorId) return
    window.localStorage.setItem(PREVIEW_EDITOR_PREFERENCE_KEY, selectedEditorId)
  }, [selectedEditorId])

  const selectedEditorOption = useMemo(
    () => orderedEditors.find(({ editor }) => editor.id === selectedEditorId) ?? orderedEditors[0] ?? null,
    [orderedEditors, selectedEditorId],
  )

  const handleOpenProjectInEditor = useCallback(() => {
    if (!workspaceId) return

    void openProjectFileInExternalEditor({
      availableEditors: orderedEditors.map(({ editor }) => editor),
      filePath: ".",
      preferredEditorId: selectedEditorOption?.editor.id ?? selectedEditorId,
      workspaceId,
    }).then((result) => {
      if (!result.success) {
        console.error("[Workbench] Failed to open project in external editor", result.error)
      }
    })
  }, [orderedEditors, workspaceId, selectedEditorId, selectedEditorOption])

  const handleShowEditorPicker = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      event.stopPropagation()
      if (orderedEditors.length === 0) return

      const rect = event.currentTarget.getBoundingClientRect()
      const { editorId } = await window.electronAPI.contextMenu.showOpenInEditorPicker({
        x: Math.round(rect.left),
        y: Math.round(rect.bottom + 4),
        editors: orderedEditors.map(({ editor }) => ({ id: editor.id, name: editor.name })),
        selectedEditorId: selectedEditorOption?.editor.id ?? selectedEditorId,
      })
      if (editorId) {
        setSelectedEditorId(editorId)
      }
    },
    [orderedEditors, selectedEditorId, selectedEditorOption],
  )

  const SelectedEditorIcon = selectedEditorOption?.Icon ?? Code2

  const chromeButtonClass = adjacentOpenSidebar
    ? "text-sidebar-foreground shadow-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    : "text-muted-foreground shadow-none hover:bg-muted/60 hover:text-foreground"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group inline-flex h-7 items-center rounded-md bg-transparent shadow-none">
          <Button
            variant="ghost"
            className={cn("h-7 shrink-0 rounded-md bg-transparent !px-1.5 shadow-none hover:bg-muted/40", chromeButtonClass)}
            onClick={handleOpenProjectInEditor}
            disabled={!workspaceId || !selectedEditorOption}
            aria-label={
              selectedEditorOption
                ? t("workbench.editor.openIn").replace("{editor}", selectedEditorOption.editor.name)
                : t("workbench.editor.noEditor")
            }
          >
            <SelectedEditorIcon className="size-5 shrink-0 text-muted-foreground/75 transition-colors group-hover:text-foreground group-focus-within:text-foreground" />
          </Button>

          {orderedEditors.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              className={cn(
                "inline-flex h-7 w-5 shrink-0 items-center justify-center rounded-md bg-transparent px-0 shadow-none hover:bg-muted/40",
                chromeButtonClass,
              )}
              aria-label="Choose editor"
              aria-haspopup="menu"
              onClick={handleShowEditorPicker}
            >
              <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3 shrink-0 text-muted-foreground/75 transition-colors group-hover:text-foreground group-focus-within:text-foreground" />
            </Button>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {selectedEditorOption ? t("workbench.editor.openIn").replace("{editor}", selectedEditorOption.editor.name) : t("workbench.editor.noEditor")}
      </TooltipContent>
    </Tooltip>
  )
}
