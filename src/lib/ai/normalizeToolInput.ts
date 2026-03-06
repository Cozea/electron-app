import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'

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

function normalizeTodowriteInput(rawInput: unknown, depth = 0): unknown {
  if (depth > 2) return rawInput

  if (Array.isArray(rawInput)) {
    return { todos: rawInput }
  }

  if (typeof rawInput === 'string') {
    const parsedArray = parseJsonArrayLoose(rawInput)
    if (parsedArray !== null) {
      return { todos: parsedArray }
    }

    const parsedObject = tryParseJsonObject(rawInput)
    if (parsedObject !== rawInput) {
      return normalizeTodowriteInput(parsedObject, depth + 1)
    }

    return rawInput
  }

  if (!isPlainObject(rawInput)) return rawInput

  const next: Record<string, unknown> = { ...rawInput }

  if (!Array.isArray(next.tasks) && !Array.isArray(next.todos)) {
    const parsedTasksJson = parseJsonArrayLoose(next.tasks_json)
    if (parsedTasksJson !== null) {
      next.todos = parsedTasksJson
    }
  }

  if (Array.isArray(next.tasks) || Array.isArray(next.todos)) {
    return next
  }

  for (const key of ['input', 'payload', 'args', 'arguments', 'data', 'value']) {
    const candidate = next[key]
    const normalizedCandidate = normalizeTodowriteInput(candidate, depth + 1)
    if (!isPlainObject(normalizedCandidate)) continue
    if (Array.isArray(normalizedCandidate.tasks) || Array.isArray(normalizedCandidate.todos)) {
      return normalizedCandidate
    }
  }

  return next
}

export function normalizeToolInput(toolName: string, rawInput: unknown): unknown {
  let input: unknown = rawInput

  if (toolName === 'todowrite') {
    return normalizeTodowriteInput(input)
  }

  if (toolName === 'preview_start') {
    if (typeof input === 'string') {
      input = tryParseJsonObject(input)
    }
    return isPlainObject(input) ? { ...input } : {}
  }

  if (toolName === 'preview_browser') {
    if (typeof input === 'string') {
      input = tryParseJsonObject(input)
    }
    if (!isPlainObject(input)) return {}

    const next: Record<string, unknown> = { ...input }
    if (typeof next.path !== 'string' || !next.path.trim()) {
      const candidate = next.route ?? next.pathname
      if (typeof candidate === 'string') {
        next.path = candidate
      }
    }

    if (typeof next.text !== 'string' || !next.text.trim()) {
      const candidate = next.waitForText
      if (typeof candidate === 'string') {
        next.text = candidate
      }
    }

    if (typeof next.action === 'string' && next.action.trim()) {
      const normalized = next.action
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
      next.action =
        normalized === 'take_screenshot'
          ? 'screenshot'
          : normalized === 'press_key'
            ? 'press'
            : normalized
    }

    if (typeof next.action !== 'string' || !next.action.trim()) {
      if (
        typeof next.text === 'string' ||
        typeof next.textGone === 'string' ||
        typeof next.time === 'number'
      ) {
        next.action = 'wait_for'
      } else {
        next.action = 'snapshot'
      }
    }

    return next
  }

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

  if (toolName === 'glob' || toolName === 'grep') {
    if (typeof next.pattern !== 'string' || !next.pattern.trim()) {
      const candidate = next.query
      if (typeof candidate === 'string') {
        next.pattern = candidate
      }
    }
    if (toolName === 'grep' && (typeof next.include !== 'string' || !next.include.trim())) {
      const candidate = next.includePattern
      if (typeof candidate === 'string') {
        next.include = candidate
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

  if (toolName === 'multiedit') {
    if (Array.isArray(next.replacements) && !Array.isArray(next.edits)) {
      next.edits = next.replacements
    }
    if (typeof next.filePath !== 'string' || !next.filePath.trim()) {
      const edits = Array.isArray(next.edits) ? next.edits : []
      const firstEdit = edits.find((edit) => isPlainObject(edit)) as Record<string, unknown> | undefined
      const candidate = firstEdit?.filePath ?? firstEdit?.path
      if (typeof candidate === 'string') {
        next.filePath = candidate
      }
    }
    return next
  }

  return next
}
