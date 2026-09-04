import { memo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  MoreVerticalIcon as __MoreVerticalHugeIcon,
  SearchList02Icon as __SearchHugeIcon,
  RefreshIcon as __RefreshHugeIcon,
  TextWrapIcon as __TextWrapHugeIcon,
  CollapseIcon as __CollapseHugeIcon,
  DocumentCodeIcon as __DocumentCodeHugeIcon,
  Image01Icon as __Image01HugeIcon,
  TextSelectionIcon as __TextSelectionHugeIcon,
  ViewOffIcon as __ViewOffHugeIcon,
  CopyIcon as __CopyHugeIcon,
  HierarchyFilesIcon as __SidebarHugeIcon,
} from '@hugeicons/core-free-icons'
import { showDesktopContextMenu } from '@/lib/desktopBridgeClient'
import { getNativeMenuIcon } from '@/lib/nativeMenuIcons'
import type { ContextMenuItem } from '@cozea/assistant-contracts'
import { useTranslation } from '@/lib/i18n'
import type { ChangesDiffStyle, ChangesViewMode } from './ChangesTypes'

function StackedViewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 24" fill="none" role="img" aria-labelledby="title desc" className={className}>
      <title id="title">Horizontal split icon</title>
      <desc id="desc">A rounded gray outline containing a pink horizontal block above a green horizontal block.</desc>
      <rect x="1" y="1" width="24" height="22" rx="4.5" fill="transparent" stroke="currentColor" strokeWidth="2"/>
      <rect x="5" y="5" width="16" height="6" rx="1.5" fill="#F3ADB3"/>
      <rect x="5" y="13" width="16" height="6" rx="1.5" fill="#B6EAB4"/>
    </svg>
  );
}

function SplitViewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 24" fill="none" role="img" aria-labelledby="title desc" className={className}>
      <title id="title">Vertical split icon</title>
      <desc id="desc">A rounded gray outline containing a pink vertical block and a green vertical block.</desc>
      <rect x="1" y="1" width="24" height="22" rx="4.5" fill="transparent" stroke="currentColor" strokeWidth="2"/>
      <rect x="5" y="5" width="7" height="14" rx="1.5" fill="#F3ADB3"/>
      <rect x="14" y="5" width="7" height="14" rx="1.5" fill="#B6EAB4"/>
    </svg>
  );
}

interface ChangesHeaderControlsProps {
  viewMode: ChangesViewMode
  setViewMode: (mode: ChangesViewMode) => void
  searchQuery: string
  setSearchQuery: (query: string) => void
  diffStyle: ChangesDiffStyle
  setDiffStyle: (style: ChangesDiffStyle | ((prev: ChangesDiffStyle) => ChangesDiffStyle)) => void
  onRefresh: () => void
}

export const ChangesHeaderControls = memo(function ChangesHeaderControls({
  viewMode,
  setViewMode,
  searchQuery,
  setSearchQuery,
  diffStyle,
  setDiffStyle,
  onRefresh,
}: ChangesHeaderControlsProps) {
  const { t } = useTranslation()

  return (
    <div className="flex h-full w-full items-center gap-1.5 px-1">
      <button
        type="button"
        onClick={() => setViewMode(viewMode === 'tree' ? 'diff' : 'tree')}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
          viewMode === 'tree'
            ? 'bg-muted/70 text-foreground'
            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
        }`}
        aria-label={viewMode === 'tree' ? "Hide file tree" : "Show file tree"}
        title={viewMode === 'tree' ? "Hide file tree" : "Show file tree"}
      >
        <HugeiconsIcon icon={__SidebarHugeIcon} className="size-3.5" />
      </button>

      <div className="mx-1 flex h-7 min-w-0 flex-1 items-center rounded-md border border-border/40 bg-muted/60 transition-colors focus-within:border-border/60 focus-within:bg-background">
        <HugeiconsIcon
          icon={__SearchHugeIcon}
          className="pointer-events-none ml-2.5 size-4 shrink-0 text-muted-foreground/70"
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={viewMode === 'tree' ? t('changes.placeholder.filterFiles') : "Search within code"}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      <button
        type="button"
        onClick={() => setDiffStyle((prev) => (prev === 'split' ? 'unified' : 'split'))}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        title={diffStyle === 'split' ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
        aria-label={diffStyle === 'split' ? t('changes.action.switchStacked') : t('changes.action.switchSplit')}
      >
        {diffStyle === 'split' ? (
          <StackedViewIcon className="h-[15px] w-auto" />
        ) : (
          <SplitViewIcon className="h-[15px] w-auto" />
        )}
      </button>

      <button
        type="button"
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          const items: ContextMenuItem[] = [
            { id: 'refresh', label: 'Refresh', icon: getNativeMenuIcon('sync') },
            { id: 'toggleWordWrap', label: 'Enable word wrap', icon: getNativeMenuIcon('tools') },
            { id: 'collapseAll', label: 'Collapse all diffs', icon: getNativeMenuIcon('close') },
            { id: 'sep1', type: 'separator' },
            { id: 'toggleFullFiles', label: "Don't load full files", icon: getNativeMenuIcon('package') },
            { id: 'toggleRichPreview', label: 'Enable rich preview', icon: getNativeMenuIcon('search') },
            { id: 'toggleWordDiffs', label: 'Enable word diffs', icon: getNativeMenuIcon('edit') },
            { id: 'toggleWhiteSpace', label: 'Hide white space', icon: getNativeMenuIcon('tools') },
            { id: 'sep2', type: 'separator' },
            { id: 'copyGitApply', label: 'Copy git apply command', icon: getNativeMenuIcon('copy') },
          ];
          const action = await showDesktopContextMenu(items, {
            x: Math.round(rect.left),
            y: Math.round(rect.bottom + 4),
          });
          if (action === 'refresh') {
            onRefresh()
          }
        }}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        aria-label="More options"
      >
        <HugeiconsIcon icon={__MoreVerticalHugeIcon} className="size-3.5" />
      </button>
    </div>
  )
})
