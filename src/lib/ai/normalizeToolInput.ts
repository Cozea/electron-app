function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryParseJsonObject(input: string): unknown {
  const trimmed = input.trim()
  if (!trimmed) return input
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return input
  try {
    return JSON.parse(trimmed)
  } catch {
    return input
  }
}

export function normalizeToolInput(toolName: string, rawInput: unknown): unknown {
  let input: unknown = rawInput

  // Some models send tool input as a JSON string. Best-effort parse.
  if (typeof input === 'string') {
    input = tryParseJsonObject(input)
  }

  if (!isPlainObject(input)) return input

  const next: Record<string, unknown> = { ...input }

  // Common arg-name mixups across tools:
  // - list expects `path` (NOT `dirPath`)
  // - file tools expect `filePath` (NOT `path`)
  if (toolName === 'list') {
    if (typeof next.path !== 'string' || !next.path.trim()) {
      const candidate = next.dirPath ?? next.directoryPath
      if (typeof candidate === 'string') {
        next.path = candidate
      }
    }
    return next
  }

  if (toolName === 'read' || toolName === 'write' || toolName === 'edit') {
    if (typeof next.filePath !== 'string' || !next.filePath.trim()) {
      const candidate = next.path
      if (typeof candidate === 'string') {
        next.filePath = candidate
      }
    }
    return next
  }

  return next
}
