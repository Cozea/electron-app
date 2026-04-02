import { createElement, memo, useMemo } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Code2,
  MousePointer2,
} from 'lucide-react'
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getEffectiveExternalBrowserId,
  getExternalBrowserIcon,
  getVisibleExternalBrowsers,
} from '@/features/projects/lib/externalBrowserPreference'
import { cn } from '@/lib/utils'
import type {
  AvailableExternalBrowser,
  AvailableExternalEditor,
  ExternalBrowserId,
  ExternalEditorId,
} from '@shared/electronApiTypes'

interface ProjectPreviewToolbarProps {
  availableBrowsers: AvailableExternalBrowser[]
  availableEditors: AvailableExternalEditor[]
  defaultBrowserId: ExternalBrowserId
  inspectorEnabled: boolean
  inspectorSupported?: boolean
  onOpenCode: () => void
  onOpenExternally: () => void
  onSelectedEditorChange: (editorId: ExternalEditorId) => void
  onSelectedBrowserChange: (browserId: ExternalBrowserId) => void
  onToggleInspector: () => void
  previewEmbedBlocked: boolean
  previewLoading: boolean
  previewReady: boolean
  selectedEditorId: ExternalEditorId
  selectedBrowserId: ExternalBrowserId
  serverRunning: boolean
  useCredentiallessPreview: boolean
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

export const ProjectPreviewToolbar = memo(function ProjectPreviewToolbar({
  availableBrowsers,
  availableEditors,
  defaultBrowserId,
  inspectorEnabled,
  inspectorSupported = true,
  onOpenCode,
  onOpenExternally,
  onSelectedEditorChange,
  onSelectedBrowserChange,
  onToggleInspector,
  previewEmbedBlocked,
  previewLoading,
  previewReady,
  selectedEditorId,
  selectedBrowserId,
  serverRunning,
  useCredentiallessPreview,
}: ProjectPreviewToolbarProps) {
  const selectedBrowser = useMemo(() => {
    return availableBrowsers.find((browser) => browser.id === selectedBrowserId)
      ?? availableBrowsers[0]
      ?? { id: 'system' as const, name: 'System Default' }
  }, [availableBrowsers, selectedBrowserId])
  const visibleBrowsers = useMemo(() => {
    return getVisibleExternalBrowsers(availableBrowsers, defaultBrowserId)
  }, [availableBrowsers, defaultBrowserId])
  const effectiveBrowserId = getEffectiveExternalBrowserId(selectedBrowserId, defaultBrowserId)
  const effectiveSelectedBrowser = useMemo(() => {
    return visibleBrowsers.find((browser) => browser.id === effectiveBrowserId)
      ?? selectedBrowser
  }, [effectiveBrowserId, selectedBrowser, visibleBrowsers])
  const selectedBrowserIcon = getExternalBrowserIcon(effectiveBrowserId)

  const showBrowserPicker = visibleBrowsers.length > 1
  const selectedEditor = useMemo(() => {
    return availableEditors.find((editor) => editor.id === selectedEditorId)
      ?? availableEditors[0]
      ?? null
  }, [availableEditors, selectedEditorId])
  const selectedEditorIcon = getEditorIcon(selectedEditor?.id ?? 'cursor')
  const showEditorPicker = availableEditors.length > 1

  return (
    <TooltipProvider >
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {serverRunning && useCredentiallessPreview ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold leading-none text-amber-950 dark:text-amber-100"
                  aria-label="Compat preview"
                >
                  !
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">Legacy compat preview active</TooltipContent>
            </Tooltip>
          ) : null}
          {serverRunning && !previewReady && !previewLoading ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    'inline-flex h-7 w-7 items-center justify-center rounded-full',
                    previewEmbedBlocked ? 'text-destructive' : 'text-amber-500'
                  )}
                  aria-label={previewEmbedBlocked ? 'Preview blocked' : 'Preview connection unavailable'}
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {previewEmbedBlocked
                  ? 'Preview blocked. Open externally.'
                  : 'Preview connection unavailable'}
              </TooltipContent>
            </Tooltip>
          ) : null}

          {serverRunning ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
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
                          <Tooltip>
                            <TooltipTrigger asChild>
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
                            </TooltipTrigger>
                            <TooltipContent side="bottom">Choose editor</TooltipContent>
                          </Tooltip>
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
              </TooltipTrigger>
                <TooltipContent side="bottom">
                  {selectedEditor ? `Open in ${selectedEditor.name}` : 'No supported external editor detected'}
                </TooltipContent>
              </Tooltip>

              <div className="inline-flex h-7 items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
                      onClick={onOpenExternally}
                    >
                      {createElement(selectedBrowserIcon, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
                      <span className="text-xs text-muted-foreground">Open</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {`Open in ${effectiveSelectedBrowser.name}`}
                  </TooltipContent>
                </Tooltip>
                {showBrowserPicker ? (
                  <>
                    <div className="h-4 w-px bg-border/60" aria-hidden />
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-6 rounded-none border-0 bg-transparent shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
                              aria-label="Choose browser"
                            >
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Choose browser</TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent align="end" className="w-56">
                        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Open in browser</div>
                        <DropdownMenuRadioGroup
                          value={effectiveBrowserId}
                          onValueChange={(value) => onSelectedBrowserChange(value as ExternalBrowserId)}
                        >
                          {visibleBrowsers.map((browser) => {
                            const BrowserIcon = getExternalBrowserIcon(browser.id)
                            return (
                              <DropdownMenuRadioItem key={browser.id} value={browser.id}>
                                <BrowserIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                                {browser.name}
                              </DropdownMenuRadioItem>
                            )
                          })}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                ) : null}
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={inspectorEnabled ? 'secondary' : 'ghost'}
                    size="icon"
                    className="h-7 w-7"
                    disabled={!inspectorSupported || !previewReady || previewEmbedBlocked}
                    onClick={onToggleInspector}
                  >
                    <MousePointer2 className={cn('h-3.5 w-3.5', inspectorEnabled ? 'text-foreground' : 'text-muted-foreground')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {previewEmbedBlocked
                    ? 'Preview blocked. Open externally.'
                    : !inspectorSupported
                      ? 'Inspector is not available for native preview yet'
                    : previewReady
                      ? inspectorEnabled
                        ? 'Disable inspector'
                        : 'Enable inspector'
                      : 'Preview not ready yet'}
                </TooltipContent>
              </Tooltip>
            </>
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  )
})
