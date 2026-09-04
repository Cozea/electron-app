import fs from 'node:fs'
import path from 'node:path'

/**
 * Writes a managed block into each provider's always-loaded instructions file.
 *
 * Installing a skill folder only *offers* it: the provider surfaces name and
 * description and the model decides whether to load it. That is fine for an
 * occasional tool and wrong for project memory, which has to be consulted
 * before an agent starts reading files or it may as well not exist.
 *
 * The block is delimited so it can be rewritten or removed without touching
 * anything else the user keeps in that file.
 */

const BLOCK_START = '<!-- cozea:project-memory:start -->'
const BLOCK_END = '<!-- cozea:project-memory:end -->'

export function buildMemoryInstructionsBlock(skillName: string): string {
  return [
    BLOCK_START,
    '## Project memory',
    '',
    `This project may keep a memory map: a knowledge graph of itself at`,
    '`graphify-out/graph.json`, maintained by agents and shown in Cozea\'s Memory tile.',
    '',
    `Before reading files to answer a question about architecture, what calls what,`,
    'where something lives, or how a change ripples, consult that map first. It encodes',
    'relationships that are expensive to rediscover by opening files at random.',
    '',
    `Use the \`${skillName}\` skill for how to read, build and update it.`,
    '',
    'The map says where to look and what connects to what. It does not carry current',
    'file contents, so open the file it points at for exact detail. If the file and the',
    'map disagree, the file wins and the map needs updating.',
    '',
    'If the map does not exist, say so rather than guessing, and offer to build it.',
    BLOCK_END,
  ].join('\n')
}

function stripBlock(contents: string): string {
  const start = contents.indexOf(BLOCK_START)
  if (start === -1) return contents
  const end = contents.indexOf(BLOCK_END, start)
  if (end === -1) return contents
  const before = contents.slice(0, start).replace(/\n{3,}$/, '\n\n')
  const after = contents.slice(end + BLOCK_END.length).replace(/^\n{3,}/, '\n\n')
  return `${before}${after}`.trim()
}

/** Idempotent: rewrites an existing block in place rather than appending. */
export function writeMemoryInstructions(filePath: string, skillName: string): void {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const withoutBlock = stripBlock(existing)
  const block = buildMemoryInstructionsBlock(skillName)
  const next = withoutBlock ? `${withoutBlock}\n\n${block}\n` : `${block}\n`

  if (existing === next) return
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, next, 'utf8')
}

/** Leaves the file in place, and removes it only if the block was all of it. */
export function removeMemoryInstructions(filePath: string): void {
  if (!fs.existsSync(filePath)) return
  const existing = fs.readFileSync(filePath, 'utf8')
  if (!existing.includes(BLOCK_START)) return

  const remaining = stripBlock(existing)
  if (remaining.length === 0) {
    fs.rmSync(filePath, { force: true })
    return
  }
  fs.writeFileSync(filePath, `${remaining}\n`, 'utf8')
}
