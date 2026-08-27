import fs from 'node:fs/promises'
import path from 'node:path'

function isCaseInsensitivePlatform(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32'
}

export function normalizeStoragePathForComparison(
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalizedPath = path.normalize(path.resolve(targetPath))
  return isCaseInsensitivePlatform(platform) ? normalizedPath.toLowerCase() : normalizedPath
}

export function pathsReferToSameStorageEntry(
  leftPath: string,
  rightPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    normalizeStoragePathForComparison(leftPath, platform) ===
    normalizeStoragePathForComparison(rightPath, platform)
  )
}

export function isPathInsideDirectory(
  parentDir: string,
  targetPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const relativePath = path.relative(
    normalizeStoragePathForComparison(parentDir, platform),
    normalizeStoragePathForComparison(targetPath, platform),
  )
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

export async function resolvePathForStorageGuard(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}
