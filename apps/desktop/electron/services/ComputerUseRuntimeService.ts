import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { execFileSync } from 'node:child_process'

import { readComputerUseAppSettings, type ComputerUseAppSettings } from './computerUseSettings'
import type { ComputerUseDiagnostics } from '@shared/electronApiTypes'
import { EmbeddedCuaDaemon } from './EmbeddedCuaDaemon'
import { CuaSocketClient, parseToolResult, type CuaContentItem } from './CuaSocketClient'
import {
  isApplicationExcluded,
  filterVisibleApplications,
  resolveApplication,
  EXCLUDED_APP_ERROR,
} from './ApplicationExclusions'

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
const MAX_REQUEST_BYTES = 2 * 1024 * 1024
const CALL_TIMEOUT_MS = 35_000
const RUNTIME_VERSION = '0.28.1'
const UNSUPPORTED = 'Computer Use is currently available on macOS only.'

export type ComputerUseThreadPolicy = 'inherit' | 'allow' | 'deny'
type ExplicitComputerUseThreadPolicy = Exclude<ComputerUseThreadPolicy, 'inherit'>
interface ScheduledThreadPolicyEntry {
  policy: ExplicitComputerUseThreadPolicy
  scheduledTaskId: string
}

export interface ComputerUseToolResult {
  content: CuaContentItem[]
  isError: boolean
  structuredContent?: Record<string, unknown>
}

export interface ComputerUseRuntimeEnvironment {
  endpoint: string
  token: string
}

interface CallOptions {
  requestId?: string
  signal?: AbortSignal
}

interface SnapshotCacheEntry {
  snapshotId: string
  elementTokens: Map<number, string>
  pid: number
  windowId: number
  timestamp: number
}

export interface ComputerUseRuntimeDependencies {
  platform?: NodeJS.Platform
  settings?: () => ComputerUseAppSettings
  daemon?: () => EmbeddedCuaDaemon | null
  timeoutMs?: number
}

function failure(message: string): ComputerUseToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function successAck(): ComputerUseToolResult {
  return { content: [{ type: 'text', text: '{"ok":true,"delivery":"dispatched"}' }], isError: false }
}

function safeTokenEquals(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function validateActionPolicy(
  settings: ComputerUseAppSettings,
  tool: string,
  args: unknown,
  threadPolicy: ComputerUseThreadPolicy = 'inherit',
): string | null {
  if (threadPolicy === 'deny') return 'Computer Use is not authorized for this scheduled task.'
  if (!settings.computerUseEnabled) return 'Computer Use is disabled in Cozea Settings.'
  if (!COMPUTER_USE_TOOLS.has(tool)) return `Unknown Computer Use tool: ${tool}`
  if ((settings.disabledComputerUseTools ?? []).includes(tool)) {
    return `Computer Use capability '${tool}' is disabled in Cozea Settings.`
  }
  if (
    tool === 'click' &&
    args &&
    typeof args === 'object' &&
    (args as { click_method?: unknown }).click_method === 'global' &&
    !settings.computerUseAllowGlobalPointerFallbacks
  ) {
    return 'Global physical-pointer fallback is disabled in Cozea Settings.'
  }
  return null
}

/**
 * Provider-facing element indexes arrive as integers or digit strings (see
 * tools.json). Anything else is rejected here instead of reaching the engine
 * as NaN.
 */
function parseElementIndex(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim())
  return null
}

/** Screenshot pixel coordinates are finite, non-negative numbers. */
function parseCoordinate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  return null
}

const SCROLL_DIRECTIONS = new Set(['up', 'down', 'left', 'right'])

/**
 * Secondary gestures the embedded engine implements. Anything else fails
 * here: the engine has no generic action parameter, so forwarding an unknown
 * action would silently degrade to a plain click.
 */
const SECONDARY_ACTION_TOOLS: Record<string, 'double_click' | 'right_click' | 'move_cursor'> = {
  double_click: 'double_click',
  right_click: 'right_click',
  context_menu: 'right_click',
  show_menu: 'right_click',
  hover: 'move_cursor',
}

export class ComputerUseRuntimeService {
  private static instance: ComputerUseRuntimeService | null = null

  static getInstance(): ComputerUseRuntimeService {
    if (!this.instance) this.instance = new ComputerUseRuntimeService()
    return this.instance
  }

  private readonly activeRuntimeSessions = new Set<string>()
  private readonly threadPolicies = new Map<string, ScheduledThreadPolicyEntry>()
  private readonly scheduledThreadByTask = new Map<string, string>()
  private readonly activeSnapshots = new Map<string, SnapshotCacheEntry>()
  private readonly endingSessions = new Map<string, Promise<void>>()
  private resetBarrier: Promise<void> = Promise.resolve()
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

  private getDaemon(): EmbeddedCuaDaemon | null {
    if (this.dependencies.daemon) return this.dependencies.daemon()
    return EmbeddedCuaDaemon.getInstance()
  }

  private invalidateSession(sessionId: string): void {
    this.clearSessionSnapshots(sessionId)
    const daemon = this.getDaemon()
    const socketPath = daemon?.getSocketPath()
    if (socketPath) {
      void CuaSocketClient.endSession(socketPath, sessionId)
    }
  }

  private clearSessionSnapshots(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const key of this.activeSnapshots.keys()) {
      if (key.startsWith(prefix)) {
        this.activeSnapshots.delete(key)
      }
    }
  }

  private resolveSnapshot(
    sessionId: string,
    pid: number,
    windowId: number | null,
    elementIndex?: number,
    callerSnapshotId?: string,
  ): { snapshotId?: string; elementToken?: string } {
    const keyWithWindow = windowId ? `${sessionId}:${pid}:${windowId}` : null
    const cached =
      (keyWithWindow ? this.activeSnapshots.get(keyWithWindow) : null) ??
      this.activeSnapshots.get(`${sessionId}:${pid}`)

    // A cached entry for the caller's own snapshot carries the engine-issued
    // token; prefer it over the reconstructed `${snapshotId}:${index}` form,
    // which is only a fallback for observations this process never cached
    // (e.g. after a restart that kept the provider thread alive).
    if (cached && (!callerSnapshotId || cached.snapshotId === callerSnapshotId)) {
      const token =
        elementIndex !== undefined
          ? (cached.elementTokens.get(elementIndex) ?? `${cached.snapshotId}:${elementIndex}`)
          : undefined
      return { snapshotId: cached.snapshotId, elementToken: token }
    }
    if (callerSnapshotId) {
      const token = elementIndex !== undefined ? `${callerSnapshotId}:${elementIndex}` : undefined
      return { snapshotId: callerSnapshotId, elementToken: token }
    }
    return {}
  }

  setScheduledThreadPolicy(taskId: string, sessionId: string, policy: ExplicitComputerUseThreadPolicy): void {
    const task = taskId.trim()
    const session = sessionId.trim()
    if (!task || !session) throw new Error('Scheduled Computer Use policy requires task and thread IDs.')
    const previous = this.scheduledThreadByTask.get(task)
    if (previous && previous !== session) this.clearThreadPolicy(previous)
    this.clearThreadPolicy(session)
    this.threadPolicies.set(session, { policy, scheduledTaskId: task })
    this.scheduledThreadByTask.set(task, session)
  }

  clearThreadPolicy(sessionId: string): void {
    const session = sessionId.trim()
    const entry = this.threadPolicies.get(session)
    this.invalidateSession(session)
    this.threadPolicies.delete(session)
    if (entry && this.scheduledThreadByTask.get(entry.scheduledTaskId) === session) {
      this.scheduledThreadByTask.delete(entry.scheduledTaskId)
    }
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

  private threadPolicy(session: string): ComputerUseThreadPolicy {
    return this.threadPolicies.get(session.trim())?.policy ?? 'inherit'
  }

  async callTool(
    sessionId: string,
    tool: string,
    args: unknown,
    options: CallOptions = {},
  ): Promise<ComputerUseToolResult> {
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
      if (denied) {
        this.invalidateSession(session)
        return failure(denied)
      }

      const rawArgs = args as Record<string, unknown>
      const targetAppQuery = typeof rawArgs.app === 'string' ? rawArgs.app.trim() : null

      // Strict security invariant: Password managers are excluded from Computer Use
      if (targetAppQuery && isApplicationExcluded(targetAppQuery)) {
        return failure(EXCLUDED_APP_ERROR)
      }

      // Embedded Cua Driver Execution Engine
      const daemon = this.getDaemon()
      if (!daemon || !daemon.isInstalled()) {
        return failure('Native Computer Use runtime is not prepared.')
      }

      const socketPath = await daemon.ensureDaemon()
      this.activeRuntimeSessions.add(session)

      return await this.dispatchCuaTool(socketPath, session, tool, rawArgs, options)
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'Native Computer Use failed.')
    }
  }

  private async dispatchCuaTool(
    socketPath: string,
    sessionId: string,
    tool: string,
    args: Record<string, unknown>,
    options: CallOptions,
  ): Promise<ComputerUseToolResult> {
    const timeoutMs = this.dependencies.timeoutMs ?? CALL_TIMEOUT_MS

    // 1. list_apps
    if (tool === 'list_apps') {
      const apps = await CuaSocketClient.listApps(socketPath)
      const visible = filterVisibleApplications(apps).filter((a) => a.running)
      const lines = [`Found ${visible.length} running application(s):`]
      for (const app of visible) {
        const bundle = app.bundle_id ? ` [${app.bundle_id}]` : ''
        lines.push(`- ${app.name} (pid ${app.pid})${bundle}`)
      }
      return { content: [{ type: 'text', text: lines.join('\n') }], isError: false }
    }

    // Resolve target application for tools that target an app
    const appQuery = typeof args.app === 'string' ? args.app.trim() : null
    let targetPid: number | null = null
    let targetWindowId: number | null = null

    if (appQuery) {
      const apps = await CuaSocketClient.listApps(socketPath)
      const resolution = resolveApplication(appQuery, apps)
      if ('error' in resolution) {
        return failure(resolution.error)
      }
      targetPid = resolution.app.pid

      // Find best eligible window for target app PID
      const windows = await CuaSocketClient.listWindows(socketPath)
      const appWindows = windows.filter((w) => w.pid === targetPid)
      const onScreen = appWindows.find((w) => w.is_on_screen && w.bounds.width > 20 && w.bounds.height > 20)
      const chosenWindow = onScreen ?? appWindows[0]
      if (chosenWindow) {
        targetWindowId = chosenWindow.window_id
      }
    }

    // Explicit window ID override if caller provided one
    if (typeof args.window_id === 'number') {
      targetWindowId = args.window_id
    }

    // 2. get_app_state
    if (tool === 'get_app_state') {
      if (!targetPid) return failure('Specify a running target application.')
      if (!targetWindowId) return failure('No eligible window found for the target application.')

      const result = await CuaSocketClient.callTool(
        socketPath,
        'get_window_state',
        {
          pid: targetPid,
          window_id: targetWindowId,
          session: sessionId,
          include_accessibility_tree: args.include_text !== false,
          include_screenshot: args.include_screenshot !== false,
          max_elements: typeof args.max_tree_nodes === 'number' ? args.max_tree_nodes : 1200,
          max_depth: typeof args.max_tree_depth === 'number' ? args.max_tree_depth : 64,
        },
        sessionId,
        { signal: options.signal, timeoutMs },
      )

      // Cache snapshot for subsequent element-indexed actions
      if (!result.isError && result.structuredContent) {
        const structured = result.structuredContent
        if (typeof structured.snapshot_id === 'string') {
          const snapshotId = structured.snapshot_id
          const elementTokens = new Map<number, string>()
          if (Array.isArray(structured.elements)) {
            for (const el of structured.elements) {
              const record = el as Record<string, unknown>
              if (typeof record?.element_index === 'number' && typeof record?.element_token === 'string') {
                elementTokens.set(record.element_index, record.element_token)
              }
            }
          }
          const entry: SnapshotCacheEntry = {
            snapshotId,
            elementTokens,
            pid: targetPid,
            windowId: targetWindowId,
            timestamp: Date.now(),
          }
          this.activeSnapshots.set(`${sessionId}:${targetPid}:${targetWindowId}`, entry)
          this.activeSnapshots.set(`${sessionId}:${targetPid}`, entry)
        }
      }

      return result
    }

    // 3. click
    if (tool === 'click') {
      if (!targetPid) return failure('Specify a running target application.')
      const clickArgs: Record<string, unknown> = {
        pid: targetPid,
        session: sessionId,
      }
      if (targetWindowId) clickArgs.window_id = targetWindowId

      const hasIndex = args.element_index !== undefined && args.element_index !== null
      const hasX = args.x !== undefined && args.x !== null
      const hasY = args.y !== undefined && args.y !== null
      if (hasIndex && (hasX || hasY)) {
        return failure('Specify either element_index or x and y, not both.')
      }
      if (hasIndex) {
        const idx = parseElementIndex(args.element_index)
        if (idx === null) return failure('element_index must be a non-negative integer.')
        clickArgs.element_index = idx
        const { snapshotId, elementToken } = this.resolveSnapshot(
          sessionId,
          targetPid,
          targetWindowId,
          idx,
          typeof args.snapshot_id === 'string' ? args.snapshot_id : undefined,
        )
        if (elementToken) clickArgs.element_token = elementToken
        if (snapshotId) clickArgs.snapshot_id = snapshotId
      } else if (hasX || hasY) {
        const x = parseCoordinate(args.x)
        const y = parseCoordinate(args.y)
        if (x === null || y === null) return failure('x and y must be non-negative numbers.')
        clickArgs.x = x
        clickArgs.y = y
      } else {
        return failure('Specify either element_index or both x and y.')
      }

      // Translate the provider-facing click options to the embedded Cua engine
      // dialect. Options the engine cannot honor fail here: a wrong click is
      // worse than an error. Defaults (left button, single click, background
      // delivery) are omitted so the default wire shape is unchanged.
      const mouseButton = args.mouse_button ?? args.button
      if (mouseButton !== undefined && mouseButton !== null) {
        if (mouseButton !== 'left' && mouseButton !== 'right' && mouseButton !== 'middle') {
          return failure(
            `Unsupported mouse_button: ${String(mouseButton)}. Use 'left', 'right', or 'middle'.`,
          )
        }
        if (mouseButton !== 'left') clickArgs.button = mouseButton
      }
      if (args.click_count !== undefined && args.click_count !== null) {
        const count = args.click_count
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 3) {
          return failure(`Unsupported click_count: ${String(count)}. Use an integer from 1 to 3.`)
        }
        if (count !== 1) clickArgs.count = count
      }
      if (typeof args.click_method === 'string' && args.click_method !== 'auto') {
        if (args.click_method === 'global') {
          clickArgs.delivery_mode = 'foreground'
        } else {
          return failure(
            `click_method '${args.click_method}' is not supported by the embedded Cua engine. ` +
              `Omit click_method or use 'auto'.`,
          )
        }
      }

      const res = await CuaSocketClient.callTool(socketPath, 'click', clickArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })
      if (res.isError) return res
      return successAck()
    }

    // 4. perform_secondary_action
    if (tool === 'perform_secondary_action') {
      if (!targetPid) return failure('Specify a running target application.')
      const action = String(args.action ?? '').toLowerCase().trim()
      const engineTool = SECONDARY_ACTION_TOOLS[action]
      if (!engineTool) {
        return failure(
          `Unsupported action: ${action || '(missing)'}. Use one of: ${Object.keys(SECONDARY_ACTION_TOOLS).join(', ')}.`,
        )
      }
      const actionArgs: Record<string, unknown> = {
        pid: targetPid,
        session: sessionId,
      }
      if (targetWindowId) actionArgs.window_id = targetWindowId

      if (args.element_index !== undefined && args.element_index !== null) {
        const elementIdx = parseElementIndex(args.element_index)
        if (elementIdx === null) return failure('element_index must be a non-negative integer.')
        actionArgs.element_index = elementIdx
        const { snapshotId, elementToken } = this.resolveSnapshot(
          sessionId,
          targetPid,
          targetWindowId,
          elementIdx,
          typeof args.snapshot_id === 'string' ? args.snapshot_id : undefined,
        )
        if (elementToken) actionArgs.element_token = elementToken
        if (snapshotId) actionArgs.snapshot_id = snapshotId
      } else if (args.x !== undefined || args.y !== undefined) {
        const x = parseCoordinate(args.x)
        const y = parseCoordinate(args.y)
        if (x === null || y === null) return failure('x and y must be non-negative numbers.')
        actionArgs.x = x
        actionArgs.y = y
      }

      const res = await CuaSocketClient.callTool(socketPath, engineTool, actionArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })

      if (res.isError) return res
      return successAck()
    }

    // 5. scroll
    if (tool === 'scroll') {
      if (!targetPid) return failure('Specify a running target application.')
      // The provider contract names the magnitude `pages`; the Cua engine
      // names it `amount`. `amount` stays accepted for direct callers. The
      // default is 1 page to match the contract: T3 passes arguments through
      // without filling schema defaults, so an omitted `pages` must behave
      // exactly like the documented default.
      const pages = args.pages ?? args.amount
      let amount = 1
      if (pages !== undefined && pages !== null) {
        if (typeof pages !== 'number' || !Number.isFinite(pages) || pages <= 0) {
          return failure(`Unsupported pages: ${String(pages)}. Use a positive number of pages.`)
        }
        amount = pages
      }
      const direction = args.direction ?? 'down'
      if (typeof direction !== 'string' || !SCROLL_DIRECTIONS.has(direction)) {
        return failure(`Unsupported direction: ${String(direction)}. Use one of: up, down, left, right.`)
      }
      const scrollArgs: Record<string, unknown> = {
        pid: targetPid,
        direction,
        amount,
        session: sessionId,
      }
      if (targetWindowId) scrollArgs.window_id = targetWindowId
      if (args.x !== undefined || args.y !== undefined) {
        const x = parseCoordinate(args.x)
        const y = parseCoordinate(args.y)
        if (x === null || y === null) return failure('x and y must be non-negative numbers.')
        scrollArgs.x = x
        scrollArgs.y = y
      }
      if (args.element_index !== undefined && args.element_index !== null) {
        const idx = parseElementIndex(args.element_index)
        if (idx === null) return failure('element_index must be a non-negative integer.')
        scrollArgs.element_index = idx
        const { snapshotId, elementToken } = this.resolveSnapshot(
          sessionId,
          targetPid,
          targetWindowId,
          idx,
          typeof args.snapshot_id === 'string' ? args.snapshot_id : undefined,
        )
        if (elementToken) scrollArgs.element_token = elementToken
        if (snapshotId) scrollArgs.snapshot_id = snapshotId
      }

      const res = await CuaSocketClient.callTool(socketPath, 'scroll', scrollArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })
      if (res.isError) return res
      return successAck()
    }

    // 6. drag
    if (tool === 'drag') {
      if (!targetPid) return failure('Specify a running target application.')
      const fromX = parseCoordinate(args.from_x)
      const fromY = parseCoordinate(args.from_y)
      const toX = parseCoordinate(args.to_x)
      const toY = parseCoordinate(args.to_y)
      if (fromX === null || fromY === null || toX === null || toY === null) {
        return failure('from_x, from_y, to_x, and to_y must be non-negative numbers.')
      }
      const dragArgs: Record<string, unknown> = {
        pid: targetPid,
        from_x: fromX,
        from_y: fromY,
        to_x: toX,
        to_y: toY,
        session: sessionId,
      }
      if (targetWindowId) dragArgs.window_id = targetWindowId

      const res = await CuaSocketClient.callTool(socketPath, 'drag', dragArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })
      if (res.isError) return res
      return successAck()
    }

    // 7. type_text
    if (tool === 'type_text') {
      if (!targetPid) return failure('Specify a running target application.')
      const typeArgs: Record<string, unknown> = {
        pid: targetPid,
        text: String(args.text ?? ''),
        session: sessionId,
      }
      if (targetWindowId) typeArgs.window_id = targetWindowId
      if (args.element_index !== undefined && args.element_index !== null) {
        const idx = parseElementIndex(args.element_index)
        if (idx === null) return failure('element_index must be a non-negative integer.')
        typeArgs.element_index = idx
        const { snapshotId, elementToken } = this.resolveSnapshot(
          sessionId,
          targetPid,
          targetWindowId,
          idx,
          typeof args.snapshot_id === 'string' ? args.snapshot_id : undefined,
        )
        if (elementToken) typeArgs.element_token = elementToken
        if (snapshotId) typeArgs.snapshot_id = snapshotId
      }

      const res = await CuaSocketClient.callTool(socketPath, 'type_text', typeArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })
      if (res.isError) return res
      return successAck()
    }

    // 8. press_key
    if (tool === 'press_key') {
      if (!targetPid) return failure('Specify a running target application.')
      const keyStr = String(args.key ?? '')
      const modifiers = Array.isArray(args.modifiers) ? (args.modifiers as string[]) : []

      // A bare '+' is a literal key, not a chord separator: only split
      // into a hotkey when modifiers are present or '+' separates at least
      // two key names. Anything else presses the key verbatim.
      const chordParts = keyStr
        .split('+')
        .map((part) => part.trim())
        .filter(Boolean)
      let res: ComputerUseToolResult
      if (modifiers.length > 0 || chordParts.length > 1) {
        const keys = modifiers.slice()
        for (const part of chordParts) {
          if (!keys.includes(part)) keys.push(part)
        }
        const hotkeyArgs: Record<string, unknown> = { keys, session: sessionId, pid: targetPid }
        if (targetWindowId) hotkeyArgs.window_id = targetWindowId
        res = await CuaSocketClient.callTool(
          socketPath,
          'hotkey',
          hotkeyArgs,
          sessionId,
          { signal: options.signal, timeoutMs },
        )
      } else {
        const pressArgs: Record<string, unknown> = { pid: targetPid, key: keyStr, session: sessionId }
        if (targetWindowId) pressArgs.window_id = targetWindowId
        res = await CuaSocketClient.callTool(
          socketPath,
          'press_key',
          pressArgs,
          sessionId,
          { signal: options.signal, timeoutMs },
        )
      }

      if (res.isError) return res
      return successAck()
    }

    // 9. set_value
    if (tool === 'set_value') {
      if (!targetPid) return failure('Specify a running target application.')
      const idx = parseElementIndex(args.element_index)
      if (idx === null) return failure('set_value requires element_index as a non-negative integer.')
      const setArgs: Record<string, unknown> = {
        pid: targetPid,
        element_index: idx,
        value: String(args.value ?? ''),
        session: sessionId,
      }
      if (targetWindowId) setArgs.window_id = targetWindowId

      const { snapshotId, elementToken } = this.resolveSnapshot(
        sessionId,
        targetPid,
        targetWindowId,
        idx,
        typeof args.snapshot_id === 'string' ? args.snapshot_id : undefined,
      )
      if (elementToken) setArgs.element_token = elementToken
      if (snapshotId) setArgs.snapshot_id = snapshotId

      const res = await CuaSocketClient.callTool(socketPath, 'set_value', setArgs, sessionId, {
        signal: options.signal,
        timeoutMs,
      })
      if (res.isError) return res
      return successAck()
    }

    return failure(`Unsupported tool: ${tool}`)
  }

  async getDiagnostics(): Promise<ComputerUseDiagnostics> {
    if (this.platform !== 'darwin') {
      return { supported: false, installed: false, accessibility: false, screenRecording: false, error: UNSUPPORTED }
    }

    try {
      const daemon = this.getDaemon()
      const binPath = daemon?.resolveExecutablePath()
      if (!binPath) {
        return {
          supported: true,
          installed: false,
          accessibility: false,
          screenRecording: false,
          error: 'Native Computer Use runtime is not prepared.',
        }
      }

      // 1. Query embedded daemon over socket
      try {
        if (daemon) {
          const socketPath = await daemon.ensureDaemon()
          const res = await CuaSocketClient.callTool(socketPath, 'check_permissions', { prompt: false }, 'diagnostics', { timeoutMs: 4000 })
          const struct = res.structuredContent as { accessibility?: boolean; screen_recording?: boolean } | undefined
          if (struct && typeof struct.accessibility === 'boolean') {
            return {
              supported: true,
              installed: true,
              accessibility: struct.accessibility === true,
              screenRecording: struct.screen_recording === true,
              version: RUNTIME_VERSION,
            }
          }
        }
      } catch {}

      // 2. Fallback: Query permissions status directly via cua-driver CLI
      try {
        const stdout = execFileSync(binPath, ['permissions', 'status', '--json'], {
          encoding: 'utf8',
          env: { ...process.env, CUA_TELEMETRY_DISABLED: '1' },
          timeout: 4000,
        })
        const parsed = JSON.parse(stdout) as {
          accessibility?: boolean
          screen_recording?: boolean
        }
        return {
          supported: true,
          installed: true,
          accessibility: parsed.accessibility === true,
          screenRecording: parsed.screen_recording === true,
          version: RUNTIME_VERSION,
        }
      } catch (err) {
        return {
          supported: true,
          installed: true,
          accessibility: false,
          screenRecording: false,
          version: RUNTIME_VERSION,
          error: err instanceof Error ? err.message : 'Failed to query permissions',
        }
      }
    } catch (error) {
      return {
        supported: true,
        installed: false,
        accessibility: false,
        screenRecording: false,
        error: error instanceof Error ? error.message : 'Native diagnostics failed.',
      }
    }
  }

  /**
   * Reports whether the embedded driver's TCC grant for `target` is already
   * in place. The CLI status command cannot see the embedded daemon's custom
   * socket (it reports `unknown`), so the authoritative answer comes from the
   * daemon itself over the supervised socket. Callers open System Settings
   * when this returns false; Cozea deliberately never invokes the driver's
   * `permissions grant` flow, which would launch a second, unsupervised
   * driver instance outside embedded supervision.
   */
  async requestPermission(target: 'accessibility' | 'screenRecording'): Promise<boolean> {
    if (this.platform !== 'darwin') return false

    const daemon = this.getDaemon()
    if (!daemon || !daemon.isInstalled()) return false

    try {
      const socketPath = await daemon.ensureDaemon()
      const res = await CuaSocketClient.callTool(socketPath, 'check_permissions', { prompt: false }, 'permissions', {
        timeoutMs: 4000,
      })
      if (res.isError) return false
      const struct = res.structuredContent as
        | { accessibility?: boolean; screen_recording?: boolean }
        | undefined
      if (!struct) return false
      return target === 'accessibility' ? struct.accessibility === true : struct.screen_recording === true
    } catch {
      return false
    }
  }

  async turnEnded(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    const hadActiveRuntime = this.activeRuntimeSessions.delete(normalizedSessionId)
    this.clearThreadPolicy(normalizedSessionId)
    this.clearSessionSnapshots(normalizedSessionId)
    if (!hadActiveRuntime) return
    await this.finishSession(normalizedSessionId)
  }

  async resetSession(sessionId: string): Promise<void> {
    const session = sessionId.trim()
    this.activeRuntimeSessions.delete(session)
    this.clearThreadPolicy(session)
    this.clearSessionSnapshots(session)
    await this.finishSession(session)
  }

  private finishSession(session: string): Promise<void> {
    const existing = this.endingSessions.get(session)
    if (existing) return existing

    const ending = (async () => {
      const daemon = this.getDaemon()
      const socketPath = daemon?.getSocketPath()
      if (socketPath) {
        await CuaSocketClient.endSession(socketPath, session)
      }
    })().finally(() => {
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
    this.activeSnapshots.clear()

    const previous = this.resetBarrier
    const next = previous.then(async () => {
      await Promise.all(this.endingSessions.values())
      const daemon = this.getDaemon()
      await daemon?.stop()
    })
    this.resetBarrier = next.catch(() => undefined)
    await next
  }

  async startBroker(): Promise<ComputerUseRuntimeEnvironment> {
    if (this.endpoint) return { endpoint: this.endpoint, token: this.token }
    if (this.starting) return this.starting
    this.starting = this.bindBroker()
    try {
      return await this.starting
    } finally {
      this.starting = null
    }
  }

  private async bindBroker(): Promise<ComputerUseRuntimeEnvironment> {
    const server = createServer((request, response) => void this.handleHttpRequest(request, response))
    server.requestTimeout = CALL_TIMEOUT_MS
    server.headersTimeout = 10_000
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Computer Use broker failed to bind.')
    this.endpoint = `http://127.0.0.1:${address.port}`
    return { endpoint: this.endpoint, token: this.token }
  }

  async stopBroker(): Promise<void> {
    if (this.starting) await this.starting
    await this.resetAll()
    this.threadPolicies.clear()
    this.scheduledThreadByTask.clear()
    const server = this.server
    this.server = null
    this.endpoint = null
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  }

  private async readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
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
    response.writeHead(status, {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    response.end(body)
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const credential = request.headers.authorization ?? ''
    if (!credential.startsWith('Bearer ') || !safeTokenEquals(credential.slice(7).trim(), this.token)) {
      this.writeJson(response, 401, failure('Invalid Computer Use broker credential.'))
      return
    }
    if (request.method !== 'POST' || !['/v1/call', '/v1/turn-ended'].includes(request.url ?? '')) {
      this.writeJson(response, 404, failure('Unknown Computer Use broker route.'))
      return
    }
    const abort = new AbortController()
    const onClose = () => {
      if (!response.writableEnded) abort.abort()
    }
    response.on('close', onClose)
    try {
      const input = await this.readBody(request)
      const threadId = typeof input.threadId === 'string' ? input.threadId.trim() : ''
      if (!threadId) {
        this.writeJson(response, 400, failure('A threadId is required.'))
        return
      }
      if (request.url === '/v1/turn-ended') {
        await this.turnEnded(threadId)
        this.writeJson(response, 200, { ok: true })
        return
      }
      if (typeof input.tool !== 'string' || !input.tool.trim()) {
        this.writeJson(response, 400, failure('A tool name is required.'))
        return
      }
      const result = await this.callTool(threadId, input.tool.trim(), input.arguments ?? {}, {
        requestId: typeof input.requestId === 'string' ? input.requestId : undefined,
        signal: abort.signal,
      })
      this.writeJson(response, 200, result)
    } catch {
      this.writeJson(response, 400, failure('Invalid Computer Use request.'))
    } finally {
      response.off('close', onClose)
    }
  }
}

export const __computerUseRuntimeTesting = {
  COMPUTER_USE_TOOLS,
  validateActionPolicy,
  parseToolResult,
  threadPolicy: (runtime: ComputerUseRuntimeService, sessionId: string) => runtime['threadPolicy'](sessionId),
}
