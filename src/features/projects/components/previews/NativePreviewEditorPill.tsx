import { createElement, memo, useMemo } from 'react'
import { ChevronDown, Code2 } from 'lucide-react'
import { SiClion, SiDatagrip, SiGoland, SiIntellijidea, SiPhpstorm, SiPycharm, SiRider, SiRubymine, SiWebstorm, SiZedindustries } from 'react-icons/si'
import { VscVscode, VscVscodeInsiders } from 'react-icons/vsc'
import type { IconType } from 'react-icons'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'

interface NativePreviewEditorPillProps {
  availableEditors: AvailableExternalEditor[]
  onOpenCode: () => void
  onSelectedEditorChange: (editorId: ExternalEditorId) => void
  selectedEditorId: ExternalEditorId
}

function getEditorIcon(editorId: ExternalEditorId): IconType {
  switch (editorId) {
    case 'vscode':
    case 'vscodium':
      return VscVscode
    case 'vscode-insiders':
      return VscVscodeInsiders
    case 'zed':
      return SiZedindustries
    case 'webstorm':
      return SiWebstorm
    case 'intellij-idea':
      return SiIntellijidea
    case 'phpstorm':
      return SiPhpstorm
    case 'pycharm':
      return SiPycharm
    case 'rider':
      return SiRider
    case 'goland':
      return SiGoland
    case 'rubymine':
      return SiRubymine
    case 'clion':
      return SiClion
    case 'datagrip':
      return SiDatagrip
    case 'cursor':
    case 'windsurf':
    case 'antigravity':
      return Code2
    default:
      return Code2
  }
}

export const NativePreviewEditorPill = memo(function NativePreviewEditorPill({
  availableEditors,
  onOpenCode,
  onSelectedEditorChange,
  selectedEditorId,
}: NativePreviewEditorPillProps) {
  const selectedEditor = useMemo(() => {
    return availableEditors.find((editor) => editor.id === selectedEditorId)
      ?? availableEditors[0]
      ?? null
  }, [availableEditors, selectedEditorId])

  const selectedEditorIcon = getEditorIcon(selectedEditor?.id ?? 'cursor')
  const showEditorPicker = availableEditors.length > 1

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
        onClick={onOpenCode}
        disabled={!selectedEditor}
      >
        {createElement(selectedEditorIcon, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
        <span className="text-xs text-muted-foreground">Editor</span>
      </Button>

      {showEditorPicker ? (
        <>
          <div className="h-4 w-px bg-border/60" aria-hidden />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-6 rounded-none border-0 bg-transparent shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
                aria-label="Choose editor"
              >
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Open in editor</div>
              <DropdownMenuRadioGroup
                value={selectedEditorId}
                onValueChange={(value) => onSelectedEditorChange(value as ExternalEditorId)}
              >
                {availableEditors.map((editor) => {
                  const EditorIcon = getEditorIcon(editor.id)
                  return (
                    <DropdownMenuRadioItem key={editor.id} value={editor.id}>
                      <EditorIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                      {editor.name}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  )
})
