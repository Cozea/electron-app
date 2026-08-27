export type ResolveDroppedLocalFolderResult =
  | { ok: true; path: string }
  | { ok: false; reason: "empty" | "multiple" | "not_folder" | "no_path" }

function readLegacyFilePath(file: File): string {
  const legacyPath = (file as File & { path?: unknown }).path
  return typeof legacyPath === "string" ? legacyPath.trim() : ""
}

function resolveFileSystemPath(
  file: File,
  getPathForFile: ((file: File) => string) | undefined,
): string {
  try {
    const resolved = getPathForFile?.(file)?.trim() ?? ""
    if (resolved) {
      return resolved
    }
  } catch {
    // Fall through to the legacy Electron File.path property.
  }

  return readLegacyFilePath(file)
}

/**
 * Resolve a single local folder path from a drag-and-drop DataTransfer.
 * Mirrors "Import local folder": only directories are accepted.
 */
export function resolveDroppedLocalFolderPath(
  dataTransfer: DataTransfer,
  getPathForFile?: (file: File) => string,
): ResolveDroppedLocalFolderResult {
  const items = Array.from(dataTransfer.items ?? []).filter((item) => item.kind === "file")
  const files = Array.from(dataTransfer.files ?? [])

  if (items.length === 0 && files.length === 0) {
    return { ok: false, reason: "empty" }
  }

  if (items.length > 1 || files.length > 1) {
    return { ok: false, reason: "multiple" }
  }

  const item = items[0]
  if (item) {
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null
    if (entry && !entry.isDirectory) {
      return { ok: false, reason: "not_folder" }
    }

    const file = item.getAsFile() ?? files[0]
    if (!file) {
      return { ok: false, reason: "no_path" }
    }

    const path = resolveFileSystemPath(file, getPathForFile)
    if (!path) {
      return { ok: false, reason: "no_path" }
    }

    return { ok: true, path }
  }

  const file = files[0]
  if (!file) {
    return { ok: false, reason: "empty" }
  }

  // Without a DataTransferItem entry, treat empty-type drops as folders
  // (Chromium/Electron folder drops often report type "").
  if (file.type && !file.type.startsWith("inode/")) {
    return { ok: false, reason: "not_folder" }
  }

  const path = resolveFileSystemPath(file, getPathForFile)
  if (!path) {
    return { ok: false, reason: "no_path" }
  }

  return { ok: true, path }
}
