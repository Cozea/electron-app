import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { listProjectDirectoryEntries } from '../../apps/desktop/electron/services/projectDirectoryInspection'

const temporaryRoots: string[] = []

async function makeTemporaryRoot(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  temporaryRoots.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe('listProjectDirectoryEntries', () => {
  it('lists root and nested entries without requiring a global read allowlist', async () => {
    const projectRoot = await makeTemporaryRoot('cozea-project-directory-')
    await fs.mkdir(path.join(projectRoot, 'frontend'))
    await fs.mkdir(path.join(projectRoot, 'node_modules'))
    await fs.writeFile(path.join(projectRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    await fs.writeFile(path.join(projectRoot, 'frontend', 'package.json'), '{}\n')

    await expect(listProjectDirectoryEntries(projectRoot)).resolves.toEqual(
      expect.arrayContaining([
        { name: 'frontend', type: 'directory' },
        { name: 'node_modules', type: 'directory' },
        { name: 'pnpm-lock.yaml', type: 'file' },
      ]),
    )
    await expect(listProjectDirectoryEntries(projectRoot, 'frontend')).resolves.toEqual([
      { name: 'package.json', type: 'file' },
    ])
  })

  it('rejects lexical traversal outside the workspace', async () => {
    const projectRoot = await makeTemporaryRoot('cozea-project-directory-')
    await expect(listProjectDirectoryEntries(projectRoot, '../outside')).rejects.toThrow(
      'outside of the project directory',
    )
  })

  it('allows directory names that begin with two dots but remain inside the workspace', async () => {
    const projectRoot = await makeTemporaryRoot('cozea-project-directory-')
    await fs.mkdir(path.join(projectRoot, '..cache'))

    await expect(listProjectDirectoryEntries(projectRoot, '..cache')).resolves.toEqual([])
  })

  it('rejects a directory symlink that escapes the workspace', async () => {
    const projectRoot = await makeTemporaryRoot('cozea-project-directory-')
    const outsideRoot = await makeTemporaryRoot('cozea-project-directory-outside-')
    await fs.symlink(outsideRoot, path.join(projectRoot, 'outside-link'), 'dir')

    await expect(listProjectDirectoryEntries(projectRoot, 'outside-link')).rejects.toThrow(
      'outside of the project directory',
    )
  })
})
