"use client"

import { Copy } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { CodeMirrorMergeViewer } from '@/features/projects/components/changes/CodeMirrorMergeViewer'
import { cn } from '@/lib/utils'

export interface ToolDiffData {
  /** File path being edited */
  filePath: string
  /** Original content (before edit) */
  original: string
  /** Modified content (after edit) */
  modified: string
}

export interface ToolDiffOutputProps {
  /** Tool name to determine how to extract diff data */
  toolName: string
  /** Tool input containing the edit data */
  input: Record<string, unknown>
  /** Tool output (optional, for additional context) */
  output?: unknown
  /** Maximum height for the diff viewer */
  maxHeight?: number
  /** Use inline diff view */
  inline?: boolean
}

interface LineDiffStats {
  added: number
  removed: number
}

const TOOL_DIFF_MAX_HEIGHT = 210
const TOOL_DIFF_MIN_HEIGHT = 84
const TOOL_DIFF_LINE_HEIGHT = 22
const TOOL_DIFF_VERTICAL_PADDING = 24

/**
 * Extract diff data from tool input based on tool type
 */
function extractDiffData(
  toolName: string,
  input: Record<string, unknown>
): ToolDiffData | ToolDiffData[] | null {
  switch (toolName) {
    case 'edit': {
      const filePath = String(input.filePath || input.file_path || '')
      const oldString = String(input.oldString || input.old_string || '')
      const newString = String(input.newString || input.new_string || '')

      if (!filePath || !oldString) return null

      return {
        filePath,
        original: oldString,
        modified: newString,
      }
    }

    case 'multiedit': {
      const edits = (Array.isArray(input.edits) ? input.edits : input.replacements) as Array<{
        filePath?: string
        file_path?: string
        oldString?: string
        old_string?: string
        newString?: string
        new_string?: string
      }> | undefined
      const defaultFilePath =
        typeof input.filePath === 'string'
          ? input.filePath
          : typeof input.file_path === 'string'
            ? input.file_path
            : ''

      if (!Array.isArray(edits) || edits.length === 0) return null

      return edits.map((r) => ({
        filePath: String(r.filePath || r.file_path || defaultFilePath),
        original: String(r.oldString || r.old_string || ''),
        modified: String(r.newString || r.new_string || ''),
      })).filter((d) => d.filePath && d.original)
    }

    case 'write': {
      const filePath = String(input.filePath || input.file_path || '')
      const content = String(input.content || '')

      if (!filePath) return null

      return {
        filePath,
        original: '',
        modified: content,
      }
    }

    default:
      return null
  }
}

function splitLines(input: string): string[] {
  if (!input) return []
  const normalized = input.replace(/\r\n/g, '\n')
  const lines = normalized.endsWith('\n')
    ? normalized.slice(0, -1).split('\n')
    : normalized.split('\n')
  return lines
}

function getLineDiffStats(original: string, modified: string): LineDiffStats {
  const oldLines = splitLines(original)
  const newLines = splitLines(modified)

  if (oldLines.length === 0 && newLines.length === 0) {
    return { added: 0, removed: 0 }
  }

  // Fast O(n) approximation: trim shared prefix/suffix and count changed middle.
  let start = 0
  let oldEnd = oldLines.length - 1
  let newEnd = newLines.length - 1

  while (start <= oldEnd && start <= newEnd && oldLines[start] === newLines[start]) {
    start += 1
  }

  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd -= 1
    newEnd -= 1
  }

  const removed = oldEnd >= start ? oldEnd - start + 1 : 0
  const added = newEnd >= start ? newEnd - start + 1 : 0

  return {
    added,
    removed,
  }
}

function getDisplayFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || filePath
}

function getAdaptivePanelHeight(diff: ToolDiffData, maxHeight: number): number {
  const lineCount = Math.max(
    splitLines(diff.original).length,
    splitLines(diff.modified).length,
    1
  )
  const naturalHeight = lineCount * TOOL_DIFF_LINE_HEIGHT + TOOL_DIFF_VERTICAL_PADDING
  const clampedMaxHeight = Math.min(
    TOOL_DIFF_MAX_HEIGHT,
    Math.max(TOOL_DIFF_MIN_HEIGHT, maxHeight)
  )

  return Math.min(
    clampedMaxHeight,
    Math.max(TOOL_DIFF_MIN_HEIGHT, naturalHeight)
  )
}

interface DiffCardProps {
  diff: ToolDiffData
  maxHeight: number
}

function DiffCard({ diff, maxHeight }: DiffCardProps) {
  const stats = useMemo(
    () => getLineDiffStats(diff.original, diff.modified),
    [diff.modified, diff.original]
  )

  const hasStats = stats.added > 0 || stats.removed > 0
  const fileName = getDisplayFileName(diff.filePath)
  const panelHeight = getAdaptivePanelHeight(diff, maxHeight)
  const panelSurface = 'var(--main-nav-sidebar-surface, var(--sidebar))'
  const panelBodySurface = 'var(--main-nav-sidebar-surface, var(--sidebar))'
  const cardStyle: CSSProperties = {
    backgroundColor: panelSurface,
    ['--cm-merge-gutter-bg' as string]: panelSurface,
  }

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={cardStyle}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground/95">{fileName}</span>
          {hasStats && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums">
              {stats.added > 0 ? <span className="text-emerald-400/70">+{stats.added}</span> : null}
              {stats.removed > 0 ? <span className="text-red-400/70">-{stats.removed}</span> : null}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
          title="Copy updated content"
          onClick={() => {
            void navigator.clipboard.writeText(diff.modified)
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="h-px bg-white/8" />
      <div
        className={cn('w-full')}
        style={{
          backgroundColor: panelBodySurface,
          height: `${panelHeight}px`,
        }}
      >
        <CodeMirrorMergeViewer
          original={diff.original}
          modified={diff.modified}
          filePath={diff.filePath}
          className="h-full"
        />
      </div>
    </div>
  )
}

/**
 * Check if a tool is a file edit tool that should show diff
 */
export function isFileEditTool(toolName: string): boolean {
  return [
    'edit',
    'multiedit',
    'write',
  ].includes(toolName)
}

/**
 * Renders a Monaco diff viewer for file edit tools
 */
export function ToolDiffOutput({
  toolName,
  input,
  maxHeight = 300,
  inline: _inline = false,
}: ToolDiffOutputProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const diffData = useMemo(
    () => extractDiffData(toolName, input),
    [toolName, input]
  )

  if (!diffData) {
    return null
  }

  const diffs = Array.isArray(diffData) ? diffData : [diffData]
  if (diffs.length === 0) return null
  const clampedIndex = Math.min(activeIndex, diffs.length - 1)
  const activeDiff = diffs[clampedIndex]

  if (diffs.length > 1) {
    return (
      <div className="space-y-2 px-2 pb-2">
        <div className="app-scrollbar flex items-center gap-1 overflow-x-auto pb-1">
          {diffs.map((diff, index) => {
            const stats = getLineDiffStats(diff.original, diff.modified)
            const active = index === clampedIndex
            return (
              <button
                key={`${diff.filePath}-${index}`}
                type="button"
                onClick={() => setActiveIndex(index)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
                  active
                    ? 'bg-foreground/14 text-foreground'
                    : 'bg-foreground/8 text-muted-foreground hover:bg-foreground/12 hover:text-foreground'
                )}
                title={diff.filePath}
              >
                <span className="max-w-[180px] truncate">{getDisplayFileName(diff.filePath)}</span>
                {(stats.added > 0 || stats.removed > 0) && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] tabular-nums">
                    {stats.added > 0 ? <span className="text-emerald-400/70">+{stats.added}</span> : null}
                    {stats.removed > 0 ? <span className="text-red-400/70">-{stats.removed}</span> : null}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        <DiffCard
          diff={activeDiff}
          maxHeight={maxHeight}
        />
      </div>
    )
  }

  return (
    <div className="px-2 pb-2">
      <DiffCard
        diff={activeDiff}
        maxHeight={maxHeight}
      />
    </div>
  )
}
