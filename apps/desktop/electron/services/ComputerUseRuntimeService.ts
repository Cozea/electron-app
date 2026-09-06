import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

import { resolveUnpackagedBuildDir } from '../runtime/runtimeManifest'
import {
  readComputerUseAppSettings,
  type ComputerUseAppSettings,
} from './computerUseSettings'
import type { ComputerUseDiagnostics } from '@shared/electronApiTypes'

const require = createRequire(import.meta.url)

const COMPUTER_USE_TOOLS = new Set([
  'list_apps',
  'get_app_state',
  'click',
  'perform_secondary_action',
  'scroll',
  'drag',
  'type_text',
  'press_key',
  'set_value',
])
const UPSTREAM_VERSION = '0.3.3'
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const CALL_TIMEOUT_MS = 45_000

interface NativeComputerUseAddon {
  callTool(sessionId: string, tool: string, argumentsJson: string): Promise<string>
  listTools(): string
  diagnostics(): string
  requestPermission(target: 'accessibility' | 'screenRecording'): boolean
  turnEnded(sessionId: string): Promise<void>
  resetSession(sessionId: string): Promise<void>
  resetAll(): Promise<void>
}

interface ComputerUseContentItem {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

export interface ComputerUseToolResult {
  content: ComputerUseContentItem[]
  isError: boolean
}

interface PendingWorkerRequest {
  resolve: (result: ComputerUseToolResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface WorkerRpcMessage {
  id?: unknown
  error?: unknown
  result?: unknown
}

function failure(message: string): ComputerUseToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function parseToolResult(raw: string): ComputerUseToolResult {
  try {
    const parsed = JSON.parse(raw) as Partial<ComputerUseToolResult>
    const content = Array.isArray(parsed.content) ? parsed.content : []
    return {
      content: content.filter((item): item is ComputerUseContentItem => {
        if (!item || typeof item !== 'object') return false
        const type = (item as { type?: unknown }).type
        return type === 'text' || type === 'image'
      }),
      isError: parsed.isError === true,
    }
  } catch (error) {
    return failure(
      `Computer Use returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function resolveRuntimeRoot(): string {
  const packaged = path.join(process.resourcesPath, 'computer-use-runtime')
  if (fs.existsSync(packaged)) return packaged
  return resolveUnpackagedBuildDir('computer-use-runtime')
}

function nativeAddonName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `cozea_computer_use.darwin-${arch}.node`
}

function workerBinaryName(): string {
  return process.platform === 'win32' ? 'open-computer-use.exe' : 'open-computer-use'
}

function safeTokenEquals(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function disabledTools(settings: ComputerUseAppSettings): Set<string> {
  return new Set(
    (settings.disabledComputerUseTools ?? []).filter((tool) => COMPUTER_USE_TOOLS.has(tool)),
  )
}

function validateActionPolicy(
  settings: ComputerUseAppSettings,
  tool: string,
  args: unknown,
): string | null {
  if (!settings.computerUseEnabled) return 'Computer Use is disabled in Cozea Settings.'
  if (!COMPUTER_USE_TOOLS.has(tool)) return `Unknown Computer Use tool: ${tool}`
  if (disabledTools(settings).has(tool)) {
    return `Computer Use capability '${tool}' is disabled in Cozea Settings.`
  }
  if (
    tool === 'click' &&
    args &&
    typeof args === 'object' &&
    (args as { click_method?: unknown }).click_method === 'global' &&
    settings.computerUseAllowGlobalPointerFallbacks !== true
  ) {
    return 'Global physical-pointer fallback is disabled in Cozea Settings.'
  }
  return null
}

class WorkerMcpSession {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly output: readline.Interface
  private readonly pending = new Map<number, PendingWorkerRequest>()
  private nextId = 1
  private stopped = false

  constructor(binaryPath: string) {
    this.child = spawn(binaryPath, ['mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      windowsHide: true,
    })
    this.output = readline.createInterface({ input: this.child.stdout })
    this.output.on('line', (line) => this.handleLine(line))
    this.child.on('error', (error) => this.failAll(error))
    this.child.stdin.on('error', (error) => this.failAll(error))
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim()
      if (text) console.warn('[ComputerUse:worker]', text)
    })
    this.child.once('exit', (code, signal) => {
      this.failAll(
        new Error(`Computer Use worker exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`),
      )
    })
  }

  private failAll(error: Error): void {
    this.stopped = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.output.close()
  }

  private handleLine(line: string): void {
    let payload: unknown
    try {
      payload = JSON.parse(line)
    } catch {
      return
    }
    if (!payload || typeof payload !== 'object') return
    const message = payload as WorkerRpcMessage
    const id = typeof message.id === 'number' ? message.id : null
    if (id === null) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)

    if (message.error && typeof message.error === 'object') {
      const errorMessage = (message.error as { message?: unknown }).message
      pending.reject(
        new Error(
          typeof errorMessage === 'string' ? errorMessage : 'Computer Use worker request failed.',
        ),
      )
      return
    }

    pending.resolve(
      message.result && typeof message.result === 'object'
        ? parseToolResult(JSON.stringify(message.result))
        : failure('Computer Use worker returned no result.'),
    )
  }

  call(tool: string, args: unknown): Promise<ComputerUseToolResult> {
    if (this.stopped) return Promise.reject(new Error('Computer Use worker is stopped.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Computer Use '${tool}' timed out.`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: tool, arguments: args ?? {} },
        })}\n`,
      )
    })
  }

  turnEnded(): void {
    if (this.stopped) return
    this.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/turn-ended',
        params: {},
      })}\n`,
    )
  }

  stop(): void {
    if (this.stopped) return
    this.turnEnded()
    this.stopped = true
    this.child.kill('SIGTERM')
  }
}

export interface ComputerUseRuntimeEnvironment {
  endpoint: string
  token: string
}

export class ComputerUseRuntimeService {
  private static instance: ComputerUseRuntimeService | null = null

  static getInstance(): ComputerUseRuntimeService {
    if (!this.instance) this.instance = new ComputerUseRuntimeService()
    return this.instance
  }

  private nativeAddon: NativeComputerUseAddon | null | undefined
  private readonly workerSessions = new Map<string, WorkerMcpSession>()
  private server: Server | null = null
  private endpoint: string | null = null
  private readonly token = randomBytes(32).toString('base64url')
  private actionTail: Promise<unknown> = Promise.resolve()

  private loadNativeAddon(): NativeComputerUseAddon | null {
    if (this.nativeAddon !== undefined) return this.nativeAddon
    if (process.platform !== 'darwin') {
      this.nativeAddon = null
      return null
    }
    const addonPath = path.join(resolveRuntimeRoot(), nativeAddonName())
    if (!fs.existsSync(addonPath)) {
      this.nativeAddon = null
      return null
    }
    try {
      this.nativeAddon = require(addonPath) as NativeComputerUseAddon
    } catch (error) {
      console.error('[ComputerUse] Failed to load native OpenComputerUseKit bridge:', error)
      this.nativeAddon = null
    }
    return this.nativeAddon
  }

  private workerSession(sessionId: string): WorkerMcpSession {
    const existing = this.workerSessions.get(sessionId)
    if (existing) return existing
    const binaryPath = path.join(resolveRuntimeRoot(), workerBinaryName())
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Bundled Computer Use runtime is missing: ${binaryPath}`)
    }
    const session = new WorkerMcpSession(binaryPath)
    this.workerSessions.set(sessionId, session)
    return session
  }

  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.actionTail.then(operation, operation)
    this.actionTail = next.catch(() => undefined)
    return next
  }

  async callTool(sessionId: string, tool: string, args: unknown): Promise<ComputerUseToolResult> {
    const settings = readComputerUseAppSettings()
    const policyError = validateActionPolicy(settings, tool, args)
    if (policyError) return failure(policyError)

    if (settings.computerUseAllowGlobalPointerFallbacks) {
      process.env.OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS = '1'
    } else {
      delete process.env.OPEN_COMPUTER_USE_ALLOW_GLOBAL_POINTER_FALLBACKS
    }

    const execute = async (): Promise<ComputerUseToolResult> => {
      if (process.platform === 'darwin') {
        const addon = this.loadNativeAddon()
        if (!addon) {
          return failure('Cozea Computer Use native runtime is not available. Rebuild the app runtime.')
        }
        try {
          return parseToolResult(await addon.callTool(sessionId, tool, JSON.stringify(args ?? {})))
        } catch (error) {
          return failure(error instanceof Error ? error.message : String(error))
        }
      }
      try {
        return await this.workerSession(sessionId).call(tool, args)
      } catch (error) {
        return failure(error instanceof Error ? error.message : String(error))
      }
    }

    // The upstream service carries mutable element-index and cursor state.
    // Serialize every call so two agent threads cannot race the desktop or
    // invalidate each other's snapshot/action sequence.
    return this.runSerialized(execute)
  }

  async getDiagnostics(): Promise<ComputerUseDiagnostics> {
    if (process.platform === 'darwin') {
      const addon = this.loadNativeAddon()
      if (!addon) {
        return {
          installed: false,
          accessibility: false,
          screenRecording: false,
          error: 'Native Computer Use runtime is not prepared.',
        }
      }
      try {
        const parsed = JSON.parse(addon.diagnostics()) as ComputerUseDiagnostics
        return { ...parsed, installed: true, version: parsed.version ?? UPSTREAM_VERSION }
      } catch (error) {
        return {
          installed: true,
          version: UPSTREAM_VERSION,
          accessibility: false,
          screenRecording: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }

    const binaryPath = path.join(resolveRuntimeRoot(), workerBinaryName())
    return {
      installed: fs.existsSync(binaryPath),
      version: UPSTREAM_VERSION,
      path: binaryPath,
      accessibility: true,
      screenRecording: true,
      ...(fs.existsSync(binaryPath) ? {} : { error: 'Bundled Computer Use worker is missing.' }),
    }
  }

  requestPermission(target: 'accessibility' | 'screenRecording'): boolean {
    if (process.platform !== 'darwin') return true
    return this.loadNativeAddon()?.requestPermission(target) ?? false
  }

  async turnEnded(sessionId: string): Promise<void> {
    if (process.platform === 'darwin') {
      await this.loadNativeAddon()?.turnEnded(sessionId)
      return
    }
    this.workerSessions.get(sessionId)?.turnEnded()
  }

  async resetSession(sessionId: string): Promise<void> {
    if (process.platform === 'darwin') {
      await this.loadNativeAddon()?.resetSession(sessionId)
      return
    }
    this.workerSessions.get(sessionId)?.stop()
    this.workerSessions.delete(sessionId)
  }

  async resetAll(): Promise<void> {
    await this.loadNativeAddon()?.resetAll()
    for (const session of this.workerSessions.values()) session.stop()
    this.workerSessions.clear()
  }

  async startBroker(): Promise<ComputerUseRuntimeEnvironment> {
    if (this.server && this.endpoint) return { endpoint: this.endpoint, token: this.token }
    this.server = createServer((request, response) => void this.handleHttpRequest(request, response))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject)
        resolve()
      })
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Computer Use broker failed to bind TCP.')
    }
    this.endpoint = `http://127.0.0.1:${address.port}`
    return { endpoint: this.endpoint, token: this.token }
  }

  async stopBroker(): Promise<void> {
    await this.resetAll()
    const server = this.server
    this.server = null
    this.endpoint = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > MAX_REQUEST_BYTES) throw new Error('Computer Use request is too large.')
      chunks.push(buffer)
    }
    return Buffer.concat(chunks).toString('utf8')
  }

  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    return safeTokenEquals(header.slice('Bearer '.length).trim(), this.token)
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.authorized(request)) {
      this.writeJson(response, 401, failure('Invalid Computer Use broker credential.'))
      return
    }

    if (request.method === 'POST' && request.url === '/v1/turn-ended') {
      try {
        const input = JSON.parse(await this.readBody(request)) as { threadId?: unknown }
        const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : ''
        if (!threadId) {
          this.writeJson(response, 400, failure('Computer Use turn end requires threadId.'))
          return
        }
        await this.turnEnded(threadId)
        this.writeJson(response, 200, { ok: true })
      } catch (error) {
        this.writeJson(response, 500, failure(error instanceof Error ? error.message : String(error)))
      }
      return
    }

    if (request.method !== 'POST' || request.url !== '/v1/call') {
      this.writeJson(response, 404, failure('Unknown Computer Use broker route.'))
      return
    }
    try {
      const input = JSON.parse(await this.readBody(request)) as {
        threadId?: unknown
        tool?: unknown
        arguments?: unknown
      }
      const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : ''
      const tool = typeof input.tool === 'string' ? input.tool.trim() : ''
      if (!threadId || !tool) {
        this.writeJson(response, 400, failure('Computer Use call requires threadId and tool.'))
        return
      }
      const result = await this.callTool(threadId, tool, input.arguments ?? {})
      // A valid MCP tool call may itself produce isError=true. Keep that as a
      // 200 result so the MCP adapter preserves the upstream result envelope.
      this.writeJson(response, 200, result)
    } catch (error) {
      this.writeJson(response, 500, failure(error instanceof Error ? error.message : String(error)))
    }
  }
}

export const __computerUseRuntimeTesting = {
  COMPUTER_USE_TOOLS,
  validateActionPolicy,
  parseToolResult,
}
