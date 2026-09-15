import net from 'node:net'
import type { ComputerUseToolResult } from './ComputerUseRuntimeService'

// Upper bound for one daemon response. Window screenshots and capped AX trees
// are megabytes at most; anything larger indicates a corrupt or hostile peer.
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/**
 * Validates one native result envelope. This is the single content gate for
 * daemon responses: unknown item types and non-image MIME types fail closed,
 * while a missing image MIME type defaults to PNG per MCP content conventions.
 */
export function parseToolResult(raw: string): ComputerUseToolResult {
  try {
    return parseToolResultObject(JSON.parse(raw) as unknown)
  } catch {
    return failure('Computer Use returned invalid JSON.')
  }
}

export function parseToolResultObject(value: unknown): ComputerUseToolResult {
  if (!value || typeof value !== 'object') return failure('Invalid native result envelope.')
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.content) || typeof record.isError !== 'boolean') {
    return failure('Invalid native result envelope.')
  }
  const content: ComputerUseToolResult['content'] = []
  for (const item of record.content) {
    if (!item || typeof item !== 'object') return failure('Invalid native result content.')
    const entry = item as Record<string, unknown>
    if (entry.type === 'text' && typeof entry.text === 'string') {
      content.push({ type: 'text', text: entry.text })
    } else if (entry.type === 'image' && typeof entry.data === 'string') {
      const mimeType = entry.mimeType ?? 'image/png'
      if (typeof mimeType !== 'string' || !mimeType.startsWith('image/')) {
        return failure('Invalid native result content.')
      }
      content.push({ type: 'image', data: entry.data, mimeType })
    } else return failure('Invalid native result content.')
  }
  return content.length ? { content, isError: record.isError } : failure('Native runtime returned no content.')
}

function failure(message: string): ComputerUseToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

export interface CuaAppItem {
  pid: number
  name: string
  bundle_id?: string
  running: boolean
}

export interface CuaWindowItem {
  pid: number
  window_id: number
  app_name: string
  title: string
  is_on_screen: boolean
  z_index?: number
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface CuaContentItem {
  type: 'text' | 'image'
  text?: string
  data?: string
  mimeType?: string
}

export interface CuaCallResponse {
  ok: boolean
  error?: string
  result?: {
    content?: CuaContentItem[]
    isError?: boolean
    structuredContent?: Record<string, unknown>
  }
}

export class CuaSocketClient {
  /**
   * Executes a single request/response cycle over the UNIX domain socket.
   */
  static async sendRequest<T>(
    socketPath: string,
    payload: Record<string, unknown>,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const { signal, timeoutMs = 35_000 } = options

    if (signal?.aborted) {
      throw new Error('CANCELLED: Request cancelled before dispatch.')
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false
      let client: net.Socket | null = null
      let timer: ReturnType<typeof setTimeout> | null = null
      let onAbort: (() => void) | null = null

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (signal && onAbort) signal.removeEventListener('abort', onAbort)
        onAbort = null
        if (client) {
          client.removeAllListeners()
          client.destroy()
          client = null
        }
      }

      const fail = (err: Error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(err)
      }

      const succeed = (val: T) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(val)
      }

      if (signal) {
        onAbort = () => {
          fail(new Error('DELIVERY_UNKNOWN: Request cancelled. Observe before retrying an action.'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      timer = setTimeout(() => {
        fail(new Error('Host Computer Use request timed out.'))
      }, timeoutMs)

      try {
        client = net.createConnection(socketPath)
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
        return
      }

      let buffer = ''
      let receivedBytes = 0

      client.on('connect', () => {
        const wireMessage = JSON.stringify(payload) + '\n'
        client?.write(wireMessage)
      })

      client.on('data', (chunk) => {
        receivedBytes += chunk.length
        if (receivedBytes > MAX_RESPONSE_BYTES) {
          fail(new Error('Cua Driver response exceeded the size budget.'))
          return
        }
        buffer += chunk.toString('utf8')
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const parsed = JSON.parse(line) as T
            succeed(parsed)
            return
          } catch {
            fail(new Error(`Failed to parse daemon response JSON: ${line}`))
            return
          }
        }
      })

      client.on('error', (err) => {
        fail(new Error(`Cua Driver socket error: ${err.message}`))
      })

      client.on('close', () => {
        if (!settled) {
          fail(new Error('Cua Driver daemon closed the connection unexpectedly.'))
        }
      })
    })
  }

  static async getMetadata(socketPath: string): Promise<Record<string, unknown>> {
    const res = await this.sendRequest<{ ok: boolean; result?: Record<string, unknown>; error?: string }>(
      socketPath,
      { method: 'metadata' },
      { timeoutMs: 5000 },
    )
    if (!res.ok) throw new Error(res.error ?? 'Failed to query daemon metadata')
    return res.result ?? {}
  }

  static async listApps(socketPath: string): Promise<CuaAppItem[]> {
    // Send list_apps call
    const res = await this.sendRequest<CuaCallResponse>(
      socketPath,
      {
        method: 'call',
        name: 'list_apps',
        args: {},
        session_id: 'cz-system',
        observation_origin: 'direct',
        client_kind: 'typescript_sdk',
      },
      { timeoutMs: 10_000 },
    )

    if (!res.ok || res.result?.isError) {
      throw new Error(res.error ?? 'list_apps failed')
    }

    // structuredContent in list_apps contains parsed apps array
    const structured = res.result?.structuredContent as { apps?: CuaAppItem[] } | undefined
    if (Array.isArray(structured?.apps)) {
      return structured.apps
    }

    // Parse fallback from text if structured not present
    const apps: CuaAppItem[] = []
    const text = res.result?.content?.[0]?.text ?? ''
    const lines = text.split('\n')
    for (const line of lines) {
      // Format: - AppName (pid 1234) [com.bundle.id]
      const match = line.match(/^-\s+(.+?)\s+\(pid\s+(\d+)\)(?:\s+\[(.*?)\])?/)
      if (match) {
        apps.push({
          name: match[1]!.trim(),
          pid: parseInt(match[2]!, 10),
          bundle_id: match[3]?.trim() || undefined,
          running: parseInt(match[2]!, 10) > 0,
        })
      }
    }
    return apps
  }

  static async listWindows(socketPath: string): Promise<CuaWindowItem[]> {
    const res = await this.sendRequest<CuaCallResponse>(
      socketPath,
      {
        method: 'call',
        name: 'list_windows',
        args: {},
        session_id: 'cz-system',
        observation_origin: 'direct',
        client_kind: 'typescript_sdk',
      },
      { timeoutMs: 10_000 },
    )

    if (!res.ok || res.result?.isError) {
      throw new Error(res.error ?? 'list_windows failed')
    }

    const structured = res.result?.structuredContent as { windows?: CuaWindowItem[] } | undefined
    if (Array.isArray(structured?.windows)) {
      return structured.windows
    }
    return []
  }

  static async callTool(
    socketPath: string,
    toolName: string,
    args: Record<string, unknown>,
    sessionId: string,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<ComputerUseToolResult> {
    const res = await this.sendRequest<CuaCallResponse>(
      socketPath,
      {
        method: 'call',
        name: toolName,
        args,
        session_id: sessionId,
        observation_origin: 'direct',
        client_kind: 'typescript_sdk',
      },
      options,
    )

    if (!res.ok) {
      return {
        content: [{ type: 'text', text: res.error ?? 'Cua Driver call rejected.' }],
        isError: true,
      }
    }

    const validated = parseToolResultObject({
      content: res.result?.content ?? [],
      isError: res.result?.isError === true,
    })
    if (validated.isError) return validated
    return {
      ...validated,
      structuredContent: res.result?.structuredContent as Record<string, unknown> | undefined,
    }
  }

  static async endSession(socketPath: string, sessionId: string): Promise<void> {
    try {
      await this.sendRequest<{ ok: boolean }>(
        socketPath,
        {
          method: 'session_end',
          session_id: sessionId,
          client_kind: 'typescript_sdk',
        },
        { timeoutMs: 3000 },
      )
    } catch {}
  }
}
