import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolveKnownProjectPath } from '../../electron/projectPathResolution'

function writeGitConfig(projectPath: string, remoteUrl: string): void {
  const gitDir = path.join(projectPath, '.git')
  fs.mkdirSync(gitDir, { recursive: true })
  fs.writeFileSync(
    path.join(gitDir, 'config'),
    `[remote "origin"]\n\turl = ${remoteUrl}\n`,
    'utf-8',
  )
}

describe('projectPathResolution', () => {
  const tempRoots: string[] = []

  afterEach(() => {
    for (const tempRoot of tempRoots.splice(0, tempRoots.length)) {
      fs.rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('matches the suffixed directory when the git remote points at the requested project id', () => {
    const projectsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-project-paths-'))
    tempRoots.push(projectsDirectory)

    const exactPath = path.join(projectsDirectory, 'demo')
    const suffixedPath = path.join(projectsDirectory, 'demo-2')
    fs.mkdirSync(exactPath)
    fs.mkdirSync(suffixedPath)
    writeGitConfig(exactPath, 'https://api.cozea.app/git/project-a.git')
    writeGitConfig(suffixedPath, 'https://api.cozea.app/git/project-b.git')

    expect(
      resolveKnownProjectPath(projectsDirectory, { slug: 'demo', projectId: 'project-b' }),
    ).toBe(suffixedPath)
  })

  it('falls back to the exact slug path when no project id is provided', () => {
    const projectsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-project-paths-'))
    tempRoots.push(projectsDirectory)

    const exactPath = path.join(projectsDirectory, 'demo')
    const suffixedPath = path.join(projectsDirectory, 'demo-2')
    fs.mkdirSync(exactPath)
    fs.mkdirSync(suffixedPath)

    expect(resolveKnownProjectPath(projectsDirectory, { slug: 'demo' })).toBe(exactPath)
  })

  it('resolves the only matching suffix when the exact slug path does not exist', () => {
    const projectsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-project-paths-'))
    tempRoots.push(projectsDirectory)

    const suffixedPath = path.join(projectsDirectory, 'demo-2')
    fs.mkdirSync(suffixedPath)
    writeGitConfig(suffixedPath, 'https://api.cozea.app/git/project-b.git')

    expect(
      resolveKnownProjectPath(projectsDirectory, { slug: 'demo', projectId: 'project-b' }),
    ).toBe(suffixedPath)
  })
})
