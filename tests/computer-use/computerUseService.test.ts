import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repositoryRoot = process.cwd()
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

const UPSTREAM_COMMIT = '41c5294cfe4735baca03f9c82b4de99d191a0b49'
const COMPUTER_USE_TOOLS = [
  'list_apps',
  'get_app_state',
  'click',
  'perform_secondary_action',
  'scroll',
  'drag',
  'type_text',
  'press_key',
  'set_value',
] as const

describe('Cozea-owned Computer Use runtime', () => {
  it('pins OpenComputerUseKit and keeps macOS execution in the Cozea process', () => {
    const packageSwift = read('native/computer-use-bridge/Package.swift')
    expect(packageSwift).toContain(UPSTREAM_COMMIT)
    expect(packageSwift).toContain('OpenComputerUseKit')
    expect(packageSwift).toContain('type: .dynamic')

    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    expect(runtime).toContain('loadNativeAddon')
    expect(runtime).toContain('require(addonPath)')
    expect(runtime).toContain('requestPermission')
    expect(runtime).toContain('turnEnded')
  })

  it('owns and hard-gates the complete upstream nine-tool surface', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    for (const tool of COMPUTER_USE_TOOLS) {
      expect(runtime).toContain(tool)
    }
    expect(runtime).toContain('validateActionPolicy')
    expect(runtime).toContain('disabledComputerUseTools')
    expect(runtime).toContain('computerUseEnabled')
    expect(runtime).toContain('computerUseAllowGlobalPointerFallbacks')
    expect(runtime).toContain('timingSafeEqual')
  })

  it('never discovers an external CLI or mutates provider home configuration', () => {
    const facade = read('apps/desktop/electron/services/ComputerUseService.ts')
    expect(facade).toContain('return null')
    expect(facade).toContain('Deliberate no-op')
    expect(facade).not.toContain('writeFileSync')
    expect(facade).not.toContain("path.join(home, '.claude")
    expect(facade).not.toContain("path.join(home, '.codex")
    expect(facade).not.toContain("path.join(home, '.cursor")
    expect(facade).not.toContain("path.join(home, '.config', 'opencode")
  })

  it('packages the runtime and gives T3 only a private broker endpoint and token', () => {
    const builder = read('apps/desktop/electron-builder.config.cjs')
    expect(builder).toContain('computer-use-runtime')

    const shadow = read('apps/desktop/electron/substrate/ShadowServerManager.ts')
    expect(shadow).toContain('COZEA_COMPUTER_USE_ENDPOINT')
    expect(shadow).toContain('COZEA_COMPUTER_USE_TOKEN')
    expect(shadow).toContain('ComputerUseRuntimeService.getInstance().startBroker()')

    const preparation = read('scripts/prepare-computer-use-runtime.mjs')
    expect(preparation).toContain(UPSTREAM_COMMIT)
    expect(preparation).toContain('computer-use-runtime')
    expect(preparation).toContain('OPEN_COMPUTER_USE_LICENSE.txt')
  })
})
