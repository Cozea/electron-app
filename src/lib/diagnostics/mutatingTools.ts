const FILE_MUTATING_TOOLS = new Set(['write', 'edit', 'multiedit', 'apply_patch'])

const APPLY_PATCH_FILE_PREFIXES = [
  '*** Add File: ',
  '*** Update File: ',
  '*** Delete File: ',
  '*** Move to: ',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeFilePath = (filePath: string): string =>
  filePath.trim().replace(/^['"]/, '').replace(/['"]$/, '')

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const filePath of paths) {
    const normalized = normalizeFilePath(filePath)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function extractApplyPatchFilePaths(patchText: string): string[] {
  const paths: string[] = []
  const lines = patchText.split(/\r?\n/)

  for (const line of lines) {
    for (const prefix of APPLY_PATCH_FILE_PREFIXES) {
      if (!line.startsWith(prefix)) continue
      const filePath = line.slice(prefix.length).trim()
      if (filePath) {
        paths.push(filePath)
      }
      break
    }
  }

  return uniquePaths(paths)
}

export function isFileMutatingTool(toolName: string): boolean {
  return FILE_MUTATING_TOOLS.has(toolName)
}

export function getMutatingToolFilePaths(
  toolName: string,
  input: Record<string, unknown> | null | undefined
): string[] {
  if (!input || !isFileMutatingTool(toolName)) {
    return []
  }

  if (toolName === 'write' || toolName === 'edit') {
    const filePath = input.filePath
    return typeof filePath === 'string' && filePath.trim().length > 0
      ? uniquePaths([filePath])
      : []
  }

  if (toolName === 'multiedit') {
    const edits = Array.isArray(input.edits)
      ? input.edits
      : Array.isArray(input.replacements)
        ? input.replacements
        : []
    const defaultFilePath = typeof input.filePath === 'string' ? input.filePath : undefined
    const paths = edits
      .filter(isRecord)
      .map((edit) => edit.filePath ?? defaultFilePath)
      .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)

    return uniquePaths(paths)
  }

  if (toolName === 'apply_patch') {
    const patchText = input.patchText
    if (typeof patchText !== 'string' || patchText.trim().length === 0) {
      return []
    }
    return extractApplyPatchFilePaths(patchText)
  }

  return []
}
