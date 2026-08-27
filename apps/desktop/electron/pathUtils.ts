import path from 'node:path'

/**
 * Resolve a relative path inside a base directory, rejecting any attempt to
 * escape the base directory (e.g. via `..` segments or absolute paths).
 */
export function resolvePathWithinDirectory(baseDir: string, inputPath: string): string {
  if (!baseDir || typeof baseDir !== 'string') {
    throw new Error('Base directory is required')
  }
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Path is required')
  }
  if (inputPath.includes('\0')) {
    throw new Error('Invalid path')
  }

  const resolved = path.resolve(baseDir, inputPath)
  const relative = path.relative(baseDir, resolved)

  // `path.relative` may return an absolute path on Windows if on different drives.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside of the project directory')
  }

  return resolved
}
