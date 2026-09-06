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
  turnEnded(sessionId: string): void
  resetSession(sessionId: string): void
  resetAll(): void
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

/**
 * Creates a failed Computer Use tool result with the given error message.
 *
 * @param message - Error message to include in the result
 * @returns A ComputerUseToolResult marked as an error
 */
function failure(message: string): ComputerUseToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Parses a JSON string into a validated ComputerUseToolResult, filtering out
 * invalid content items and handling parse errors gracefully.
 *
 * @param raw - JSON string representation of a tool result
 * @returns Parsed and validated ComputerUseToolResult
 */
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

/**
 * Resolves the root directory containing the bundled Computer Use runtime.
 * Checks the packaged resources path first, then falls back to the build directory.
 *
 * @returns Absolute path to the Computer Use runtime directory
 */
function resolveRuntimeRoot(): string {
  const packaged = path.join(process.resourcesPath, 'computer-use-runtime')
  if (fs.existsSync(packaged)) return packaged
  return resolveUnpackagedBuildDir('computer-use-runtime')
}

/**
 * Returns the architecture-specific native addon filename for macOS.
 *
 * @returns Native addon filename (e.g., 'cozea_computer_use.darwin-arm64.node')
 */
function nativeAddonName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return `cozea_computer_use.darwin-${arch}.node`
}

/**
 * Returns the platform-specific worker binary filename.
 *
 * @returns Worker binary name ('open-computer-use.exe' on Windows, 'open-computer-use' elsewhere)
 */
function workerBinaryName(): string {
  return process.platform === 'win32' ? 'open-computer-use.exe' : 'open-computer-use'
}

/**
 * Performs timing-safe string comparison to prevent timing attacks on tokens.
 *
 * @param received - Received token string
 * @param expected - Expected token string
 * @returns True if tokens match, false otherwise
 */
function safeTokenEquals(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Extracts the set of disabled Computer Use tools from app settings.
 *
 * @param settings - Computer Use app settings
 * @returns Set of disabled tool names
 */
function disabledTools(settings: ComputerUseAppSettings): Set<string> {
  return new Set(
    (settings.disabledComputerUseTools ?? []).filter((tool) => COMPUTER_USE_TOOLS.has(tool)),
  )
}

/**
 * Validates whether a Computer Use tool call is permitted under current policy settings.
 * Checks if Computer Use is enabled, the tool is valid and enabled, and specific
 * restrictions like global pointer fallback policy.
 *
 * @param settings - Computer Use app settings
 * @param tool - Tool name being invoked
 * @param args - Tool arguments
 * @returns Error message if validation fails, null if permitted
 */
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

/**
 * Manages a single Computer Use worker process session that communicates via
 * JSON-RPC over stdio. Handles request/response correlation, timeouts, and
 * lifecycle notifications for Windows and Linux platforms.
 */
class WorkerMcpSession {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly output: readline.Interface
  private readonly pending = new Map<number, PendingWorkerRequest>()
  private nextId = 1
  private stopped = false

  /**
   * Spawns a new Computer Use worker process in MCP mode.
   *
   * @param binaryPath - Absolute path to the worker binary
   */
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

  /**
   * Fails all pending requests with the given error and stops the session.
   *
   * @param error - Error to reject all pending requests with
   */
  private failAll(error: Error): void {
    this.stopped = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.output.close()
  }

  /**
   * Handles a single line of JSON-RPC response from the worker process.
   * Correlates the response with a pending request and resolves or rejects it.
   *
   * @param line - JSON-RPC response line
   */
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

  /**
   * Invokes a Computer Use tool in the worker process via JSON-RPC.
   *
   * @param tool - Tool name to invoke
   * @param args - Tool arguments
   * @returns Promise resolving to the tool result
   */
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

  /**
   * Sends a turn-ended notification to the worker process, signaling that the
   * current agent turn has completed and any visual state should be cleaned up.
   */
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

  /**
   * Stops the worker process gracefully by sending a turn-ended notification
   * and terminating with SIGTERM.
   */
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

/**
 * Manages the Computer Use runtime service, providing a unified interface for both
 * macOS native addon (OpenComputerUseKit bridge) and cross-platform worker processes.
 * Handles tool execution, permission requests, session lifecycle, and HTTP broker
 * for T3 integration. Serializes all tool calls to prevent race conditions on shared
 * desktop state (element indexes, cursor position).
 */
export class ComputerUseRuntimeService {
  private static instance: ComputerUseRuntimeService | null = null

  /**
   * Returns the singleton instance of the Computer Use runtime service.
   *
   * @returns The ComputerUseRuntimeService instance
   */
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

  /**
   * Loads the macOS native Computer Use addon lazily. Returns null if already
   * attempted, not on macOS, or if the addon file doesn't exist.
   *
   * @returns The loaded native addon or null if unavailable
   */
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

  /**
   * Returns an existing worker session for the given session ID or creates a new one.
   *
   * @param sessionId - Unique session identifier
   * @returns WorkerMcpSession for the session
   * @throws Error if the worker binary is missing
   */
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

  /**
   * Executes an async operation serialized with all other Computer Use operations
   * to prevent concurrent access to shared desktop state.
   *
   * @param operation - Async operation to execute
   * @returns Promise resolving to the operation result
   */
  private runSerialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.actionTail.then(operation, operation)
    this.actionTail = next.catch(() => undefined)
    return next
  }

  /**
   * Invokes a Computer Use tool with policy validation. On macOS, delegates to
   * the native addon; on Windows/Linux, delegates to a worker process. All calls
   * are serialized to prevent race conditions on desktop state.
   *
   * @param sessionId - Session identifier for state isolation
   * @param tool - Tool name to invoke
   * @param args - Tool arguments
   * @returns Promise resolving to the tool execution result
   */
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

  /**
   * Retrieves Computer Use runtime diagnostics including installation status,
   * version, permissions, and any errors. Checks native addon on macOS or
   * worker binary on other platforms.
   *
   * @returns Promise resolving to diagnostic information
   */
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

  /**
   * Requests macOS system permission for accessibility or screen recording.
   * On non-macOS platforms, always returns true (no special permissions needed).
   *
   * @param target - Permission type to request ('accessibility' or 'screenRecording')
   * @returns True if permission is granted or already held, false otherwise
   */
  requestPermission(target: 'accessibility' | 'screenRecording'): boolean {
    if (process.platform !== 'darwin') return true
    return this.loadNativeAddon()?.requestPermission(target) ?? false
  }

  /**
   * Signals that an agent turn has ended for a given session. This allows the
   * runtime to clean up visual state like on-screen cursors or highlights.
   *
   * @param sessionId - Session identifier
   */
  turnEnded(sessionId: string): void {
    if (process.platform === 'darwin') this.loadNativeAddon()?.turnEnded(sessionId)
    else this.workerSessions.get(sessionId)?.turnEnded()
  }

  /**
   * Resets a specific Computer Use session, clearing its state and stopping
   * any associated worker process.
   *
   * @param sessionId - Session identifier to reset
   */
  resetSession(sessionId: string): void {
    if (process.platform === 'darwin') {
      this.loadNativeAddon()?.resetSession(sessionId)
      return
    }
    this.workerSessions.get(sessionId)?.stop()
    this.workerSessions.delete(sessionId)
  }

  /**
   * Resets all Computer Use sessions, clearing all state and stopping all worker
   * processes. Called when settings change to ensure stale state doesn't persist.
   */
  resetAll(): void {
    this.loadNativeAddon()?.resetAll()
    for (const session of this.workerSessions.values()) session.stop()
    this.workerSessions.clear()
  }

  /**
   * Starts the HTTP broker server that exposes Computer Use operations to T3.
   * The broker listens on localhost with token authentication and provides
   * endpoints for tool calls and turn-ended notifications.
   *
   * @returns Promise resolving to the broker endpoint URL and authentication token
   */
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

  /**
   * Stops the HTTP broker server and resets all Computer Use sessions.
   *
   * @returns Promise that resolves when the server is fully stopped
   */
  async stopBroker(): Promise<void> {
    this.resetAll()
    const server = this.server
    this.server = null
    this.endpoint = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  /**
   * Reads the complete HTTP request body with size limits for security.
   *
   * @param request - HTTP request object
   * @returns Promise resolving to the request body as a UTF-8 string
   * @throws Error if the request body exceeds MAX_REQUEST_BYTES
   */
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

  /**
   * Writes a JSON response with appropriate headers.
   *
   * @param response - HTTP response object
   * @param status - HTTP status code
   * @param payload - Response payload to serialize as JSON
   */
  private writeJson(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  /**
   * Checks if an HTTP request is authorized using Bearer token authentication.
   *
   * @param request - HTTP request object
   * @returns True if the request has a valid bearer token, false otherwise
   */
  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization ?? ''
    if (!header.startsWith('Bearer ')) return false
    return safeTokenEquals(header.slice('Bearer '.length).trim(), this.token)
  }

  /**
   * Handles HTTP requests to the Computer Use broker, routing to appropriate
   * endpoints for tool calls and turn-ended notifications.
   *
   * @param request - HTTP request object
   * @param response - HTTP response object
   */
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
        this.turnEnded(threadId)
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
