import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

import { resolveUnpackagedBuildDir } from '../runtime/runtimeManifest'
import { readComputerUseAppSettings, type ComputerUseAppSettings } from './computerUseSettings'
import type { ComputerUseDiagnostics } from '@shared/electronApiTypes'

const require = createRequire(import.meta.url)
const COMPUTER_USE_TOOLS = new Set([
  'list_apps', 'get_app_state', 'click', 'perform_secondary_action', 'scroll',
  'drag', 'type_text', 'press_key', 'set_value',
])
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const CALL_TIMEOUT_MS = 35_000
const RUNTIME_VERSION = '2.0.0'
const UNSUPPORTED = 'Computer Use is currently available on macOS only.'

export type ComputerUseThreadPolicy = 'inherit' | 'allow' | 'deny'
type ExplicitComputerUseThreadPolicy = Exclude<ComputerUseThreadPolicy, 'inherit'>
interface ScheduledThreadPolicyEntry { policy: ExplicitComputerUseThreadPolicy; scheduledTaskId: string }

/** ABI 2 is checked before any FFI call; ABI 1 has a different call arity. */
export interface NativeComputerUseAddon {
  abiVersion(): number
  configureSession(sessionId: string, policyJson: string): boolean
  revokeSession(sessionId: string): void
  revokeAll(): void
  cancelRequest(sessionId: string, requestId: string): void
  callTool(sessionId: string, tool: string, argumentsJson: string, contextJson: string): Promise<string>
  listTools(): string
  diagnostics(): Promise<string>
  requestPermission(target: 'accessibility' | 'screenRecording'): boolean
  turnEnded(sessionId: string): Promise<void>
  resetSession(sessionId: string): Promise<void>
  resetAll(): Promise<void>
}
interface ComputerUseContentItem { type: 'text' | 'image'; text?: string; data?: string; mimeType?: string }
export interface ComputerUseToolResult { content: ComputerUseContentItem[]; isError: boolean }
export interface ComputerUseRuntimeEnvironment { endpoint: string; token: string }
interface SessionPolicy { revision: string; signature: string }
interface CallOptions { requestId?: string; signal?: AbortSignal }
export interface ComputerUseRuntimeDependencies {
  platform?: NodeJS.Platform
  settings?: () => ComputerUseAppSettings
  addon?: () => NativeComputerUseAddon | null
  timeoutMs?: number
}

function failure(message: string): ComputerUseToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
function parseToolResult(raw: string): ComputerUseToolResult {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return failure('Invalid native result envelope.')
    const record = parsed as Record<string, unknown>
    if (!Array.isArray(record.content) || typeof record.isError !== 'boolean') return failure('Invalid native result envelope.')
    const content: ComputerUseContentItem[] = []
    for (const item of record.content) {
      if (!item || typeof item !== 'object') return failure('Invalid native result content.')
      const entry = item as Record<string, unknown>
      if (entry.type === 'text' && typeof entry.text === 'string') content.push({ type: 'text', text: entry.text })
      else if (entry.type === 'image' && typeof entry.data === 'string' && entry.mimeType === 'image/png') {
        content.push({ type: 'image', data: entry.data, mimeType: entry.mimeType })
      } else return failure('Invalid native result content.')
    }
    return content.length ? { content, isError: record.isError } : failure('Native runtime returned no content.')
  } catch { return failure('Computer Use returned invalid JSON.') }
}
function safeTokenEquals(received: string, expected: string): boolean {
  const left = Buffer.from(received); const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
function validateActionPolicy(settings: ComputerUseAppSettings, tool: string, args: unknown,
  threadPolicy: ComputerUseThreadPolicy = 'inherit'): string | null {
  if (threadPolicy === 'deny') return 'Computer Use is not authorized for this scheduled task.'
  if (!settings.computerUseEnabled) return 'Computer Use is disabled in Cozea Settings.'
  if (!COMPUTER_USE_TOOLS.has(tool)) return `Unknown Computer Use tool: ${tool}`
  if ((settings.disabledComputerUseTools ?? []).includes(tool)) return `Computer Use capability '${tool}' is disabled in Cozea Settings.`
  if (tool === 'click' && args && typeof args === 'object' &&
      (args as { click_method?: unknown }).click_method === 'global' && !settings.computerUseAllowGlobalPointerFallbacks) {
    return 'Global physical-pointer fallback is disabled in Cozea Settings.'
  }
  return null
}

export class ComputerUseRuntimeService {
  private static instance: ComputerUseRuntimeService | null = null
  static getInstance(): ComputerUseRuntimeService {
    if (!this.instance) this.instance = new ComputerUseRuntimeService()
    return this.instance
  }
  private nativeAddon: NativeComputerUseAddon | null | undefined
  private readonly activeRuntimeSessions = new Set<string>()
  private readonly threadPolicies = new Map<string, ScheduledThreadPolicyEntry>()
  private readonly scheduledThreadByTask = new Map<string, string>()
  private readonly sessionPolicies = new Map<string, SessionPolicy>()
  private readonly endingSessions = new Map<string, Promise<void>>()
  private resetBarrier: Promise<void> = Promise.resolve()
  private revision = 0n
  private server: Server | null = null
  private endpoint: string | null = null
  private starting: Promise<ComputerUseRuntimeEnvironment> | null = null
  private readonly token = randomBytes(32).toString('base64url')
  private readonly platform: NodeJS.Platform
  private readonly settings: () => ComputerUseAppSettings
  private readonly dependencies: ComputerUseRuntimeDependencies
  constructor(dependencies: ComputerUseRuntimeDependencies = {}) {
    this.dependencies = dependencies
    this.platform = dependencies.platform ?? process.platform
    this.settings = dependencies.settings ?? readComputerUseAppSettings
  }

  private loadNativeAddon(): NativeComputerUseAddon | null {
    if (this.platform !== 'darwin') return null
    if (this.nativeAddon !== undefined) return this.nativeAddon
    let candidate: NativeComputerUseAddon | null
    if (this.dependencies.addon) candidate = this.dependencies.addon()
    else {
      if (!['arm64', 'x64'].includes(process.arch)) throw new Error('Unsupported macOS architecture.')
      const packaged = path.join(process.resourcesPath, 'computer-use-runtime')
      const root = fs.existsSync(packaged) ? packaged : resolveUnpackagedBuildDir('computer-use-runtime')
      const addonPath = path.join(root, `cozea_computer_use.darwin-${process.arch}.node`)
      if (!fs.existsSync(addonPath)) return null
      candidate = require(addonPath) as NativeComputerUseAddon
    }
    if (candidate && (typeof candidate.abiVersion !== 'function' || candidate.abiVersion() !== 2)) {
      throw new Error('Computer Use native ABI mismatch. Rebuild the bundled runtime.')
    }
    this.nativeAddon = candidate
    return candidate
  }
  private invalidateSession(sessionId: string): void {
    this.sessionPolicies.delete(sessionId)
    this.nativeAddon?.revokeSession(sessionId)
  }
  setScheduledThreadPolicy(taskId: string, sessionId: string, policy: ExplicitComputerUseThreadPolicy): void {
    const task = taskId.trim(); const session = sessionId.trim()
    if (!task || !session) throw new Error('Scheduled Computer Use policy requires task and thread IDs.')
    const previous = this.scheduledThreadByTask.get(task)
    if (previous && previous !== session) this.clearThreadPolicy(previous)
    this.clearThreadPolicy(session)
    this.threadPolicies.set(session, { policy, scheduledTaskId: task })
    this.scheduledThreadByTask.set(task, session)
  }
  clearThreadPolicy(sessionId: string): void {
    const session = sessionId.trim(); const entry = this.threadPolicies.get(session)
    this.invalidateSession(session)
    this.threadPolicies.delete(session)
    if (entry && this.scheduledThreadByTask.get(entry.scheduledTaskId) === session) this.scheduledThreadByTask.delete(entry.scheduledTaskId)
  }
  clearScheduledTaskPolicy(taskId: string): void {
    const session = this.scheduledThreadByTask.get(taskId.trim())
    if (session) this.clearThreadPolicy(session)
  }
  revokeScheduledTaskPolicy(taskId: string): void {
    const session = this.scheduledThreadByTask.get(taskId.trim())
    if (!session) return
    const entry = this.threadPolicies.get(session)
    if (entry?.policy === 'allow') entry.policy = 'deny'
    this.invalidateSession(session)
  }
  private threadPolicy(session: string): ComputerUseThreadPolicy { return this.threadPolicies.get(session.trim())?.policy ?? 'inherit' }

  async callTool(sessionId: string, tool: string, args: unknown, options: CallOptions = {}): Promise<ComputerUseToolResult> {
    const session = sessionId.trim()
    if (this.platform !== 'darwin') return failure(UNSUPPORTED)
    if (!session || Buffer.byteLength(session) > 512 || session.includes('\0')) return failure('Invalid thread ID.')
    if (!args || typeof args !== 'object' || Array.isArray(args)) return failure('Arguments must be a JSON object.')
    // Teardown is a barrier, not an input queue. Re-read live policy after waiting.
    await this.resetBarrier
    await this.endingSessions.get(session)
    if (options.signal?.aborted) return failure('CANCELLED: Request cancelled before dispatch.')
    try {
      const settings = this.settings()
      const denied = validateActionPolicy(settings, tool, args, this.threadPolicy(session))
      if (denied) { this.invalidateSession(session); return failure(denied) }
      const addon = this.loadNativeAddon()
      if (!addon) return failure('Native Computer Use runtime is not prepared.')
      const allowedTools = [...COMPUTER_USE_TOOLS].filter((name) => !(settings.disabledComputerUseTools ?? []).includes(name))
      const signature = JSON.stringify([allowedTools, settings.computerUseAllowGlobalPointerFallbacks])
      let policy = this.sessionPolicies.get(session)
      if (!policy || policy.signature !== signature) {
        policy = { revision: String(++this.revision), signature }
        if (!addon.configureSession(session, JSON.stringify({ revision: policy.revision, allowedTools,
          allowGlobalPointer: settings.computerUseAllowGlobalPointerFallbacks === true }))) return failure('Native authorization configuration failed.')
        this.sessionPolicies.set(session, policy)
      }
      const requestId = options.requestId ?? randomUUID()
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(requestId)) return failure('Invalid Computer Use request ID.')
      const argumentsJson = JSON.stringify(args)
      if (Buffer.byteLength(argumentsJson) > MAX_REQUEST_BYTES) return failure('Computer Use request is too large.')
      this.activeRuntimeSessions.add(session)
      let timer: ReturnType<typeof setTimeout> | undefined
      let onAbort: (() => void) | undefined
      try {
        const result = addon.callTool(session, tool, argumentsJson, JSON.stringify({ requestID: requestId, policyRevision: policy.revision }))
        const cancellation = new Promise<string>((resolve) => {
          onAbort = () => {
            addon.cancelRequest(session, requestId)
            resolve(JSON.stringify(failure('DELIVERY_UNKNOWN: Request cancelled. Observe before retrying an action.')))
          }
          options.signal?.addEventListener('abort', onAbort, { once: true })
          timer = setTimeout(onAbort, this.dependencies.timeoutMs ?? CALL_TIMEOUT_MS)
          if (options.signal?.aborted) onAbort()
        })
        return parseToolResult(await Promise.race([result, cancellation]))
      } finally {
        if (timer) clearTimeout(timer)
        if (onAbort) options.signal?.removeEventListener('abort', onAbort)
      }
    } catch (error) { return failure(error instanceof Error ? error.message : 'Native Computer Use failed.') }
  }
  async getDiagnostics(): Promise<ComputerUseDiagnostics> {
    if (this.platform !== 'darwin') return { supported: false, installed: false, accessibility: false, screenRecording: false, error: UNSUPPORTED }
    try {
      const addon = this.loadNativeAddon()
      if (!addon) return { supported: true, installed: false, accessibility: false, screenRecording: false, error: 'Native Computer Use runtime is not prepared.' }
      const parsed = JSON.parse(await addon.diagnostics()) as ComputerUseDiagnostics
      return { ...parsed, supported: true, installed: true, version: parsed.version ?? RUNTIME_VERSION }
    } catch (error) {
      return { supported: true, installed: false, accessibility: false, screenRecording: false,
        error: error instanceof Error ? error.message : 'Native diagnostics failed.' }
    }
  }
  requestPermission(target: 'accessibility' | 'screenRecording'): boolean {
    return this.platform === 'darwin' && (this.loadNativeAddon()?.requestPermission(target) ?? false)
  }
  async turnEnded(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    const hadActiveRuntime = this.activeRuntimeSessions.delete(normalizedSessionId)
    this.clearThreadPolicy(normalizedSessionId)
    if (!hadActiveRuntime) return
    await this.finishSession(normalizedSessionId)
  }
  async resetSession(sessionId: string): Promise<void> {
    const session = sessionId.trim()
    this.activeRuntimeSessions.delete(session)
    this.clearThreadPolicy(session)
    await this.finishSession(session)
  }
  private finishSession(session: string): Promise<void> {
    const existing = this.endingSessions.get(session)
    if (existing) return existing
    const ending = (this.nativeAddon?.resetSession(session) ?? Promise.resolve()).finally(() => {
      if (this.endingSessions.get(session) === ending) this.endingSessions.delete(session)
    })
    this.endingSessions.set(session, ending)
    return ending
  }
  async resetAll(): Promise<void> {
    for (const entry of this.threadPolicies.values()) {
      if (entry.policy === 'allow') entry.policy = 'deny'
    }
    this.activeRuntimeSessions.clear()
    this.sessionPolicies.clear()
    this.nativeAddon?.revokeAll() // synchronous: no input can slip past async teardown
    const previous = this.resetBarrier
    const next = previous.then(async () => {
      await Promise.all(this.endingSessions.values())
      await this.nativeAddon?.resetAll()
    })
    this.resetBarrier = next.catch(() => undefined)
    await next
  }
  async startBroker(): Promise<ComputerUseRuntimeEnvironment> {
    if (this.endpoint) return { endpoint: this.endpoint, token: this.token }
    if (this.starting) return this.starting
    this.starting = this.bindBroker()
    try { return await this.starting } finally { this.starting = null }
  }
  private async bindBroker(): Promise<ComputerUseRuntimeEnvironment> {
    const server = createServer((request, response) => void this.handleHttpRequest(request, response))
    server.requestTimeout = CALL_TIMEOUT_MS; server.headersTimeout = 10_000
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Computer Use broker failed to bind.')
    this.endpoint = `http://127.0.0.1:${address.port}`
    return { endpoint: this.endpoint, token: this.token }
  }
  async stopBroker(): Promise<void> {
    if (this.starting) await this.starting
    await this.resetAll()
    this.threadPolicies.clear(); this.scheduledThreadByTask.clear()
    const server = this.server; this.server = null; this.endpoint = null
    if (server) await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() })
  }
  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) throw new Error('Computer Use request is too large.')
      chunks.push(buffer)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Request must be an object.')
    return parsed as Record<string, unknown>
  }
  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    if (response.destroyed || response.writableEnded) return
    const body = JSON.stringify(payload)
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
    response.end(body)
  }
  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const credential = request.headers.authorization ?? ''
    if (!credential.startsWith('Bearer ') || !safeTokenEquals(credential.slice(7).trim(), this.token)) {
      this.writeJson(response, 401, failure('Invalid Computer Use broker credential.')); return
    }
    if (request.method !== 'POST' || !['/v1/call', '/v1/turn-ended'].includes(request.url ?? '')) {
      this.writeJson(response, 404, failure('Unknown Computer Use broker route.')); return
    }
    const abort = new AbortController()
    const onClose = () => { if (!response.writableEnded) abort.abort() }
    response.on('close', onClose)
    try {
      const input = await this.readBody(request)
      const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : ''
      if (!threadId) { this.writeJson(response, 400, failure('A threadId is required.')); return }
      if (request.url === '/v1/turn-ended') {
        await this.turnEnded(threadId)
        this.writeJson(response, 200, { ok: true }); return
      }
      if (typeof input.tool !== 'string' || !input.tool.trim()) { this.writeJson(response, 400, failure('A tool name is required.')); return }
      const result = await this.callTool(threadId, input.tool.trim(), input.arguments ?? {}, {
        requestId: typeof input.requestId === 'string' ? input.requestId : undefined, signal: abort.signal,
      })
      this.writeJson(response, 200, result)
    } catch { this.writeJson(response, 400, failure('Invalid Computer Use request.')) }
    finally { response.off('close', onClose) }
  }
}
export const __computerUseRuntimeTesting = {
  COMPUTER_USE_TOOLS, validateActionPolicy, parseToolResult,
  threadPolicy: (runtime: ComputerUseRuntimeService, sessionId: string) => runtime['threadPolicy'](sessionId),
}
