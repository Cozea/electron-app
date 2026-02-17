const BOOTSTRAP_FILE_NAMES = new Set([
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  ".DS_Store",
  "Thumbs.db",
])

function normalizeLocalPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/").replace(/^\.\/+/, "").trim()
}

export function isBootstrapOnlyLocalPath(pathValue: string): boolean {
  const normalizedPath = normalizeLocalPath(pathValue)
  if (!normalizedPath) return true

  if (normalizedPath.startsWith(".git/")) {
    return true
  }

  const segments = normalizedPath.split("/").filter(Boolean)
  const fileName = segments[segments.length - 1] ?? normalizedPath
  return BOOTSTRAP_FILE_NAMES.has(fileName)
}

export function getMeaningfulLocalFileCount(filePaths: string[]): number {
  let count = 0
  for (const pathValue of filePaths) {
    if (isBootstrapOnlyLocalPath(pathValue)) continue
    count += 1
  }
  return count
}
