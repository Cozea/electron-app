import fs from 'node:fs'
import path from 'node:path'

export interface ProjectPathCandidate {
  path: string
  remoteUrl?: string | null
}

function isCandidateDirectoryName(candidateName: string, slug: string): boolean {
  return candidateName === slug || new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(candidateName)
}

function readGitDirPath(projectPath: string): string | null {
  const gitEntryPath = path.join(projectPath, '.git')
  if (!fs.existsSync(gitEntryPath)) {
    return null
  }

  const stats = fs.statSync(gitEntryPath)
  if (stats.isDirectory()) {
    return gitEntryPath
  }

  if (!stats.isFile()) {
    return null
  }

  try {
    const raw = fs.readFileSync(gitEntryPath, 'utf-8')
    const match = raw.match(/gitdir:\s*(.+)\s*$/im)
    if (!match?.[1]) {
      return null
    }
    return path.resolve(projectPath, match[1].trim())
  } catch {
    return null
  }
}

function readOriginRemoteUrl(projectPath: string): string | null {
  const gitDirPath = readGitDirPath(projectPath)
  if (!gitDirPath) {
    return null
  }

  const configPath = path.join(gitDirPath, 'config')
  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8')
    const lines = raw.split(/\r?\n/)
    let inOriginSection = false

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        inOriginSection = /^\[remote\s+"origin"\]$/i.test(trimmed)
        continue
      }

      if (!inOriginSection) {
        continue
      }

      const match = trimmed.match(/^url\s*=\s*(.+)$/i)
      if (match?.[1]) {
        return match[1].trim()
      }
    }
  } catch {
    return null
  }

  return null
}

export function extractProjectIdFromRemoteUrl(remoteUrl: string | null | undefined): string | null {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim().length === 0) {
    return null
  }

  const match = remoteUrl.match(/(?:^|[/:])git\/([^/?#]+)\.git(?:$|[?#])/i)
  if (!match?.[1]) {
    return null
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

export function selectProjectPathCandidate(
  candidates: ProjectPathCandidate[],
  options: { slug: string; projectId?: string },
): string | null {
  if (candidates.length === 0) {
    return null
  }

  if (options.projectId) {
    const remoteMatches = candidates.filter(
      (candidate) => extractProjectIdFromRemoteUrl(candidate.remoteUrl) === options.projectId,
    )
    if (remoteMatches.length === 1) {
      return remoteMatches[0].path
    }
    if (remoteMatches.length > 1) {
      const exactMatch = remoteMatches.find(
        (candidate) => path.basename(candidate.path) === options.slug,
      )
      return exactMatch?.path ?? null
    }
  }

  if (candidates.length === 1) {
    return candidates[0].path
  }

  const exactMatch = candidates.find((candidate) => path.basename(candidate.path) === options.slug)
  return exactMatch?.path ?? null
}

export function resolveKnownProjectPath(
  projectsDirectory: string,
  options: { slug: string; projectId?: string },
): string | null {
  if (!fs.existsSync(projectsDirectory)) {
    return null
  }

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(projectsDirectory, { withFileTypes: true })
  } catch {
    return null
  }

  const candidates = entries
    .filter((entry) => entry.isDirectory() && isCandidateDirectoryName(entry.name, options.slug))
    .map((entry) => {
      const candidatePath = path.join(projectsDirectory, entry.name)
      return {
        path: candidatePath,
        remoteUrl: readOriginRemoteUrl(candidatePath),
      } satisfies ProjectPathCandidate
    })

  return selectProjectPathCandidate(candidates, options)
}
