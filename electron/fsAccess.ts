import path from 'node:path'

import type { AppSettings } from '../shared/electronApiTypes'

const MAX_APPROVED_EXTERNAL_READ_ROOTS = 128

function normalizeAbsolutePath(targetPath: string): string {
  return path.resolve(targetPath)
}

export function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = normalizeAbsolutePath(candidatePath)
  const normalizedRoot = normalizeAbsolutePath(rootPath)

  if (normalizedCandidate === normalizedRoot) {
    return true
  }

  return normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
}

export function getApprovedReadRoots(settings: AppSettings): string[] {
  const roots = new Set<string>()
  roots.add(normalizeAbsolutePath(settings.projectsDirectory))

  for (const approvedRoot of settings.approvedExternalReadRoots ?? []) {
    if (typeof approvedRoot !== 'string' || approvedRoot.trim().length === 0) {
      continue
    }
    roots.add(normalizeAbsolutePath(approvedRoot))
  }

  return Array.from(roots)
}

export function isReadPathAllowed(candidatePath: string, settings: AppSettings): boolean {
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    return false
  }

  return getApprovedReadRoots(settings).some((rootPath) => isPathInsideRoot(candidatePath, rootPath))
}

export function rememberApprovedExternalReadRoot(
  settings: AppSettings,
  candidatePath: string,
): Pick<AppSettings, 'approvedExternalReadRoots'> | null {
  if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
    return null
  }

  const normalizedCandidate = normalizeAbsolutePath(candidatePath)
  if (isPathInsideRoot(normalizedCandidate, settings.projectsDirectory)) {
    return null
  }

  const nextRoots = [
    normalizedCandidate,
    ...(settings.approvedExternalReadRoots ?? [])
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => normalizeAbsolutePath(value))
      .filter((value) => value !== normalizedCandidate),
  ].slice(0, MAX_APPROVED_EXTERNAL_READ_ROOTS)

  return {
    approvedExternalReadRoots: nextRoots,
  }
}
