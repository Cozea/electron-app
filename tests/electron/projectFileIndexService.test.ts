import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  applyProjectFileDeleteToIndex,
  applyProjectFileMetaChangeToIndex,
  clearProjectFileIndexesForTests,
  listProjectFilesFromIndex,
} from '../../apps/desktop/electron/services/ProjectFileIndexService'

const tempRoots: string[] = []

async function createTempProject(): Promise<string> {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'cozea-file-index-'))
  tempRoots.push(projectPath)
  return projectPath
}

async function writeProjectFile(projectPath: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(projectPath, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content, 'utf-8')
  return filePath
}

function listedPaths(result: Awaited<ReturnType<typeof listProjectFilesFromIndex>>): string[] {
  expect(result.success).toBe(true)
  return (result.files ?? []).map((file) => file.path)
}

afterEach(async () => {
  clearProjectFileIndexesForTests()
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('ProjectFileIndexService', () => {
  it('lists project files while skipping generated folders and files', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'src/app/page.tsx', 'export default function Page() {}')
    await writeProjectFile(projectPath, 'node_modules/pkg/index.js', 'module.exports = {}')
    await writeProjectFile(projectPath, '.git/config', '[core]')
    await writeProjectFile(projectPath, 'dist/bundle.js', 'console.log("built")')
    await writeProjectFile(projectPath, 'debug.log', 'noise')

    const paths = listedPaths(await listProjectFilesFromIndex(projectPath))

    expect(paths).toEqual(['src/app/page.tsx'])
  })

  it('applies file meta changes to a fresh cached index', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'src/existing.ts', 'export const existing = true')

    expect(listedPaths(await listProjectFilesFromIndex(projectPath))).toEqual(['src/existing.ts'])

    const newFilePath = await writeProjectFile(projectPath, 'src/new.ts', 'export const added = true')
    const newFileStats = await fs.stat(newFilePath)
    applyProjectFileMetaChangeToIndex({
      filePath: newFilePath,
      isDirectory: false,
      sizeBytes: newFileStats.size,
    })

    expect(listedPaths(await listProjectFilesFromIndex(projectPath))).toEqual([
      'src/existing.ts',
      'src/new.ts',
    ])
  })

  it('removes deleted directory descendants from a fresh cached index', async () => {
    const projectPath = await createTempProject()
    await writeProjectFile(projectPath, 'src/keep.ts', 'export const keep = true')
    await writeProjectFile(projectPath, 'src/remove/child.ts', 'export const remove = true')

    expect(listedPaths(await listProjectFilesFromIndex(projectPath))).toEqual([
      'src/keep.ts',
      'src/remove/child.ts',
    ])

    const removedDirectoryPath = path.join(projectPath, 'src/remove')
    await fs.rm(removedDirectoryPath, { recursive: true, force: true })
    applyProjectFileDeleteToIndex(removedDirectoryPath)

    expect(listedPaths(await listProjectFilesFromIndex(projectPath))).toEqual(['src/keep.ts'])
  })
})
