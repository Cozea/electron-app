/**
 * Converts a folder selected by the native picker into the only location a
 * development-preview tile is allowed to persist: a path relative to its workspace.
 */
export function resolveDevAppPreviewRelativePath(
  projectRootPath: string,
  selectedPath: string,
): string | null {
  const root = normalizeAbsolutePath(projectRootPath)
  const selected = normalizeAbsolutePath(selectedPath)
  if (!root || !selected) return null

  const caseInsensitive = /^[a-zA-Z]:\//.test(root)
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root
  const comparableSelected = caseInsensitive ? selected.toLowerCase() : selected
  if (comparableSelected === comparableRoot) return "."

  const rootPrefix = `${comparableRoot}/`
  if (!comparableSelected.startsWith(rootPrefix)) return null

  const relativePath = selected.slice(root.length + 1)
  if (!relativePath || relativePath.split("/").some((segment) => segment === "..")) {
    return null
  }
  return relativePath
}

export function resolveDevAppPreviewManifestPath(
  projectRootPath: string,
  selectedManifestPath: string,
): string | null {
  const normalized = normalizeAbsolutePath(selectedManifestPath)
  const manifestSuffix = "/cozea-devapp.json"
  if (!normalized.toLowerCase().endsWith(manifestSuffix)) return null
  return resolveDevAppPreviewRelativePath(
    projectRootPath,
    normalized.slice(0, -manifestSuffix.length),
  )
}

function normalizeAbsolutePath(pathValue: string): string {
  const normalized = pathValue.trim().replace(/\\/g, "/")
  if (normalized === "/") return normalized
  return normalized.replace(/\/+$/, "")
}
