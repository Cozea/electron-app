import fs from 'node:fs/promises'
import path from 'node:path'

import type { ProjectDirectoryEntry } from '../../../../shared/electronApiTypes'
import { resolvePathWithinDirectory } from '../pathUtils'

function assertCanonicalPathInsideRoot(rootPath: string, candidatePath: string): void {
  const relative = path.relative(rootPath, candidatePath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path is outside of the project directory')
  }
}

export async function listProjectDirectoryEntries(
  projectRootPath: string,
  relativeDirectory?: string | null,
): Promise<ProjectDirectoryEntry[]> {
  const requestedDirectory = relativeDirectory?.trim() || '.'
  const lexicalTarget = resolvePathWithinDirectory(projectRootPath, requestedDirectory)
  const [canonicalRoot, canonicalTarget] = await Promise.all([
    fs.realpath(projectRootPath),
    fs.realpath(lexicalTarget),
  ])
  assertCanonicalPathInsideRoot(canonicalRoot, canonicalTarget)

  const stats = await fs.stat(canonicalTarget)
  if (!stats.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  const entries = await fs.readdir(canonicalTarget, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    type: entry.isDirectory() ? 'directory' : 'file',
  }))
}
