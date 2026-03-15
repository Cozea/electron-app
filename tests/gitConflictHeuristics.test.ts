import { describe, expect, it } from 'vitest'

import {
  classifyConflictPath,
  hasBinarySignature,
  tryMergeJsonConflict,
} from '../electron/services/gitConflictHeuristics'

describe('git conflict heuristics', () => {
  it('classifies deterministic conflict path types', () => {
    expect(
      classifyConflictPath('package-lock.json', {
        baseContent: '{}',
        oursContent: '{}',
        theirsContent: '{}',
      }),
    ).toBe('lockfile')

    expect(
      classifyConflictPath('dist/assets/app.js.map', {
        baseContent: '{}',
        oursContent: '{}',
        theirsContent: '{}',
      }),
    ).toBe('generated')

    expect(
      classifyConflictPath('src/config/package.json', {
        baseContent: '{}',
        oursContent: '{}',
        theirsContent: '{}',
      }),
    ).toBe('structured-json')

    expect(
      classifyConflictPath('src/App.tsx', {
        baseContent: 'export const App = () => null\n',
        oursContent: 'export const App = () => <div />\n',
        theirsContent: 'export const App = () => <main />\n',
      }),
    ).toBe('text')

    expect(
      classifyConflictPath('assets/logo.png', {
        baseContent: null,
        oursContent: '\u0000PNG',
        theirsContent: '\u0000PNG',
      }),
    ).toBe('binary')
  })

  it('detects binary signatures from null bytes', () => {
    expect(hasBinarySignature(null)).toBe(false)
    expect(hasBinarySignature('plain text')).toBe(false)
    expect(hasBinarySignature('abc\u0000def')).toBe(true)
  })

  it('merges additive JSON object changes structurally', () => {
    const merged = tryMergeJsonConflict(
      JSON.stringify({
        name: 'demo',
        scripts: { dev: 'vite' },
      }),
      JSON.stringify({
        name: 'demo',
        scripts: { dev: 'vite', build: 'vite build' },
      }),
      JSON.stringify({
        name: 'demo',
        scripts: { dev: 'vite' },
        dependencies: { react: '^19.0.0' },
      }),
    )

    expect(merged).not.toBeNull()
    expect(JSON.parse(merged ?? '{}')).toEqual({
      name: 'demo',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^19.0.0' },
    })
  })

  it('fails closed on divergent JSON scalar edits', () => {
    expect(
      tryMergeJsonConflict(
        JSON.stringify({ name: 'demo' }),
        JSON.stringify({ name: 'local-name' }),
        JSON.stringify({ name: 'remote-name' }),
      ),
    ).toBeNull()
  })

  it('fails closed on JSON array conflicts', () => {
    expect(
      tryMergeJsonConflict(
        JSON.stringify({ tags: ['base'] }),
        JSON.stringify({ tags: ['local'] }),
        JSON.stringify({ tags: ['remote'] }),
      ),
    ).toBeNull()
  })
})
