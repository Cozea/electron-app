import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Code2 } from "lucide-react"
import { SiClion, SiDatagrip, SiGoland, SiIntellijidea, SiPhpstorm, SiPycharm, SiRider, SiRubymine, SiWebstorm } from "react-icons/si"
import { VscVscodeInsiders } from "react-icons/vsc"
import type { ComponentType, MouseEvent, SVGProps } from "react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { AvailableExternalEditor, ExternalEditorId } from "@shared/electronApiTypes"
import {
  openProjectFileInExternalEditor,
  PREVIEW_EDITOR_PREFERENCE_KEY,
  readStoredExternalEditorPreference,
  resolvePreferredExternalEditorId,
} from "@/features/projects/lib/externalEditorPreference"
import {
  AntigravityIcon,
  CursorIcon,
  VisualStudioCodeIcon,
  ZedIcon,
} from "@/features/projects/components/workbench/WorkbenchEditorIcons"

interface WorkbenchHeaderEditorControlProps {
  projectPath: string | null
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
  projectPath,
}: WorkbenchHeaderEditorControlProps) {
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
    if (!projectPath) return

    void openProjectFileInExternalEditor({
      availableEditors: orderedEditors.map(({ editor }) => editor),
      filePath: projectPath,
      preferredEditorId: selectedEditorOption?.editor.id ?? selectedEditorId,
      projectPath,
    }).then((result) => {
      if (!result.success) {
        console.error("[Workbench] Failed to open project in external editor", result.error)
      }
    })
  }, [orderedEditors, projectPath, selectedEditorId, selectedEditorOption])

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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex h-6 items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 rounded-none border-0 bg-transparent px-1.5 shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
            onClick={handleOpenProjectInEditor}
            disabled={!projectPath || !selectedEditorOption}
          >
            <SelectedEditorIcon className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground leading-none">Open</span>
          </Button>

          {orderedEditors.length > 1 ? (
            <>
              <div className="h-3 w-px bg-border/60" aria-hidden />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-5 rounded-none border-0 bg-transparent shadow-none hover:bg-secondary [&_svg]:size-3"
                aria-label="Choose editor"
                aria-haspopup="menu"
                onClick={handleShowEditorPicker}
              >
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {selectedEditorOption ? `Open in ${selectedEditorOption.editor.name}` : "No supported external editor detected"}
      </TooltipContent>
    </Tooltip>
  )
}
