import { parsePatchFiles } from '@pierre/diffs'
import { FileDiff, type FileDiffMetadata, Virtualizer } from '@pierre/diffs/react'
import { useMemo } from 'react'
import { useTheme } from '@/contexts/ThemeContext'
import {
  buildPatchCacheKey,
  resolveDiffThemeName,
} from '@/features/assistant/lib/diffRendering'
import { cn } from '@/lib/utils'

function resolveThemeMode(theme: ReturnType<typeof useTheme>['theme']): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') {
    return theme
  }
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function getRenderableFiles(patch: string): FileDiffMetadata[] {
  const normalizedPatch = patch.trim()
  if (!normalizedPatch) {
    return []
  }
  return parsePatchFiles(normalizedPatch, buildPatchCacheKey(normalizedPatch, 'project-change')).flatMap(
    (parsedPatch) => parsedPatch.files,
  )
}

function buildFileRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? 'none'}:${fileDiff.name}`
}

interface CheckpointPatchViewProps {
  patch: string | null
  className?: string
}

export function CheckpointPatchView({ patch, className }: CheckpointPatchViewProps) {
  const { theme } = useTheme()
  const resolvedTheme = resolveThemeMode(theme)
  const fileDiffs = useMemo(() => (patch ? getRenderableFiles(patch) : []), [patch])

  if (!patch || !patch.trim()) {
    return (
      <div className={cn('flex items-center justify-center px-3 py-6 text-xs text-muted-foreground/70', className)}>
        No patch available for this change.
      </div>
    )
  }

  if (fileDiffs.length === 0) {
    return (
      <pre
        className={cn(
          'max-h-[28rem] overflow-auto rounded-md border border-border/70 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground/90',
          className,
        )}
      >
        {patch}
      </pre>
    )
  }

  return (
    <Virtualizer
      className={cn('max-h-[32rem] overflow-auto px-2 pb-2', className)}
      config={{
        overscrollSize: 600,
        intersectionObserverMargin: 1200,
      }}
    >
      {fileDiffs.map((fileDiff) => (
        <div
          key={`${buildFileRenderKey(fileDiff)}:${resolvedTheme}`}
          className="mb-2 rounded-md first:mt-2 last:mb-0"
        >
          <FileDiff
            fileDiff={fileDiff}
            options={{
              diffStyle: 'unified',
              lineDiffType: 'none',
              overflow: 'wrap',
              theme: resolveDiffThemeName(resolvedTheme),
              themeType: resolvedTheme,
            }}
          />
        </div>
      ))}
    </Virtualizer>
  )
}
