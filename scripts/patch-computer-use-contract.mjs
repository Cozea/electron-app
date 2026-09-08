import fs from 'node:fs'

const catalogueURL = new URL('../native/computer-use-runtime/Sources/CozeaComputerUseCore/Resources/tools.json', import.meta.url)
export const computerUseCatalogue = JSON.parse(fs.readFileSync(catalogueURL, 'utf8'))

/** Replace one known source/bundle array without depending on formatter output. */
export function patchComputerUseContract(source) {
  const anchor = /(?:export\s+)?(?:const|var|let)\s+COMPUTER_USE_TOOLS(?:\s*:\s*[^=]+)?\s*=\s*\[/g
  const matches = [...source.matchAll(anchor)]
  if (matches.length !== 1) throw new Error('Computer Use tool catalogue anchor is missing or ambiguous; review the T3 pin.')
  const match = matches[0]
  const start = match.index + match[0].length - 1
  let depth = 0; let quote = ''; let escaped = false; let comment = ''; let end = -1
  for (let i = start; i < source.length; i++) {
    const c = source[i], next = source[i + 1]
    if (comment === '//') { if (c === '\n') comment = ''; continue }
    if (comment === '/*') { if (c === '*' && next === '/') { comment = ''; i++ }; continue }
    if (quote) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === quote) quote = ''
      continue
    }
    if (c === '/' && (next === '/' || next === '*')) { comment = c + next; i++; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '[') depth++
    if (c === ']' && --depth === 0) { end = i + 1; break }
  }
  if (end < 0) throw new Error('Unterminated Computer Use tool catalogue.')
  const array = JSON.stringify(computerUseCatalogue.tools)
  let result = source.slice(0, start) + array + source.slice(end)
  // The former upstream spec constrained hints to literal false/true. v2
  // accurately declares mutation/open-world hints rather than hiding them.
  result = result.replace('readonly destructiveHint: false;', 'readonly destructiveHint: boolean;')
    .replace('readonly openWorldHint: false;', 'readonly openWorldHint: boolean;')
    .replace('readonly idempotentHint?: true;', 'readonly idempotentHint?: boolean;')
    .replace('readonly readOnlyHint?: true;', 'readonly readOnlyHint?: boolean;')
  return { source: result, changed: result !== source }
}
