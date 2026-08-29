import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { resolveT3RuntimeRoot } from '../../apps/server/src/t3/paths'

const repositoryRoot = path.resolve(__dirname, '../..')

describe('T3 runtime preparation', () => {
  it('prefers an explicit runtime root', () => {
    expect(resolveT3RuntimeRoot({
      explicitRoot: '/tmp/cozea-explicit-t3',
      resourcesPath: '/Applications/Cozea.app/Contents/Resources',
      exists: () => false,
    })).toBe('/tmp/cozea-explicit-t3')
  })

  it('uses the packaged resource only when its server bundle exists', () => {
    const resourcesPath = '/Applications/Cozea.app/Contents/Resources'
    const expectedRoot = path.join(resourcesPath, 't3-runtime')

    expect(resolveT3RuntimeRoot({
      resourcesPath,
      exists: (candidate) => candidate === path.join(expectedRoot, 'dist/bin.mjs'),
    })).toBe(expectedRoot)
    expect(resolveT3RuntimeRoot({ resourcesPath, exists: () => false })).toBeNull()
  })

  it('wires preparation into development and distribution without recursive submodules', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const prepareScript = fs.readFileSync(
      path.join(repositoryRoot, 'scripts/prepare-t3-runtime.mjs'),
      'utf8',
    )
    const builderConfig = fs.readFileSync(
      path.join(repositoryRoot, 'apps/desktop/electron-builder.config.cjs'),
      'utf8',
    )

    expect(packageJson.scripts.dev).toContain('prepare:t3-runtime')
    expect(packageJson.scripts.predist).toContain('prepare:t3-runtime:package')
    expect(prepareScript).toContain('"submodule", "update", "--init", "--depth", "1", "vendor/t3code"')
    expect(prepareScript).not.toContain('"--recursive"')
    expect(builderConfig).toContain('from: "../../build/t3-runtime"')
    expect(builderConfig).toContain('from: "../../build/t3-runtime/node_modules"')
    expect(prepareScript).toContain('"pnpm-store"')
  })
})
