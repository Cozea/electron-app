import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ComputerUseRuntimeService,
  __computerUseRuntimeTesting,
} from '../../apps/desktop/electron/services/ComputerUseRuntimeService'
import type { ComputerUseAppSettings } from '../../apps/desktop/electron/services/computerUseSettings'
import { isApplicationExcluded, EXCLUDED_APP_ERROR } from '../../apps/desktop/electron/services/ApplicationExclusions'
import { CuaSocketClient } from '../../apps/desktop/electron/services/CuaSocketClient'
import { EmbeddedCuaDaemon } from '../../apps/desktop/electron/services/EmbeddedCuaDaemon'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const ack = JSON.stringify({ content: [{ type: 'text', text: '{"ok":true,"delivery":"dispatched"}' }], isError: false })

const testSettings = (): ComputerUseAppSettings => ({
  projectsDirectory: '/tmp',
  previewHeaderCompatibilityEnabled: false,
  computerUseEnabled: true,
  disabledComputerUseTools: [],
  computerUseAllowGlobalPointerFallbacks: false,
})

function setup(options: { platform?: NodeJS.Platform; timeoutMs?: number } = {}) {
  const live = testSettings()
  const runtime = new ComputerUseRuntimeService({
    platform: options.platform ?? 'darwin',
    settings: () => live,
    timeoutMs: options.timeoutMs,
  })
  return { live, runtime }
}

describe('Cozea-owned macOS Computer Use runtime (Real End-to-End)', () => {
  let mainRuntime: ComputerUseRuntimeService
  let testApp: string | null = null
  // The embedded driver panics without a logged-in macOS GUI session (no
  // pasteboard/window server). Live tests skip when no daemon can start so
  // sandboxed and headless runs stay green; GUI Macs exercise the live path.
  let daemonAvailable = false

  beforeAll(async () => {
    mainRuntime = setup().runtime
    try {
      await EmbeddedCuaDaemon.getInstance().ensureDaemon()
      daemonAvailable = true
    } catch {
      daemonAvailable = false
    }
    if (!daemonAvailable) return
    // Discover an available running target app on this macOS machine (e.g. Ghostty or Finder)
    const listRes = await mainRuntime.callTool('init-probe', 'list_apps', {})
    if (!listRes.isError && listRes.content[0]?.text) {
      const text = listRes.content[0].text
      if (text.includes('Ghostty')) testApp = 'Ghostty'
      else if (text.includes('Finder')) testApp = 'Finder'
    }
  })

  afterAll(async () => {
    await mainRuntime?.resetAll()
  })

  it('verifies universal binary staging and schema v3 manifest', () => {
    const prepare = read('scripts/prepare-computer-use-runtime.mjs')
    expect(prepare).toContain('CUA_VERSION')
    expect(prepare).toContain('EXPECTED_HASH')
    expect(prepare).toContain('darwin-universal-binary')
    expect(prepare).not.toContain('prepareWorker')
    expect(read('apps/desktop/electron-builder.config.cjs')).toContain('computer-use-runtime')

    // Manifest assertions need a prepared checkout; staging itself is validated
    // authoritatively by prepare:computer-use:check.
    const manifestPath = 'build/computer-use-runtime/manifest.json'
    if (!fs.existsSync(manifestPath)) return
    const manifest = JSON.parse(read(manifestPath))
    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.backend).toBe('EmbeddedCuaDriver')
    expect(manifest.arch).toBe('universal')
    expect(manifest.artifacts['cua-driver']).toBeDefined()
  })

  it('hard-gates all nine tools and scheduled deny policy', async () => {
    expect(__computerUseRuntimeTesting.COMPUTER_USE_TOOLS.size).toBe(9)
    const { live, runtime } = setup()

    // Scheduled task deny
    runtime.setScheduledThreadPolicy('task-1', 'thread-deny', 'deny')
    const deniedRes = await runtime.callTool('thread-deny', 'list_apps', {})
    expect(deniedRes.isError).toBe(true)
    expect(deniedRes.content[0]?.text).toContain('not authorized for this scheduled task')
    runtime.clearScheduledTaskPolicy('task-1')

    // Disabled specific tool
    live.disabledComputerUseTools = ['list_apps']
    const toolDisabledRes = await runtime.callTool('thread-normal', 'list_apps', {})
    expect(toolDisabledRes.isError).toBe(true)
    expect(toolDisabledRes.content[0]?.text).toContain("capability 'list_apps' is disabled")

    // Computer Use globally disabled
    live.disabledComputerUseTools = []
    live.computerUseEnabled = false
    const globallyDisabledRes = await runtime.callTool('thread-normal', 'list_apps', {})
    expect(globallyDisabledRes.isError).toBe(true)
    expect(globallyDisabledRes.content[0]?.text).toContain('disabled in Cozea Settings')

    // Global pointer fallback disabled
    live.computerUseEnabled = true
    live.computerUseAllowGlobalPointerFallbacks = false
    const pointerRes = await runtime.callTool('thread-normal', 'click', { app: 'Finder', click_method: 'global' })
    expect(pointerRes.isError).toBe(true)
    expect(pointerRes.content[0]?.text).toContain('Global physical-pointer fallback is disabled')
  })

  it('strictly excludes password manager applications from Computer Use', async () => {
    expect(isApplicationExcluded('1Password')).toBe(true)
    expect(isApplicationExcluded('1Password 7')).toBe(true)
    expect(isApplicationExcluded('Bitwarden')).toBe(true)
    expect(isApplicationExcluded('KeePassXC')).toBe(true)
    expect(isApplicationExcluded('com.1password.1password')).toBe(true)
    expect(isApplicationExcluded('me.proton.pass.mac')).toBe(true)
    expect(isApplicationExcluded('Finder')).toBe(false)
    expect(isApplicationExcluded('Ghostty')).toBe(false)

    const { runtime } = setup()
    for (const app of ['1Password', 'Bitwarden', 'KeePassXC']) {
      const res = await runtime.callTool('sess-sec', 'get_app_state', { app })
      expect(res.isError).toBe(true)
      expect(res.content[0]?.text).toBe(EXCLUDED_APP_ERROR)
    }
  })

  it('reports unsupported without spawning a worker on Windows/Linux', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const { runtime } = setup({ platform })
      const diag = await runtime.getDiagnostics()
      expect(diag.supported).toBe(false)
      const res = await runtime.callTool('t', 'click', { app: 'Test', x: 1, y: 1 })
      expect(res.isError).toBe(true)
      expect(res.content[0]?.text).toContain('macOS only')
      await expect(runtime.requestPermission('accessibility')).resolves.toBe(false)
    }
    expect(read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')).not.toContain('WorkerMcpSession')
  })

  it('sanitizes settings before authorization', () => {
    const code = read('apps/desktop/electron/services/computerUseSettings.ts')
    expect(code).toContain('Array.isArray(raw.disabledComputerUseTools)')
    expect(code).toContain('raw.computerUseEnabled === true')
    expect(code).toContain('raw.computerUseAllowGlobalPointerFallbacks === true')
  })

  // Live daemon tests need a macOS GUI session; they skip elsewhere.
  it.skipIf(process.platform !== 'darwin')('executes list_apps end-to-end on live embedded Cua Driver daemon', async ({ skip }) => {
    if (!daemonAvailable) return skip('Embedded Cua Driver cannot start without a GUI session.')
    const { runtime } = setup()
    try {
      const res = await runtime.callTool('test-sess-live', 'list_apps', {})
      expect(res.isError).toBe(false)
      expect(res.content[0]?.type).toBe('text')
      expect(res.content[0]?.text).toMatch(/Found \d+ running application\(s\):/)
    } finally {
      await runtime.resetSession('test-sess-live')
    }
  })

  it('executes get_app_state and caches snapshot for element-indexed click', async () => {
    if (!testApp) return
    const { runtime } = setup()
    const sessionId = 'test-sess-snapshot'
    try {
      const state = await runtime.callTool(sessionId, 'get_app_state', {
        app: testApp,
        include_screenshot: false,
      })
      expect(state.isError).toBe(false)
      expect(state.content.length).toBeGreaterThan(0)

      // Test click with element_index using cached snapshot without bare-index rejection
      const clickRes = await runtime.callTool(sessionId, 'click', {
        app: testApp,
        element_index: 0,
      })
      // The daemon will resolve the element from cached snapshot (even if AX action fails on non-clickable element, it does NOT reject with bare element_index error!)
      expect(clickRes.content[0]?.text).not.toContain('bare element_index is not accepted')
    } finally {
      await runtime.resetSession(sessionId)
    }
  })

  it('executes pixel coordinates click without focus steal', async () => {
    if (!testApp) return
    const { runtime } = setup()
    const sessionId = 'test-sess-pixel'
    try {
      const res = await runtime.callTool(sessionId, 'click', {
        app: testApp,
        x: 50,
        y: 50,
      })
      expect(res.isError).toBe(false)
      expect(res.content[0]?.text).toContain('dispatched')
    } finally {
      await runtime.resetSession(sessionId)
    }
  })

  it('executes scroll and press_key on target application', async () => {
    if (!testApp) return
    const { runtime } = setup()
    const sessionId = 'test-sess-scroll-key'
    try {
      const scrollRes = await runtime.callTool(sessionId, 'scroll', {
        app: testApp,
        direction: 'down',
        amount: 1,
      })
      if (scrollRes.isError) {
        console.log('DEBUG SCROLL ERROR:', JSON.stringify(scrollRes))
      }
      expect(scrollRes.isError).toBe(false)

      const keyRes = await runtime.callTool(sessionId, 'press_key', {
        app: testApp,
        key: 'Escape',
      })
      expect(keyRes.isError).toBe(false)
    } finally {
      await runtime.resetSession(sessionId)
    }
  })

  it('cancels the request before dispatch when AbortSignal is pre-aborted', async () => {
    const { runtime } = setup()
    const abort = new AbortController()
    abort.abort()
    const res = await runtime.callTool('sess-abort', 'list_apps', {}, { signal: abort.signal })
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toContain('CANCELLED')
  })

  it.skipIf(process.platform !== 'darwin')('revokes synchronously when policy changes and never shares authority through process.env', async ({ skip }) => {
    if (!daemonAvailable) return skip('Embedded Cua Driver cannot start without a GUI session.')
    const { runtime } = setup()
    runtime.setScheduledThreadPolicy('task-allow', 'thread-sync', 'allow')
    const okRes = await runtime.callTool('thread-sync', 'list_apps', {})
    expect(okRes.isError).toBe(false)

    runtime.revokeScheduledTaskPolicy('task-allow')
    const deniedRes = await runtime.callTool('thread-sync', 'list_apps', {})
    expect(deniedRes.isError).toBe(true)
    expect(read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')).not.toContain(
      'process.env.OPEN_COMPUTER_USE',
    )
  })

  it('waits for teardown barrier across resetAll', async () => {
    const { runtime } = setup()
    runtime.setScheduledThreadPolicy('task-reset', 'thread-reset', 'allow')
    await runtime.callTool('thread-reset', 'list_apps', {})
    await runtime.resetAll()
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 'thread-reset')).toBe('deny')
    const denied = await runtime.callTool('thread-reset', 'list_apps', {})
    expect(denied.isError).toBe(true)
  })

  it('rejects malformed native result envelopes', () => {
    for (const raw of [
      'null',
      '{}',
      'false',
      '{"content":[],"isError":false}',
      '{"content":[{"type":"image","data":7}],"isError":false}',
      '{"content":[{"type":"image","data":"aGk=","mimeType":"text/plain"}],"isError":false}',
      '{"content":[{"type":"resource"}],"isError":false}',
    ]) {
      expect(__computerUseRuntimeTesting.parseToolResult(raw).isError).toBe(true)
    }
    expect(__computerUseRuntimeTesting.parseToolResult(ack).isError).toBe(false)
    // A missing image MIME type defaults to PNG per MCP content conventions.
    const noMime = __computerUseRuntimeTesting.parseToolResult(
      '{"content":[{"type":"image","data":"aGk="}],"isError":false}',
    )
    expect(noMime.isError).toBe(false)
    expect(noMime.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' })
  })

  it.skipIf(process.platform !== 'darwin')('retains the authenticated loopback HTTP broker without provider home mutation', async ({ skip }) => {
    if (!daemonAvailable) return skip('Embedded Cua Driver cannot start without a GUI session.')
    const { runtime } = setup()
    const [a, b] = await Promise.all([runtime.startBroker(), runtime.startBroker()])
    expect(a).toEqual(b)
    try {
      // 401 on missing auth
      const denied = await fetch(`${a.endpoint}/v1/call`, { method: 'POST', body: '{}' })
      expect(denied.status).toBe(401)

      // 200 on valid auth
      const allowed = await fetch(`${a.endpoint}/v1/call`, {
        method: 'POST',
        headers: { authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ threadId: 'broker-thread', tool: 'list_apps', arguments: {} }),
      })
      expect(allowed.status).toBe(200)
      const allowedJson = (await allowed.json()) as { isError: boolean }
      expect(allowedJson.isError).toBe(false)

      // 200 on turn-ended
      const end = await fetch(`${a.endpoint}/v1/turn-ended`, {
        method: 'POST',
        headers: { authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ threadId: 'broker-thread' }),
      })
      expect(end.status).toBe(200)
    } finally {
      await runtime.stopBroker()
    }
    expect(read('apps/desktop/electron/services/ComputerUseService.ts')).not.toContain('writeFileSync')
  })

  it('localizes the unsupported platform and advanced pointer settings', () => {
    const ui = read('apps/desktop/src/features/settings/ComputerUse.tsx')
    expect(ui).toContain("t('settings.computerUse.macosOnly')")
    expect(ui).toContain("aria-label={t('settings.computerUse.allowGlobalPointerFallback')}")
    expect(read('apps/desktop/src/lib/i18n/computerUse.ts')).toContain('Interacción avanzada')
  })
})

describe('Computer Use provider-to-engine translation (mocked daemon)', () => {
  const daemon = () =>
    ({
      isInstalled: () => true,
      ensureDaemon: async () => '/tmp/fake-cua.sock',
      getSocketPath: () => '/tmp/fake-cua.sock',
    }) as unknown as EmbeddedCuaDaemon

  const translated = () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = []
    vi.spyOn(CuaSocketClient, 'listApps').mockResolvedValue([{ pid: 111, name: 'Fixture', running: true }])
    vi.spyOn(CuaSocketClient, 'listWindows').mockResolvedValue([
      {
        pid: 111,
        window_id: 7,
        app_name: 'Fixture',
        title: 't',
        is_on_screen: true,
        bounds: { x: 0, y: 0, width: 100, height: 100 },
      },
    ])
    vi.spyOn(CuaSocketClient, 'callTool').mockImplementation(async (_socket, tool, args) => {
      calls.push({ tool, args })
      return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false }
    })
    vi.spyOn(CuaSocketClient, 'endSession').mockResolvedValue(undefined)
    const live = testSettings()
    const runtime = new ComputerUseRuntimeService({
      platform: 'darwin',
      settings: () => live,
      daemon,
    })
    return { live, runtime, calls }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('translates click mouse_button and click_count to the engine dialect', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-click', 'click', {
        app: 'Fixture',
        x: 10,
        y: 20,
        mouse_button: 'right',
        click_count: 2,
      })
      expect(res.isError).toBe(false)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.tool).toBe('click')
      expect(calls[0]?.args).toMatchObject({ pid: 111, window_id: 7, x: 10, y: 20, button: 'right', count: 2 })
    } finally {
      await runtime.resetSession('sess-click')
    }
  })

  it('omits default click options so the default wire shape is unchanged', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-click-default', 'click', { app: 'Fixture', x: 1, y: 2 })
      expect(res.isError).toBe(false)
      expect(calls[0]?.args).not.toHaveProperty('button')
      expect(calls[0]?.args).not.toHaveProperty('count')
      expect(calls[0]?.args).not.toHaveProperty('delivery_mode')
    } finally {
      await runtime.resetSession('sess-click-default')
    }
  })

  it('maps click_method global to foreground delivery when the fallback is allowed', async () => {
    const { live, runtime, calls } = translated()
    live.computerUseAllowGlobalPointerFallbacks = true
    try {
      const res = await runtime.callTool('sess-click-global', 'click', {
        app: 'Fixture',
        x: 1,
        y: 2,
        click_method: 'global',
      })
      expect(res.isError).toBe(false)
      expect(calls[0]?.args).toMatchObject({ delivery_mode: 'foreground' })
    } finally {
      await runtime.resetSession('sess-click-global')
    }
  })

  it('rejects engine-unsupported click options instead of silently dropping them', async () => {
    const { runtime, calls } = translated()
    try {
      for (const args of [
        { app: 'Fixture', x: 1, y: 2, click_method: 'sky_click' },
        { app: 'Fixture', x: 1, y: 2, click_method: 'accessibility' },
        { app: 'Fixture', x: 1, y: 2, mouse_button: 'side' },
        { app: 'Fixture', x: 1, y: 2, click_count: 5 },
      ]) {
        const res = await runtime.callTool('sess-click-bad', 'click', args)
        expect(res.isError).toBe(true)
        expect(res.content[0]?.text).toMatch(/not supported|Unsupported/)
      }
      expect(calls).toHaveLength(0)
    } finally {
      await runtime.resetSession('sess-click-bad')
    }
  })

  it('translates scroll pages to the engine amount', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-scroll', 'scroll', {
        app: 'Fixture',
        element_index: 0,
        direction: 'down',
        pages: 2.5,
      })
      expect(res.isError).toBe(false)
      expect(calls[0]?.tool).toBe('scroll')
      expect(calls[0]?.args).toMatchObject({ pid: 111, direction: 'down', amount: 2.5 })
    } finally {
      await runtime.resetSession('sess-scroll')
    }
  })

  it('keeps the default scroll amount and rejects invalid pages', async () => {
    const { runtime, calls } = translated()
    try {
      const def = await runtime.callTool('sess-scroll-def', 'scroll', {
        app: 'Fixture',
        element_index: 0,
        direction: 'down',
      })
      expect(def.isError).toBe(false)
      // The omitted-pages default matches the contract default (1 page):
      // T3 passes arguments through without filling schema defaults.
      expect(calls[0]?.args).toMatchObject({ amount: 1 })
      const bad = await runtime.callTool('sess-scroll-def', 'scroll', {
        app: 'Fixture',
        element_index: 0,
        direction: 'down',
        pages: -1,
      })
      expect(bad.isError).toBe(true)
      expect(calls).toHaveLength(1)
    } finally {
      await runtime.resetSession('sess-scroll-def')
    }
  })

  it('rejects invalid scroll directions instead of defaulting silently', async () => {
    const { runtime, calls } = translated()
    try {
      for (const direction of ['sideways', 5, '']) {
        const res = await runtime.callTool('sess-scroll-dir', 'scroll', {
          app: 'Fixture',
          element_index: 0,
          direction,
        })
        expect(res.isError).toBe(true)
        expect(res.content[0]?.text).toMatch(/Unsupported direction/)
      }
      expect(calls).toHaveLength(0)
    } finally {
      await runtime.resetSession('sess-scroll-dir')
    }
  })

  it('rejects unknown secondary actions instead of degrading to a click', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-secondary-bad', 'perform_secondary_action', {
        app: 'Fixture',
        element_index: 0,
        action: 'triple_click',
      })
      expect(res.isError).toBe(true)
      expect(res.content[0]?.text).toMatch(/Unsupported action/)
      expect(calls).toHaveLength(0)

      const ok = await runtime.callTool('sess-secondary-bad', 'perform_secondary_action', {
        app: 'Fixture',
        element_index: 0,
        action: 'context_menu',
      })
      expect(ok.isError).toBe(false)
      expect(calls[0]?.tool).toBe('right_click')
    } finally {
      await runtime.resetSession('sess-secondary-bad')
    }
  })

  it('validates drag coordinates before dispatch', async () => {
    const { runtime, calls } = translated()
    try {
      const bad = await runtime.callTool('sess-drag-bad', 'drag', {
        app: 'Fixture',
        from_x: 1,
        from_y: 2,
        to_x: 3,
      })
      expect(bad.isError).toBe(true)
      expect(bad.content[0]?.text).toMatch(/from_x, from_y, to_x, and to_y/)
      expect(calls).toHaveLength(0)

      const ok = await runtime.callTool('sess-drag-bad', 'drag', {
        app: 'Fixture',
        from_x: 1,
        from_y: 2,
        to_x: 3,
        to_y: 4,
      })
      expect(ok.isError).toBe(false)
      expect(calls[0]?.args).toMatchObject({ from_x: 1, from_y: 2, to_x: 3, to_y: 4 })
    } finally {
      await runtime.resetSession('sess-drag-bad')
    }
  })

  it('rejects malformed element indexes and conflicting click targets', async () => {
    const { runtime, calls } = translated()
    try {
      for (const args of [
        { app: 'Fixture', element_index: 'abc' },
        { app: 'Fixture', element_index: -1 },
        { app: 'Fixture', element_index: 1.5 },
      ]) {
        const res = await runtime.callTool('sess-click-targets', 'click', args)
        expect(res.isError).toBe(true)
        expect(res.content[0]?.text).toMatch(/element_index must be a non-negative integer/)
      }
      const both = await runtime.callTool('sess-click-targets', 'click', {
        app: 'Fixture',
        element_index: 0,
        x: 1,
        y: 2,
      })
      expect(both.isError).toBe(true)
      expect(both.content[0]?.text).toMatch(/either element_index or x and y, not both/)
      expect(calls).toHaveLength(0)

      const str = await runtime.callTool('sess-click-targets', 'click', {
        app: 'Fixture',
        element_index: '3',
      })
      expect(str.isError).toBe(false)
      expect(calls[0]?.args).toMatchObject({ element_index: 3 })
    } finally {
      await runtime.resetSession('sess-click-targets')
    }
  })

  it('requires element_index for set_value', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-set-missing', 'set_value', {
        app: 'Fixture',
        value: 'hello',
      })
      expect(res.isError).toBe(true)
      expect(res.content[0]?.text).toMatch(/requires element_index/)
      expect(calls).toHaveLength(0)
    } finally {
      await runtime.resetSession('sess-set-missing')
    }
  })

  it('presses a bare plus key verbatim instead of sending an empty hotkey', async () => {
    const { runtime, calls } = translated()
    try {
      const res = await runtime.callTool('sess-plus', 'press_key', { app: 'Fixture', key: '+' })
      expect(res.isError).toBe(false)
      expect(calls[0]?.tool).toBe('press_key')
      expect(calls[0]?.args).toMatchObject({ key: '+' })

      const chord = await runtime.callTool('sess-plus', 'press_key', { app: 'Fixture', key: 'cmd+c' })
      expect(chord.isError).toBe(false)
      expect(calls[1]?.tool).toBe('hotkey')
      expect(calls[1]?.args).toMatchObject({ keys: ['cmd', 'c'] })
    } finally {
      await runtime.resetSession('sess-plus')
    }
  })

  it('prefers the cached engine token over reconstructing one for the same snapshot', async () => {
    const { runtime, calls } = translated()
    const sessionId = 'sess-token-pref'
    vi.mocked(CuaSocketClient.callTool).mockImplementation(async (_socket, tool, args) => {
      calls.push({ tool, args })
      if (tool === 'get_window_state') {
        return {
          content: [{ type: 'text', text: 'state' }],
          isError: false,
          structuredContent: {
            snapshot_id: 'snap-1',
            elements: [{ element_index: 0, element_token: 'engine-token-0' }],
          },
        }
      }
      return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false }
    })
    try {
      const state = await runtime.callTool(sessionId, 'get_app_state', { app: 'Fixture' })
      expect(state.isError).toBe(false)
      // The model echoes the snapshot_id it just observed: the cached
      // engine token must win over the reconstructed `snap-1:0` form.
      const click = await runtime.callTool(sessionId, 'click', {
        app: 'Fixture',
        element_index: 0,
        snapshot_id: 'snap-1',
      })
      expect(click.isError).toBe(false)
      const clickArgs = calls.find((call) => call.tool === 'click')?.args
      expect(clickArgs).toMatchObject({ element_token: 'engine-token-0', snapshot_id: 'snap-1' })
    } finally {
      await runtime.resetSession(sessionId)
    }
  })
})
