import { describe, expect, it } from 'vitest'
import {
  normalizeRelativePath as normalizeGeneratedRelativePath,
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from '../../electron/services/generatedArtifactFilters'
import { normalizeRelativePath as normalizeSyncRelativePath } from '../../src/lib/sync/pathNormalization'

describe('Generated Artifact Filters', () => {
  it('excludes known generated directories', () => {
    expect(shouldExcludeGeneratedDirectory('node_modules')).toBe(true)
    expect(shouldExcludeGeneratedDirectory('dist')).toBe(true)
    expect(shouldExcludeGeneratedDirectory('src')).toBe(false)
  })

  it('excludes known generated file suffixes', () => {
    expect(shouldExcludeGeneratedFile('foo/.eslintcache')).toBe(true)
    expect(shouldExcludeGeneratedFile('foo/bar.tsbuildinfo')).toBe(true)
    expect(shouldExcludeGeneratedFile('prisma/dev.db')).toBe(true)
    expect(shouldExcludeGeneratedFile('src/main.tsx')).toBe(false)
  })

  it('normalizes relative paths (slashes + lowercasing) for generated filtering', () => {
    expect(normalizeGeneratedRelativePath('Foo\\Bar.TS')).toBe('foo/bar.ts')
  })
})

describe('Sync Path Normalization', () => {
  it('normalizes slashes and removes leading ./ segments', () => {
    expect(normalizeSyncRelativePath('./src\\pages\\App.tsx')).toBe('src/pages/App.tsx')
  })

  it('removes .. segments safely', () => {
    expect(normalizeSyncRelativePath('src/../src/main.tsx')).toBe('src/main.tsx')
  })
})

