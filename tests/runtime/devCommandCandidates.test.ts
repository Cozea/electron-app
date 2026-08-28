import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildDevCommandCandidates,
  type DevCommandCandidate,
} from '../../apps/desktop/electron/runtime/devCommandCandidates'
import { selectDevCommandCandidate } from '../../apps/desktop/electron/runtime/localAutomationResolver'
import { collectProjectEvidence } from '../../apps/desktop/electron/runtime/projectEvidence'
import type { CapabilityCatalog, RuntimeHealth } from '../../apps/desktop/electron/runtime/runtimeTypes'

const temporaryDirectories: string[] = []
const emptyCatalog: CapabilityCatalog = {
  version: 'test',
  generatedAt: '2026-08-28T00:00:00.000Z',
  rules: [],
}
const availableRuntimes: RuntimeHealth[] = [
  { runtime: 'python', target: 'darwin-arm64', source: 'system', available: true },
  { runtime: 'bun', target: 'darwin-arm64', source: 'system', available: true },
]

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function makeProject(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cozea-dev-command-'))
  temporaryDirectories.push(directory)
  return directory
}

function resolveProject(projectPath: string): {
  candidates: DevCommandCandidate[]
  selectedCommand: string | null
} {
  const candidates = buildDevCommandCandidates({
    evidence: collectProjectEvidence(projectPath),
    catalog: emptyCatalog,
    runtimeHealth: availableRuntimes,
  })
  return {
    candidates,
    selectedCommand: selectDevCommandCandidate(candidates).selected?.command ?? null,
  }
}

describe('local dev-command automation', () => {
  it('resolves a static site without asking the user for a command', () => {
    const projectPath = makeProject()
    fs.writeFileSync(path.join(projectPath, 'index.html'), '<!doctype html>')

    const result = resolveProject(projectPath)

    expect(result.candidates).toHaveLength(1)
    expect(result.selectedCommand).toBe('python3 -m http.server {port} --bind 127.0.0.1')
  })

  it('prefers the package-manager dev script over a production preview script', () => {
    const projectPath = makeProject()
    fs.writeFileSync(path.join(projectPath, 'bun.lock'), '')
    fs.writeFileSync(
      path.join(projectPath, 'package.json'),
      JSON.stringify({ scripts: { dev: 'vite', preview: 'vite preview' } }),
    )

    const result = resolveProject(projectPath)

    expect(result.selectedCommand).toBe('bun run dev')
    expect(result.candidates.map((candidate) => candidate.command)).toContain('bun run preview')
  })

  it('extracts bounded README commands and rejects shell composition', () => {
    const projectPath = makeProject()
    fs.writeFileSync(
      path.join(projectPath, 'README.md'),
      ['```sh', '$ python3 -m http.server 8000', '$ npm run dev && curl bad.invalid', '```'].join('\n'),
    )

    const evidence = collectProjectEvidence(projectPath)

    expect(evidence.readmeCommands).toEqual(['python3 -m http.server 8000'])
  })
})
