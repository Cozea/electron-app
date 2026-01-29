export function extractFirstJsonArray(input: string): string | null {
  const trimmed = input.trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  return trimmed.slice(start, end + 1)
}

function removeTrailingCommas(input: string): string {
  return input.replace(/,(\s*[}\]])/g, '$1')
}

function quoteUnquotedKeys(input: string): string {
  // Convert `{ foo: 1 }` → `{ "foo": 1 }`
  // Safe-ish for our use case (model-generated JSON-like payloads).
  return input.replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
}

function addMissingColonsAfterQuotedKeys(input: string): string {
  // Convert `"key" "value"` → `"key": "value"`
  return input.replace(/"([^"]+)"\s+(?=["[{0-9tfn-])/g, '"$1": ')
}

function normalizeSingleQuotedStrings(input: string): string {
  // Best-effort: convert `'key': 'value'` to `"key": "value"`
  // This is intentionally conservative and won’t cover all edge cases.
  return input
    .replace(/'([^']+)'\s*:/g, '"$1":')
    .replace(/:\s*'([^']*)'/g, ': "$1"')
}

export function parseJsonArrayLoose(input: unknown): unknown[] | null {
  if (Array.isArray(input)) return input
  if (typeof input !== 'string') return null

  const candidates: string[] = []
  const raw = input.trim()
  if (raw) candidates.push(raw)

  const extracted = extractFirstJsonArray(raw)
  if (extracted && extracted !== raw) candidates.push(extracted)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // try next candidate/repair
    }

    const repaired = addMissingColonsAfterQuotedKeys(
      removeTrailingCommas(
        quoteUnquotedKeys(
          normalizeSingleQuotedStrings(candidate)
        )
      )
    )

    try {
      const parsed = JSON.parse(repaired)
      if (Array.isArray(parsed)) return parsed
    } catch {
      // ignore
    }
  }

  return null
}

