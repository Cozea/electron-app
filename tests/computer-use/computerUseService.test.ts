import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  ComputerUseRuntimeService, __computerUseRuntimeTesting,
  type NativeComputerUseAddon,
} from '../../apps/desktop/electron/services/ComputerUseRuntimeService'
import type { ComputerUseAppSettings } from '../../apps/desktop/electron/services/computerUseSettings'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const ack = JSON.stringify({ content: [{ type: 'text', text: '{"ok":true,"delivery":"dispatched"}' }], isError: false })
const settings = (): ComputerUseAppSettings => ({ projectsDirectory: '/tmp', previewHeaderCompatibilityEnabled: false,
  computerUseEnabled: true, disabledComputerUseTools: [], computerUseAllowGlobalPointerFallbacks: false })
function addon(): NativeComputerUseAddon {
  return { abiVersion: vi.fn(() => 2), configureSession: vi.fn(() => true), revokeSession: vi.fn(), revokeAll: vi.fn(),
    cancelRequest: vi.fn(), callTool: vi.fn(async () => ack), listTools: vi.fn(() => '{"tools":[]}'),
    diagnostics: vi.fn(async () => '{"installed":true,"accessibility":false,"screenRecording":false}'),
    requestPermission: vi.fn(() => false), turnEnded: vi.fn(async () => {}), resetSession: vi.fn(async () => {}), resetAll: vi.fn(async () => {}) }
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function setup(options: { platform?: NodeJS.Platform; timeoutMs?: number } = {}) {
  const native = addon(); const live = settings()
  const runtime = new ComputerUseRuntimeService({ platform: options.platform ?? 'darwin', settings: () => live,
    addon: () => native, timeoutMs: options.timeoutMs })
  return { native, live, runtime }
}

describe('Cozea-owned macOS Computer Use runtime', () => {
  it('uses a repository-owned Swift package and rejects ABI 1 before FFI', async () => {
    expect(read('native/computer-use-bridge/Package.swift')).toContain('../computer-use-runtime')
    expect(read('native/computer-use-bridge/Package.swift')).not.toContain('https://github.com')
    const { native, runtime } = setup()
    vi.mocked(native.abiVersion).mockReturnValue(1)
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
    expect(native.callTool).not.toHaveBeenCalled()
  })
  it('owns and hard-gates all nine tools and scheduled deny', async () => {
    expect(__computerUseRuntimeTesting.COMPUTER_USE_TOOLS.size).toBe(9)
    const { native, live, runtime } = setup()
    runtime.setScheduledThreadPolicy('task', 't', 'deny')
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
    runtime.clearScheduledTaskPolicy('task')
    live.disabledComputerUseTools = ['list_apps']
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
    live.disabledComputerUseTools = []; live.computerUseEnabled = false
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
    expect(native.callTool).not.toHaveBeenCalled()
  })
  it('reports unsupported without loading or spawning a Windows/Linux worker', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const { native, runtime } = setup({ platform })
      expect((await runtime.getDiagnostics()).supported).toBe(false)
      expect((await runtime.callTool('t', 'click', { app: 'Test', x: 1, y: 1 })).isError).toBe(true)
      expect(runtime.requestPermission('accessibility')).toBe(false)
      expect(native.callTool).not.toHaveBeenCalled()
    }
    expect(read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')).not.toContain('WorkerMcpSession')
  })
  it('sanitizes settings before authorization', () => {
    const code = read('apps/desktop/electron/services/computerUseSettings.ts')
    expect(code).toContain('Array.isArray(raw.disabledComputerUseTools)')
    expect(code).toContain('raw.computerUseEnabled === true')
    expect(code).toContain('raw.computerUseAllowGlobalPointerFallbacks === true')
  })
  it('keeps observations independent of a pending input and passes ABI 2 context', async () => {
    const { native, runtime } = setup(); const waiting = deferred<string>()
    vi.mocked(native.callTool).mockImplementation(async (_session, tool) => tool === 'click' ? waiting.promise : ack)
    const input = runtime.callTool('a', 'click', { app: 'Test', element_index: '1' })
    await vi.waitFor(() => expect(native.callTool).toHaveBeenCalledTimes(1))
    const readResult = await runtime.callTool('b', 'get_app_state', { app: 'Test' })
    expect(readResult.isError).toBe(false)
    expect(native.callTool).toHaveBeenCalledTimes(2)
    const context = JSON.parse(vi.mocked(native.callTool).mock.calls[0]![3])
    expect(context.requestID).toBeTypeOf('string'); expect(context.policyRevision).toBeTypeOf('string')
    waiting.resolve(ack); await input
    expect(read('packages/computer-use-native/src/lib.rs')).not.toContain('Mutex')
    expect(read('native/computer-use-bridge/Sources/CozeaComputerUseBridge/Bridge.swift')).not.toContain('StdioMCPServer')
  })
  it('cancels the exact native request when the caller disconnects', async () => {
    const { native, runtime } = setup(); const waiting = deferred<string>(); const abort = new AbortController()
    vi.mocked(native.callTool).mockReturnValue(waiting.promise)
    const result = runtime.callTool('t', 'click', { app: 'Test', element_index: '1' }, { requestId: 'req-1', signal: abort.signal })
    await vi.waitFor(() => expect(native.callTool).toHaveBeenCalledOnce())
    abort.abort()
    expect((await result).isError).toBe(true)
    expect(native.cancelRequest).toHaveBeenCalledWith('t', 'req-1')
    waiting.resolve(ack)
  })
  it('enforces host timeout without silently replaying input', async () => {
    const { native, runtime } = setup({ timeoutMs: 10 }); const waiting = deferred<string>()
    vi.mocked(native.callTool).mockReturnValue(waiting.promise)
    expect((await runtime.callTool('t', 'click', { app: 'Test', element_index: '1' })).isError).toBe(true)
    expect(native.callTool).toHaveBeenCalledOnce(); expect(native.cancelRequest).toHaveBeenCalledOnce()
    waiting.resolve(ack)
  })
  it('revokes synchronously when policy changes and never shares authority through process.env', async () => {
    const { native, runtime } = setup()
    runtime.setScheduledThreadPolicy('task', 't', 'allow')
    await runtime.callTool('t', 'list_apps', {})
    runtime.revokeScheduledTaskPolicy('task')
    expect(native.revokeSession).toHaveBeenCalledWith('t')
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
    expect(read('apps/desktop/electron/services/ComputerUseRuntimeService.ts')).not.toContain('process.env.OPEN_COMPUTER_USE')
  })
  it('waits for native teardown before admitting a reused session', async () => {
    const { native, runtime } = setup()
    await runtime.callTool('t', 'list_apps', {})
    const drain = deferred<void>(); vi.mocked(native.resetSession).mockReturnValue(drain.promise)
    const end = runtime.turnEnded('t'); const next = runtime.callTool('t', 'list_apps', {})
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(native.callTool).toHaveBeenCalledTimes(1)
    drain.resolve(undefined); await end; await next
    expect(native.callTool).toHaveBeenCalledTimes(2)
  })
  it('keeps scheduled allow fail-closed across resetAll', async () => {
    const { native, runtime } = setup()
    runtime.setScheduledThreadPolicy('task', 't', 'allow')
    await runtime.callTool('t', 'list_apps', {})
    const reset = runtime.resetAll()
    expect(native.revokeAll).toHaveBeenCalledOnce()
    await reset
    expect(__computerUseRuntimeTesting.threadPolicy(runtime, 't')).toBe('deny')
    expect((await runtime.callTool('t', 'list_apps', {})).isError).toBe(true)
  })
  it('rejects malformed native result envelopes', () => {
    for (const raw of ['null', '{}', 'false', '{"content":[],"isError":false}', '{"content":[{"type":"image","data":7}],"isError":false}']) {
      expect(__computerUseRuntimeTesting.parseToolResult(raw).isError).toBe(true)
    }
    expect(__computerUseRuntimeTesting.parseToolResult(ack).isError).toBe(false)
  })
  it('packages both Mac architectures with a versioned bridge and catalogue resource', () => {
    const manifest = JSON.parse(read('packages/computer-use-native/package.json'))
    expect(manifest.napi.triples.additional).toEqual(['aarch64-apple-darwin', 'x86_64-apple-darwin'])
    const prepare = read('scripts/prepare-computer-use-runtime.mjs')
    expect(prepare).toContain('sourceDigest'); expect(prepare).toContain('abiVersion: 2')
    expect(prepare).toContain('CozeaComputerUseRuntime_CozeaComputerUseCore.bundle')
    expect(prepare).not.toContain('prepareWorker')
    expect(read('apps/desktop/electron-builder.config.cjs')).toContain('computer-use-runtime')
  })
  it('retains the authenticated T3 broker without provider home mutation', async () => {
    const { runtime } = setup()
    const [a, b] = await Promise.all([runtime.startBroker(), runtime.startBroker()])
    expect(a).toEqual(b)
    try {
      const denied = await fetch(`${a.endpoint}/v1/call`, { method: 'POST', body: '{}' })
      expect(denied.status).toBe(401)
      const allowed = await fetch(`${a.endpoint}/v1/call`, { method: 'POST', headers: { authorization: `Bearer ${a.token}` },
        body: JSON.stringify({ threadId: 't', tool: 'list_apps', arguments: {} }) })
      expect(allowed.status).toBe(200); expect((await allowed.json()).isError).toBe(false)
      const end = await fetch(`${a.endpoint}/v1/turn-ended`, { method: 'POST', headers: { authorization: `Bearer ${a.token}` }, body: '{"threadId":"t"}' })
      expect(end.status).toBe(200)
    } finally { await runtime.stopBroker() }
    expect(read('apps/desktop/electron/services/ComputerUseService.ts')).not.toContain('writeFileSync')
  })
  it('localizes the unsupported platform and advanced pointer settings', () => {
    const ui = read('apps/desktop/src/features/settings/ComputerUse.tsx')
    expect(ui).toContain("t('settings.computerUse.macosOnly')")
    expect(ui).toContain("aria-label={t('settings.computerUse.allowGlobalPointerFallback')}")
    expect(read('apps/desktop/src/lib/i18n/computerUse.ts')).toContain('Interacción avanzada')
  })
})
