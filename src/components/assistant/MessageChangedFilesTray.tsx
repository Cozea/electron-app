import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Files, FolderClosed, FolderOpen } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import type { ToolDiffData } from '@/components/ai-elements/tool-diff-output'
import { getToolLineDiffStats } from '@/components/ai-elements/tool-diff-output'

export interface ChangedFileSummary {
  path: string
  additions: number
  deletions: number
  original: string
  modified: string
}

interface ChangedFilesTreeDirectoryNode {
  kind: 'directory'
  name: string
  path: string
  stat: {
    additions: number
    deletions: number
  }
  children: ChangedFilesTreeNode[]
}

interface ChangedFilesTreeFileNode {
  kind: 'file'
  name: string
  path: string
  stat: {
    additions: number
    deletions: number
  }
}

type ChangedFilesTreeNode = ChangedFilesTreeDirectoryNode | ChangedFilesTreeFileNode

interface MutableDirectoryNode {
  name: string
  path: string
  stat: {
    additions: number
    deletions: number
  }
  directories: Map<string, MutableDirectoryNode>
  files: ChangedFilesTreeFileNode[]
}

interface MessageChangedFilesTrayProps {
  changes: ToolDiffData[]
}

function compareByName(a: { name: string }, b: { name: string }) {
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
}

function normalizePathSegments(pathValue: string): string[] {
  return pathValue.replaceAll('\\', '/').split('/').filter((segment) => segment.length > 0)
}

function compactDirectoryNode(node: ChangedFilesTreeDirectoryNode): ChangedFilesTreeDirectoryNode {
  const compactedChildren = node.children.map((child) =>
    child.kind === 'directory' ? compactDirectoryNode(child) : child
  )

  let compactedNode: ChangedFilesTreeDirectoryNode = {
    ...node,
    children: compactedChildren,
  }

  while (
    compactedNode.children.length === 1 &&
    compactedNode.children[0]?.kind === 'directory'
  ) {
    const onlyChild = compactedNode.children[0]
    compactedNode = {
      kind: 'directory',
      name: `${compactedNode.name}/${onlyChild.name}`,
      path: onlyChild.path,
      stat: onlyChild.stat,
      children: onlyChild.children,
    }
  }

  return compactedNode
}

function toTreeNodes(directory: MutableDirectoryNode): ChangedFilesTreeNode[] {
  const subdirectories: ChangedFilesTreeDirectoryNode[] = Array.from(directory.directories.values())
    .sort(compareByName)
    .map((subdirectory) => ({
      kind: 'directory' as const,
      name: subdirectory.name,
      path: subdirectory.path,
      stat: {
        additions: subdirectory.stat.additions,
        deletions: subdirectory.stat.deletions,
      },
      children: toTreeNodes(subdirectory),
    }))
    .map((subdirectory) => compactDirectoryNode(subdirectory))

  const files = directory.files.sort(compareByName)
  return [...subdirectories, ...files]
}

function buildChangedFilesTree(files: ReadonlyArray<ChangedFileSummary>): ChangedFilesTreeNode[] {
  const root: MutableDirectoryNode = {
    name: '',
    path: '',
    stat: { additions: 0, deletions: 0 },
    directories: new Map(),
    files: [],
  }

  for (const file of files) {
    const segments = normalizePathSegments(file.path)
    if (segments.length === 0) continue

    const filePath = segments.join('/')
    const fileName = segments.at(-1)
    if (!fileName) continue

    const ancestors: MutableDirectoryNode[] = [root]
    let currentDirectory = root

    for (const segment of segments.slice(0, -1)) {
      const nextPath = currentDirectory.path ? `${currentDirectory.path}/${segment}` : segment
      const existing = currentDirectory.directories.get(segment)
      if (existing) {
        currentDirectory = existing
      } else {
        const created: MutableDirectoryNode = {
          name: segment,
          path: nextPath,
          stat: { additions: 0, deletions: 0 },
          directories: new Map(),
          files: [],
        }
        currentDirectory.directories.set(segment, created)
        currentDirectory = created
      }
      ancestors.push(currentDirectory)
    }

    currentDirectory.files.push({
      kind: 'file',
      name: fileName,
      path: filePath,
      stat: {
        additions: file.additions,
        deletions: file.deletions,
      },
    })

    for (const ancestor of ancestors) {
      ancestor.stat.additions += file.additions
      ancestor.stat.deletions += file.deletions
    }
  }

  return toTreeNodes(root)
}

function collectDirectoryPaths(nodes: ReadonlyArray<ChangedFilesTreeNode>): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'directory') continue
    paths.push(node.path)
    paths.push(...collectDirectoryPaths(node.children))
  }
  return paths
}

function buildDirectoryExpansionState(
  directoryPaths: ReadonlyArray<string>,
  expanded: boolean
): Record<string, boolean> {
  const next: Record<string, boolean> = {}
  for (const directoryPath of directoryPaths) {
    next[directoryPath] = expanded
  }
  return next
}

function hasNonZeroStat(stat: { additions: number; deletions: number }) {
  return stat.additions > 0 || stat.deletions > 0
}

function DiffStatLabel(props: {
  additions: number
  deletions: number
}) {
  return (
    <>
      <span className="text-emerald-500">+{props.additions}</span>
      <span className="mx-0.5 text-muted-foreground/70">/</span>
      <span className="text-red-500">-{props.deletions}</span>
    </>
  )
}

export function summarizeChangedFiles(changes: ReadonlyArray<ToolDiffData>): ChangedFileSummary[] {
  const grouped = new Map<string, ChangedFileSummary>()

  for (const change of changes) {
    if (!change.filePath) continue
    const stats = getToolLineDiffStats(change.original, change.modified)
    const current = grouped.get(change.filePath)
    if (current) {
      current.additions += stats.added
      current.deletions += stats.removed
      current.modified = change.modified
      continue
    }

    grouped.set(change.filePath, {
      path: change.filePath,
      additions: stats.added,
      deletions: stats.removed,
      original: change.original,
      modified: change.modified,
    })
  }

  return Array.from(grouped.values())
}

const ChangedFilesTree = memo(function ChangedFilesTree(props: {
  files: ReadonlyArray<ChangedFileSummary>
  allDirectoriesExpanded: boolean
}) {
  const { files, allDirectoriesExpanded } = props
  const treeNodes = useMemo(() => buildChangedFilesTree(files), [files])
  const directoryPathsKey = useMemo(
    () => collectDirectoryPaths(treeNodes).join('\u0000'),
    [treeNodes]
  )
  const allDirectoryExpansionState = useMemo(
    () =>
      buildDirectoryExpansionState(
        directoryPathsKey ? directoryPathsKey.split('\u0000') : [],
        allDirectoriesExpanded
      ),
    [allDirectoriesExpanded, directoryPathsKey]
  )
  const [expandedDirectories, setExpandedDirectories] = useState<Record<string, boolean>>(() =>
    buildDirectoryExpansionState(directoryPathsKey ? directoryPathsKey.split('\u0000') : [], true)
  )

  useEffect(() => {
    setExpandedDirectories(allDirectoryExpansionState)
  }, [allDirectoryExpansionState])

  const toggleDirectory = (pathValue: string, fallbackExpanded: boolean) => {
    setExpandedDirectories((current) => ({
      ...current,
      [pathValue]: !(current[pathValue] ?? fallbackExpanded),
    }))
  }

  const renderTreeNode = (node: ChangedFilesTreeNode, depth: number): ReactNode => {
    const leftPadding = 8 + depth * 14

    if (node.kind === 'directory') {
      const isExpanded = expandedDirectories[node.path] ?? depth === 0
      return (
        <div key={`dir:${node.path}`}>
          <button
            type="button"
            className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left hover:bg-background/80"
            style={{ paddingLeft: `${leftPadding}px` }}
            onClick={() => toggleDirectory(node.path, depth === 0)}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80',
                isExpanded && 'rotate-90'
              )}
            />
            {isExpanded ? (
              <FolderOpen className="size-3.5 shrink-0 text-muted-foreground/75" />
            ) : (
              <FolderClosed className="size-3.5 shrink-0 text-muted-foreground/75" />
            )}
            <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
              {node.name}
            </span>
            {hasNonZeroStat(node.stat) ? (
              <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
                <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
              </span>
            ) : null}
          </button>
          {isExpanded ? (
            <div className="space-y-0.5">
              {node.children.map((childNode) => renderTreeNode(childNode, depth + 1))}
            </div>
          ) : null}
        </div>
      )
    }

    return (
      <div
        key={`file:${node.path}`}
        className="group flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left"
        style={{ paddingLeft: `${leftPadding}px` }}
      >
        <span aria-hidden="true" className="size-3.5 shrink-0" />
        <span aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70">
          {getFileIcon(node.name, { width: 14, height: 14 })}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
          {node.name}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums">
          <DiffStatLabel additions={node.stat.additions} deletions={node.stat.deletions} />
        </span>
      </div>
    )
  }

  return <div className="space-y-0.5">{treeNodes.map((node) => renderTreeNode(node, 0))}</div>
})

export const MessageChangedFilesTray = memo(function MessageChangedFilesTray({
  changes,
}: MessageChangedFilesTrayProps) {
  const [open, setOpen] = useState(true)
  const [allDirectoriesExpanded, setAllDirectoriesExpanded] = useState(true)

  const files = useMemo(() => summarizeChangedFiles(changes), [changes])
  const summaryStat = useMemo(
    () =>
      files.reduce(
        (acc, file) => ({
          additions: acc.additions + file.additions,
          deletions: acc.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [files]
  )

  const directoryPaths = useMemo(
    () => collectDirectoryPaths(buildChangedFilesTree(files)),
    [files]
  )

  if (files.length === 0) return null

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen} className="px-1 pb-2">
        <div className="overflow-hidden rounded-lg border border-border/80 bg-card/45 p-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <Files className="h-3.5 w-3.5 shrink-0 text-muted-foreground/65" />
                <span className="min-w-0 truncate text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
                  <span>Changed files ({files.length})</span>
                  {hasNonZeroStat(summaryStat) ? (
                    <>
                      <span className="mx-1">•</span>
                      <span className="font-mono tabular-nums">
                        <DiffStatLabel
                          additions={summaryStat.additions}
                          deletions={summaryStat.deletions}
                        />
                      </span>
                    </>
                  ) : null}
                </span>
                <ChevronRight
                  className={cn(
                    'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform',
                    open && 'rotate-90'
                  )}
                />
              </button>
            </CollapsibleTrigger>
            {open ? (
              <div className="flex items-center gap-1.5">
                {directoryPaths.length > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setAllDirectoriesExpanded((current) => !current)}
                  >
                    {allDirectoriesExpanded ? 'Collapse all' : 'Expand all'}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <CollapsibleContent>
            <div>
              <ChangedFilesTree
                files={files}
                allDirectoriesExpanded={allDirectoriesExpanded}
              />
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </>
  )
})
