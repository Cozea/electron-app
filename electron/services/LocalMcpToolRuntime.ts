import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'

type McpServiceKind = 'filesystem' | 'shell' | 'git' | 'repo-search' | 'playwright'

interface McpToolDescriptor {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface McpCallSuccess {
  ok: true
  toolName: string
  value: unknown
}

interface McpCallFailure {
  ok: false
  error: string
}

type McpCallResult = McpCallSuccess | McpCallFailure

interface McpClientSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

const JSON_RPC_VERSION = '2.0'
const DEFAULT_MCP_TIMEOUT_MS = 20_000

const TOOL_PACKAGE_MAP: Record<McpServiceKind, { binary: string; packageName: string }> = {
  filesystem: {
    binary: 'mcp-server-filesystem',
    packageName: '@modelcontextprotocol/server-filesystem',
  },
  shell: {
    binary: 'mcp-shell-server',
    packageName: '@mako10k/mcp-shell-server',
  },
  git: {
    binary: 'git-mcp-server',
    packageName: '@cyanheads/git-mcp-server',
  },
  'repo-search': {
    binary: 'mcp-repo-search',
    packageName: 'mcp-repo-search',
  },
  playwright: {
    binary: 'playwright-mcp',
    packageName: '@playwright/mcp',
  },
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function isLocalMcpEnabled(): boolean {
  const raw = process.env.COZEA_LOCAL_MCP_ENABLED
  if (!raw || raw.trim().length === 0) {
    return true
  }
  return envFlagEnabled(raw)
}

function resolveNodeBin(binaryName: string): string | null {
  const suffix = process.platform === 'win32' ? '.cmd' : ''
  const candidateNames = [`${binaryName}${suffix}`, binaryName]
  const searchRoots = [
    process.cwd(),
    process.env.APP_ROOT,
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked') : null,
    process.resourcesPath ?? null,
  ].filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)

  for (const root of searchRoots) {
    for (const candidate of candidateNames) {
      const binPath = path.join(root, 'node_modules', '.bin', candidate)
      if (fs.existsSync(binPath)) {
        return binPath
      }
    }
  }
  return null
}

function toLowerSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()))
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

function parseJsonMaybe(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

interface JsonRpcErrorShape {
  code?: number
  message?: string
  data?: unknown
}

class StdioMcpClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private initialized = false
  private disposed = false
  private nextId = 1
  private stdoutBuffer = Buffer.alloc(0)
  private pending = new Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  constructor(
    private readonly label: string,
    private readonly spec: McpClientSpec
  ) {}

  async ensureStarted(): Promise<void> {
    if (this.initialized) return
    if (this.disposed) throw new Error(`MCP client "${this.label}" is disposed`)

    this.child = spawn(this.spec.command, this.spec.args, {
      cwd: this.spec.cwd,
      env: this.spec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      shell: false,
    })

    this.child.stdout.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, buffer])
      this.drainStdoutBuffer()
    })

    this.child.stderr.on('data', (chunk: Buffer | string) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      if (text.trim().length > 0) {
        console.debug(`[MCP:${this.label}] ${text.trimEnd()}`)
      }
    })

    this.child.on('error', (error) => {
      this.rejectAllPending(new Error(`[MCP:${this.label}] ${error.message}`))
    })

    this.child.on('close', (code, signal) => {
      const reason = signal
        ? `exited via signal ${signal}`
        : `exited with code ${code ?? 'unknown'}`
      this.rejectAllPending(new Error(`[MCP:${this.label}] ${reason}`))
      this.initialized = false
      this.child = null
    })

    await this.request(
      'initialize',
      {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'cozea-electron',
          version: process.env.npm_package_version || '0.0.0',
        },
      },
      15_000
    )
    this.notify('notifications/initialized', {})
    this.initialized = true
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const response = await this.request('tools/list', {}, DEFAULT_MCP_TIMEOUT_MS) as {
      tools?: unknown
    }
    if (!response || !Array.isArray(response.tools)) return []
    return response.tools
      .filter((tool): tool is McpToolDescriptor => {
        return (
          typeof tool === 'object' &&
          tool !== null &&
          typeof (tool as { name?: unknown }).name === 'string'
        )
      })
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs = DEFAULT_MCP_TIMEOUT_MS): Promise<unknown> {
    const response = await this.request('tools/call', {
      name,
      arguments: args,
    }, timeoutMs) as {
      isError?: boolean
      content?: unknown
      [key: string]: unknown
    }

    if (response?.isError) {
      const toolText = LocalMcpToolRuntime.extractTextFromToolResult(response)
      throw new Error(toolText || `MCP tool "${name}" returned isError`)
    }
    return response
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.initialized = false
    this.rejectAllPending(new Error(`[MCP:${this.label}] client disposed`))
    if (this.child) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // ignore
      }
    }
    this.child = null
  }

  private notify(method: string, params: unknown): void {
    this.writeMessage({
      jsonrpc: JSON_RPC_VERSION,
      method,
      params,
    })
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    if (!this.child || this.child.stdin.destroyed) {
      return Promise.reject(new Error(`[MCP:${this.label}] process is not available`))
    }

    const id = this.nextId++

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`[MCP:${this.label}] ${method} timed out after ${timeoutMs}ms`))
      }, Math.max(1_000, timeoutMs))

      this.pending.set(id, { resolve, reject, timeout })
      this.writeMessage({
        jsonrpc: JSON_RPC_VERSION,
        id,
        method,
        params,
      })
    })
  }

  private writeMessage(message: Record<string, unknown>): void {
    if (!this.child || this.child.stdin.destroyed) {
      throw new Error(`[MCP:${this.label}] process stdin is not writable`)
    }

    const payload = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`
    this.child.stdin.write(header + payload)
  }

  private drainStdoutBuffer(): void {
    while (this.stdoutBuffer.length > 0) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        return
      }

      const headerText = this.stdoutBuffer.slice(0, headerEnd).toString('utf8')
      const contentLengthMatch = /content-length:\s*(\d+)/i.exec(headerText)
      if (!contentLengthMatch) {
        // Unexpected framing: drop the unreadable header chunk and continue.
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4)
        continue
      }

      const contentLength = Number(contentLengthMatch[1])
      if (!Number.isFinite(contentLength) || contentLength < 0) {
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4)
        continue
      }

      const frameEnd = headerEnd + 4 + contentLength
      if (this.stdoutBuffer.length < frameEnd) {
        return
      }

      const bodyText = this.stdoutBuffer.slice(headerEnd + 4, frameEnd).toString('utf8')
      this.stdoutBuffer = this.stdoutBuffer.slice(frameEnd)
      this.handleIncomingMessage(bodyText)
    }
  }

  private handleIncomingMessage(raw: string): void {
    const parsed = parseJsonMaybe(raw)
    if (!parsed || typeof parsed !== 'object') {
      return
    }

    const message = parsed as {
      id?: unknown
      result?: unknown
      error?: JsonRpcErrorShape
    }

    if (typeof message.id !== 'number') {
      return
    }

    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timeout)

    if (message.error) {
      const reason = message.error.message || 'Unknown JSON-RPC error'
      pending.reject(new Error(`[MCP:${this.label}] ${reason}`))
      return
    }

    pending.resolve(message.result)
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
      this.pending.delete(id)
    }
  }
}

export class LocalMcpToolRuntime {
  private static instance: LocalMcpToolRuntime | null = null

  private readonly clients = new Map<string, StdioMcpClient>()
  private readonly toolNamesByClient = new Map<string, string[]>()

  static getInstance(): LocalMcpToolRuntime {
    if (!LocalMcpToolRuntime.instance) {
      LocalMcpToolRuntime.instance = new LocalMcpToolRuntime()
    }
    return LocalMcpToolRuntime.instance
  }

  static extractTextFromToolResult(value: unknown): string | null {
    if (typeof value === 'string') return value
    if (!value || typeof value !== 'object') return null

    const record = value as Record<string, unknown>
    const directTextCandidates = ['text', 'output', 'stdout', 'message']
    for (const key of directTextCandidates) {
      if (typeof record[key] === 'string' && (record[key] as string).trim().length > 0) {
        return record[key] as string
      }
    }

    const structuredContent = record.structuredContent
    if (typeof structuredContent === 'string') return structuredContent
    if (structuredContent && typeof structuredContent === 'object') {
      const structured = structuredContent as Record<string, unknown>
      for (const key of directTextCandidates) {
        if (typeof structured[key] === 'string' && (structured[key] as string).trim().length > 0) {
          return structured[key] as string
        }
      }
    }

    const content = record.content
    if (Array.isArray(content)) {
      const textParts = content
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          const partRecord = part as Record<string, unknown>
          if (typeof partRecord.text === 'string') return partRecord.text
          if (typeof partRecord.content === 'string') return partRecord.content
          return ''
        })
        .filter((text) => text.trim().length > 0)
      if (textParts.length > 0) {
        return textParts.join('\n')
      }
    }

    return null
  }

  static extractStructuredFromToolResult(value: unknown): unknown {
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (record.structuredContent !== undefined) {
      return record.structuredContent
    }
    return null
  }

  async callTool(args: {
    kind: McpServiceKind
    workspaceRoot: string
    preferredNames: string[]
    argVariants: Array<Record<string, unknown>>
    timeoutMs?: number
  }): Promise<McpCallResult> {
    if (!isLocalMcpEnabled()) {
      return {
        ok: false,
        error: 'Local MCP runtime is disabled.',
      }
    }

    const workspaceRoot = path.resolve(args.workspaceRoot)
    const clientKey = this.toClientKey(args.kind, workspaceRoot)
    const client = await this.getOrCreateClient(args.kind, workspaceRoot)
    if (!client) {
      return {
        ok: false,
        error: `Failed to initialize ${args.kind} MCP client.`,
      }
    }

    const availableToolNames = await this.getToolNames(clientKey, client)
    if (availableToolNames.length === 0) {
      return {
        ok: false,
        error: `${args.kind} MCP server exposes no tools.`,
      }
    }

    const candidates = this.selectCandidateToolNames(availableToolNames, args.preferredNames)
    if (candidates.length === 0) {
      return {
        ok: false,
        error: `${args.kind} MCP server has no matching tool for ${args.preferredNames.join(', ')}.`,
      }
    }

    const errors: string[] = []
    for (const toolName of candidates) {
      for (const payload of args.argVariants) {
        try {
          const result = await client.callTool(
            toolName,
            payload,
            args.timeoutMs ?? DEFAULT_MCP_TIMEOUT_MS
          )
          return {
            ok: true,
            toolName,
            value: result,
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          errors.push(`${toolName}: ${message}`)
        }
      }
    }

    return {
      ok: false,
      error: errors[errors.length - 1] || `All ${args.kind} MCP tool variants failed.`,
    }
  }

  disposeAll(): void {
    for (const client of this.clients.values()) {
      client.dispose()
    }
    this.clients.clear()
    this.toolNamesByClient.clear()
  }

  private toClientKey(kind: McpServiceKind, workspaceRoot: string): string {
    return `${kind}:${workspaceRoot}`
  }

  private async getOrCreateClient(kind: McpServiceKind, workspaceRoot: string): Promise<StdioMcpClient | null> {
    const key = this.toClientKey(kind, workspaceRoot)
    const existing = this.clients.get(key)
    if (existing) return existing

    const spec = this.buildClientSpec(kind, workspaceRoot)
    const client = new StdioMcpClient(key, spec)
    try {
      await client.ensureStarted()
      this.clients.set(key, client)
      return client
    } catch (error) {
      client.dispose()
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[MCP:${key}] Failed to start client: ${message}`)
      return null
    }
  }

  private async getToolNames(clientKey: string, client: StdioMcpClient): Promise<string[]> {
    const cached = this.toolNamesByClient.get(clientKey)
    if (cached) return cached

    try {
      const tools = await client.listTools()
      const names = tools
        .map((tool) => tool.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      this.toolNamesByClient.set(clientKey, names)
      return names
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[MCP:${clientKey}] Failed to list tools: ${message}`)
      return []
    }
  }

  private selectCandidateToolNames(available: string[], preferred: string[]): string[] {
    const availableByLower = new Map<string, string>()
    for (const name of available) {
      availableByLower.set(name.toLowerCase(), name)
    }

    const selected: string[] = []
    for (const desired of preferred) {
      const exact = availableByLower.get(desired.toLowerCase())
      if (exact && !selected.includes(exact)) {
        selected.push(exact)
      }
    }

    if (selected.length > 0) {
      return selected
    }

    const normalizedPreferred = preferred.map((name) => normalizeToolName(name))
    const normalizedAvailable = available.map((name) => ({
      raw: name,
      normalized: normalizeToolName(name),
    }))

    for (const desired of normalizedPreferred) {
      for (const candidate of normalizedAvailable) {
        if (
          candidate.normalized === desired ||
          candidate.normalized.includes(desired) ||
          desired.includes(candidate.normalized)
        ) {
          if (!selected.includes(candidate.raw)) {
            selected.push(candidate.raw)
          }
        }
      }
    }

    if (selected.length > 0) return selected

    const preferredTokenSet = toLowerSet(preferred.flatMap((name) => name.split(/[^a-zA-Z0-9]+/g)))
    for (const name of available) {
      const lowerName = name.toLowerCase()
      for (const token of preferredTokenSet) {
        if (token.length < 3) continue
        if (lowerName.includes(token) && !selected.includes(name)) {
          selected.push(name)
          break
        }
      }
    }

    return selected
  }

  private buildClientSpec(kind: McpServiceKind, workspaceRoot: string): McpClientSpec {
    const resolvedRoot = path.resolve(workspaceRoot)
    const toolConfig = TOOL_PACKAGE_MAP[kind]
    const resolvedBin = resolveNodeBin(toolConfig.binary)
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MCP_WORKSPACE_ROOT: resolvedRoot,
    }

    const args: string[] = []
    if (kind === 'filesystem') {
      args.push(resolvedRoot)
    } else if (kind === 'playwright') {
      args.push('--headless', '--isolated')
    }

    if (kind === 'shell') {
      baseEnv.MCP_SHELL_DEFAULT_WORKDIR = resolvedRoot
      baseEnv.MCP_ALLOWED_WORKDIRS = `${resolvedRoot},/tmp`
      baseEnv.MCP_SHELL_SECURITY_MODE = baseEnv.MCP_SHELL_SECURITY_MODE || 'restrictive'
    }

    if (kind === 'git') {
      baseEnv.GIT_BASE_DIR = resolvedRoot
    }

    if (kind === 'repo-search') {
      baseEnv.MCP_REPO_SEARCH_TEMP_DIR = baseEnv.MCP_REPO_SEARCH_TEMP_DIR || path.join(os.tmpdir(), 'cozea-mcp-repo-search')
      try {
        fs.mkdirSync(baseEnv.MCP_REPO_SEARCH_TEMP_DIR, { recursive: true })
      } catch {
        // ignore mkdir issues, server may still handle defaults.
      }
    }

    if (resolvedBin) {
      return {
        command: resolvedBin,
        args,
        cwd: resolvedRoot,
        env: baseEnv,
      }
    }

    return {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', toolConfig.packageName, ...args],
      cwd: resolvedRoot,
      env: baseEnv,
    }
  }
}

