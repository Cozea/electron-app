import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_IGNORES = new Set([
  'node_modules',
  'dist',
  'out',
  'build',
  '.git',
])

export function collectSourceFiles(options: {
  rootDir: string
  extensions?: string[]
  ignores?: ReadonlySet<string>
}): string[] {
  const extensions = options.extensions ?? ['.ts', '.tsx']
  const ignores = options.ignores ?? DEFAULT_IGNORES
  const results: string[] = []

  function walk(currentDir: string) {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        if (ignores.has(entry.name)) continue
        walk(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name)
      if (extensions.includes(ext)) {
        results.push(fullPath)
      }
    }
  }

  walk(options.rootDir)
  return results
}

