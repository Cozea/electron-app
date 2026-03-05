import { ExplorerItem } from './explorerModel'

export interface VisibleTreeNodeRow {
  kind: 'node'
  id: string
  item: ExplorerItem
  depth: number
  isExpanded: boolean
}

export interface VisibleTreeInlineCreateRow {
  kind: 'inlineCreate'
  id: string
  parentResource: string
  depth: number
}

export interface VisibleTreeLoadingRow {
  kind: 'loadingPlaceholder'
  id: string
  parentResource: string
  depth: number
}

export interface VisibleTreeEmptyRow {
  kind: 'emptyPlaceholder'
  id: string
  parentResource: string
  depth: number
}

export type VisibleTreeRow =
  | VisibleTreeNodeRow
  | VisibleTreeInlineCreateRow
  | VisibleTreeLoadingRow
  | VisibleTreeEmptyRow

interface BuildVisibleTreeRowsOptions {
  root: ExplorerItem
  expandedPaths: Set<string>
  inlineCreateTarget?: string | null
  loadingPaths?: Set<string>
}

export function buildVisibleTreeRows({
  root,
  expandedPaths,
  inlineCreateTarget = null,
  loadingPaths = new Set<string>(),
}: BuildVisibleTreeRowsOptions): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = []

  const addNode = (item: ExplorerItem, depth: number) => {
    const isExpanded = expandedPaths.has(item.resource)
    rows.push({
      kind: 'node',
      id: `n:${item.resource}`,
      item,
      depth,
      isExpanded,
    })

    if (!item.isDirectory || !isExpanded) {
      return
    }

    const childDepth = depth + 1
    const isLoading = loadingPaths.has(item.resource)

    if (inlineCreateTarget === item.resource) {
      rows.push({
        kind: 'inlineCreate',
        id: `c:${item.resource}`,
        parentResource: item.resource,
        depth: childDepth,
      })
    }

    if (isLoading && !item.isDirectoryResolved) {
      rows.push({
        kind: 'loadingPlaceholder',
        id: `l:${item.resource}`,
        parentResource: item.resource,
        depth: childDepth,
      })
      return
    }

    if (item.isDirectoryResolved && item.sortedChildren.length === 0) {
      rows.push({
        kind: 'emptyPlaceholder',
        id: `e:${item.resource}`,
        parentResource: item.resource,
        depth: childDepth,
      })
      return
    }

    for (const child of item.sortedChildren) {
      addNode(child, childDepth)
    }
  }

  if (inlineCreateTarget === root.resource) {
    rows.push({
      kind: 'inlineCreate',
      id: `c:${root.resource}`,
      parentResource: root.resource,
      depth: 0,
    })
  }

  for (const child of root.sortedChildren) {
    addNode(child, 0)
  }

  return rows
}
