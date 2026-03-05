import { describe, expect, it } from 'vitest'
import { ExplorerItem } from '../src/lib/fileExplorer/explorerModel'
import { buildVisibleTreeRows } from '../src/lib/fileExplorer/visibleRows'

function createDirectory(resource: string, name: string): ExplorerItem {
  return new ExplorerItem({
    resource,
    name,
    isDirectory: true,
  })
}

function createFile(resource: string, name: string): ExplorerItem {
  return new ExplorerItem({
    resource,
    name,
    isDirectory: false,
  })
}

describe('buildVisibleTreeRows', () => {
  it('builds flattened rows for expanded paths with stable IDs', () => {
    const root = createDirectory('/project', 'project')
    const src = createDirectory('/project/src', 'src')
    const appFile = createFile('/project/src/app.ts', 'app.ts')
    const readme = createFile('/project/README.md', 'README.md')

    src.addChild(appFile)
    src.markResolved()
    root.addChild(readme)
    root.addChild(src)
    root.markResolved()

    const expanded = new Set<string>(['/project/src'])

    const first = buildVisibleTreeRows({
      root,
      expandedPaths: expanded,
      inlineCreateTarget: '/project/src',
    })

    expect(first.map((row) => row.id)).toEqual([
      'n:/project/src',
      'c:/project/src',
      'n:/project/src/app.ts',
      'n:/project/README.md',
    ])

    const second = buildVisibleTreeRows({
      root,
      expandedPaths: expanded,
      inlineCreateTarget: '/project/src',
    })

    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id))
  })

  it('renders loading and empty placeholders for expanded directories', () => {
    const root = createDirectory('/project', 'project')
    const docs = createDirectory('/project/docs', 'docs')
    const empty = createDirectory('/project/empty', 'empty')

    empty.markResolved()
    root.addChild(docs)
    root.addChild(empty)
    root.markResolved()

    const rows = buildVisibleTreeRows({
      root,
      expandedPaths: new Set(['/project/docs', '/project/empty']),
      loadingPaths: new Set(['/project/docs']),
    })

    expect(rows.map((row) => row.id)).toEqual([
      'n:/project/docs',
      'l:/project/docs',
      'n:/project/empty',
      'e:/project/empty',
    ])
  })
})
