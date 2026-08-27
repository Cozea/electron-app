import { describe, expect, it } from 'vitest'
import { ExplorerItem } from '../../apps/desktop/src/lib/fileExplorer/explorerModel'

describe('ExplorerItem', () => {
  it('caches sorted children until tree structure changes', () => {
    const root = new ExplorerItem({
      resource: '/tmp/root',
      name: 'root',
      isDirectory: true,
    })

    const bFile = new ExplorerItem({
      resource: '/tmp/root/b.ts',
      name: 'b.ts',
      isDirectory: false,
    })
    const aDir = new ExplorerItem({
      resource: '/tmp/root/a',
      name: 'a',
      isDirectory: true,
    })

    root.addChild(bFile)
    root.addChild(aDir)

    const firstSorted = root.sortedChildren
    const secondSorted = root.sortedChildren

    expect(secondSorted).toBe(firstSorted)
    expect(firstSorted.map((item) => item.name)).toEqual(['a', 'b.ts'])

    const cFile = new ExplorerItem({
      resource: '/tmp/root/c.ts',
      name: 'c.ts',
      isDirectory: false,
    })
    root.addChild(cFile)
    const afterAdd = root.sortedChildren
    expect(afterAdd).not.toBe(firstSorted)
    expect(afterAdd.map((item) => item.name)).toEqual(['a', 'b.ts', 'c.ts'])

    root.removeChild(cFile)
    const afterRemove = root.sortedChildren
    expect(afterRemove.map((item) => item.name)).toEqual(['a', 'b.ts'])

    root.clearChildren()
    const afterClear = root.sortedChildren
    expect(afterClear).toEqual([])
  })

  it('updates metadata without recreating nodes', () => {
    const file = new ExplorerItem({
      resource: '/tmp/root/main.ts',
      name: 'main.ts',
      isDirectory: false,
      mtime: 1,
      size: 10,
    })

    expect(file.updateMetadata({ mtime: 1, size: 10 })).toBe(false)
    expect(file.updateMetadata({ mtime: 2, size: 12 })).toBe(true)
    expect(file.mtime).toBe(2)
    expect(file.size).toBe(12)
  })
})
