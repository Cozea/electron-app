import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  openProjectFileInExternalEditor,
  orderDetectedEditors,
  PREVIEW_EDITOR_PREFERENCE_KEY,
  readStoredExternalEditorPreference,
  resolvePreferredExternalEditorId,
} from '@/features/settings/model/externalEditorPreference'
import {
  getExternalEditorIcon,
  getExternalEditorKind,
  GenericCodeIcon,
} from '@/features/settings/model/externalEditorIcons'
import {
  CLIENT_FALLBACK_KEYBINDINGS,
} from '@/lib/keybindings/defaults'
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from '@/lib/keybindings/matchShortcut'
import { cn } from '@/lib/utils'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon as __ChevronDownHugeIcon } from '@hugeicons/core-free-icons'

export interface OpenInPickerProps {
  workspaceId: string | null
  openInCwd?: string | null
  filePath?: string
  compact?: boolean
  enableShortcut?: boolean
  className?: string
  availableEditors?: ReadonlyArray<AvailableExternalEditor>
  onEditorSelect?: (editorId: ExternalEditorId) => void
}

export const OpenInPicker = memo(function OpenInPicker({
  workspaceId,
  openInCwd: _openInCwd,
  filePath = '.',
  compact = false,
  enableShortcut = true,
  className,
  availableEditors: propAvailableEditors,
  onEditorSelect,
}: OpenInPickerProps) {
  const [detectedEditors, setDetectedEditors] = useState<AvailableExternalEditor[]>([])
  const [selectedEditorId, setSelectedEditorId] = useState<ExternalEditorId | null>(() =>
    readStoredExternalEditorPreference(),
  )

  useEffect(() => {
    if (propAvailableEditors !== undefined) {
      return
    }

    let cancelled = false
    void window.electronAPI?.editor
      ?.listAvailableEditors()
      .then((editors) => {
        if (cancelled) return
        setDetectedEditors(editors ?? [])
      })
      .catch(() => {
        if (cancelled) return
        setDetectedEditors([])
      })

    return () => {
      cancelled = true
    }
  }, [propAvailableEditors])

  const effectiveAvailableEditors = propAvailableEditors ?? detectedEditors

  const orderedEditors = useMemo(
    () => orderDetectedEditors(effectiveAvailableEditors),
    [effectiveAvailableEditors],
  )

  useEffect(() => {
    const resolvedId = resolvePreferredExternalEditorId(orderedEditors, selectedEditorId)
    if (resolvedId === selectedEditorId) return
    setSelectedEditorId(resolvedId)
  }, [orderedEditors, selectedEditorId])

  const selectedEditor = useMemo(
    () => orderedEditors.find((editor) => editor.id === selectedEditorId) ?? orderedEditors[0] ?? null,
    [orderedEditors, selectedEditorId],
  )

  const handleOpenInEditor = useCallback(
    (editorId: ExternalEditorId | null) => {
      if (!workspaceId) return
      const targetEditorId = editorId ?? selectedEditor?.id ?? selectedEditorId
      if (!targetEditorId) return

      void openProjectFileInExternalEditor({
        availableEditors: orderedEditors,
        filePath,
        preferredEditorId: targetEditorId,
        workspaceId,
      }).then((result) => {
        if (!result.success) {
          console.error('[OpenInPicker] Failed to open in external editor', result.error)
        }
      })

      if (targetEditorId !== selectedEditorId) {
        setSelectedEditorId(targetEditorId)
        try {
          window.localStorage.setItem(PREVIEW_EDITOR_PREFERENCE_KEY, targetEditorId)
        } catch {
          // ignore
        }
      }
      onEditorSelect?.(targetEditorId)
    },
    [workspaceId, selectedEditor, selectedEditorId, orderedEditors, filePath, onEditorSelect],
  )

  const handleSelectEditor = useCallback(
    (editorId: ExternalEditorId) => {
      setSelectedEditorId(editorId)
      try {
        window.localStorage.setItem(PREVIEW_EDITOR_PREFERENCE_KEY, editorId)
      } catch {
        // ignore
      }
      onEditorSelect?.(editorId)
      handleOpenInEditor(editorId)
    },
    [handleOpenInEditor, onEditorSelect],
  )

  const shortcutLabel = useMemo(
    () => shortcutLabelForCommand(CLIENT_FALLBACK_KEYBINDINGS, 'editor.openFavorite'),
    [],
  )

  useEffect(() => {
    if (!enableShortcut || !workspaceId) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return
      }

      const command = resolveShortcutCommand(e, CLIENT_FALLBACK_KEYBINDINGS)
      if (command === 'editor.openFavorite') {
        e.preventDefault()
        if (selectedEditor) {
          handleOpenInEditor(selectedEditor.id)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enableShortcut, workspaceId, selectedEditor, handleOpenInEditor])

  const SelectedIcon = selectedEditor ? getExternalEditorIcon(selectedEditor.id) : GenericCodeIcon
  const selectedKind = selectedEditor ? getExternalEditorKind(selectedEditor.id) : 'generic'

  return (
    <ButtonGroup
      aria-label="Open in editor"
      className={cn('inline-flex items-center', className)}
    >
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-7 px-2"
        disabled={!selectedEditor || !workspaceId}
        onClick={() => handleOpenInEditor(selectedEditor?.id ?? null)}
        aria-label={
          selectedEditor
            ? `Open in ${selectedEditor.name}`
            : 'Open in editor'
        }
      >
        <SelectedIcon
          aria-hidden="true"
          className={cn(
            'size-3.5 shrink-0',
            selectedKind === 'brand' ? 'text-foreground' : 'text-muted-foreground',
          )}
        />
        <span className={compact ? 'sr-only' : 'ml-1 text-xs'}>Open</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            className="h-7 w-5 px-0"
            aria-label="Choose editor"
            disabled={!workspaceId && orderedEditors.length === 0}
          >
            <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {orderedEditors.length === 0 ? (
            <DropdownMenuItem disabled>No installed editors found</DropdownMenuItem>
          ) : (
            orderedEditors.map((editor) => {
              const Icon = getExternalEditorIcon(editor.id)
              const kind = getExternalEditorKind(editor.id)
              const isPreferred = editor.id === selectedEditor?.id

              return (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => handleSelectEditor(editor.id)}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      'size-4 shrink-0',
                      kind === 'brand' ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="flex-1 truncate">{editor.name}</span>
                  {isPreferred && shortcutLabel ? (
                    <DropdownMenuShortcut>{shortcutLabel}</DropdownMenuShortcut>
                  ) : isPreferred ? (
                    <span className="text-[11px] text-muted-foreground font-medium">Default</span>
                  ) : null}
                </DropdownMenuItem>
              )
            })
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
})
