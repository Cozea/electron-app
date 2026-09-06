import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const repositoryRoot: string = process.cwd()
const read = (relativePath: string): string =>
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

  it('contains worker failures instead of allowing process-level errors', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    expect(runtime).toContain("this.child.on('error'")
    expect(runtime).toContain("this.child.stdin.on('error'")
    expect(runtime).toContain('private failAll(error: Error)')
    expect(runtime).toContain('interface WorkerRpcMessage')
    expect(runtime).toContain('parseToolResult(JSON.stringify(message.result))')
    expect(runtime).toContain('server.closeAllConnections()')
  })

  it('sanitizes persisted Computer Use settings before policy evaluation', () => {
    const settings = read('apps/desktop/electron/services/computerUseSettings.ts')
    expect(settings).toContain('Array.isArray(raw.disabledComputerUseTools)')
    expect(settings).toContain("typeof tool === 'string'")
    expect(settings).toContain('raw.computerUseEnabled === true')
    expect(settings).toContain('raw.computerUseAllowGlobalPointerFallbacks === true')
  })

  it('serializes native tool and lifecycle access without blocking Electron JS', () => {
    const rust = read('packages/computer-use-native/src/lib.rs')
    expect(rust).toContain('fn lock_operations()')
    expect(rust.match(/let _guard = lock_operations\(\)\?;/g)?.length).toBeGreaterThanOrEqual(5)
    expect(rust).toContain('pub async fn turn_ended')
    expect(rust).toContain('pub async fn reset_session')
    expect(rust).toContain('pub async fn reset_all')
    expect(rust.match(/tokio::task::spawn_blocking/g)?.length).toBeGreaterThanOrEqual(4)

    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    expect(runtime).toContain('turnEnded(sessionId: string): Promise<void>')
    expect(runtime).toContain('resetSession(sessionId: string): Promise<void>')
    expect(runtime).toContain('resetAll(): Promise<void>')
    expect(runtime).toContain('async turnEnded(sessionId: string): Promise<void>')
    expect(runtime).toContain('await this.turnEnded(threadId)')
    expect(runtime).toContain('await this.resetAll()')

    const facade = read('apps/desktop/electron/services/ComputerUseService.ts')
    expect(facade).toContain('await this.runtime.resetAll()')

    const swift = read(
      'native/computer-use-bridge/Sources/CozeaComputerUseBridge/Bridge.swift',
    )
    expect(swift).toContain('private final class LockedMCPServer')
    expect(swift).toContain('return server.handle(line: line)')
    expect(swift).toContain('private var servers: [String: LockedMCPServer]')
    expect(swift).toContain('turnEndedDetached(server: LockedMCPServer)')
  })

  it('builds and packages the native bridge for the active macOS architecture', () => {
    const nativePackage = JSON.parse(read('packages/computer-use-native/package.json')) as {
      napi?: { triples?: { additional?: string[] } }
      scripts?: Record<string, string>
    }
    expect(nativePackage.napi?.triples?.additional).toEqual([
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
    ])
    expect(nativePackage.scripts?.['build:arm64']).toContain('--target aarch64-apple-darwin')
    expect(nativePackage.scripts?.['build:x64']).toContain('--target x86_64-apple-darwin')

    const preparation = read('scripts/prepare-computer-use-runtime.mjs')
    expect(preparation).toContain("['lipo', '-archs', candidate]")
    expect(preparation).toContain('dylibs.find(dylibMatchesCurrentArchitecture)')
    expect(preparation).toContain('`build:debug:${napiArch}`')
  })

  it('keeps the typed T3 pin compatible with contract synchronization', () => {
    const constants = read('apps/desktop/electron/substrate/constants.ts')
    expect(constants).toContain('SUBSTRATE_T3_PIN_SHA: string =')

    const sync = read('scripts/vendor/sync-t3-contracts.mjs')
    expect(sync).toContain('SUBSTRATE_T3_PIN_SHA\\s*(?::\\s*string)?\\s*=\\s*')
  })

  it('never discovers an external CLI or mutates provider home configuration', () => {
    const facade = read('apps/desktop/electron/services/ComputerUseService.ts')
    expect(facade).toContain('return null')
    expect(facade).toContain('Never')
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

  it('accepts authenticated turn-end notifications from the managed T3 runtime', () => {
    const runtime = read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')
    expect(runtime).toContain("request.url === '/v1/turn-ended'")
    expect(runtime).toContain('await this.turnEnded(threadId)')
    expect(runtime).toContain("'notifications/turn-ended'")
  })

  it('localizes and names the advanced physical-pointer control', () => {
    const page = read('apps/desktop/src/features/settings/ComputerUse.tsx')
    expect(page).toContain("t('settings.computerUse.advancedTitle')")
    expect(page).toContain("t('settings.computerUse.advancedDescription')")
    expect(page).toContain("aria-label={t('settings.computerUse.allowGlobalPointerFallback')}")

    const translations = read('apps/desktop/src/lib/i18n/computerUse.ts')
    expect(translations).toContain("'settings.computerUse.advancedTitle'")
    expect(translations).toContain('Interacción avanzada')
  })
})
