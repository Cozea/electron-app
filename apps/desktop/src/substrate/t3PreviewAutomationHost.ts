import { WS_METHODS } from "@cozea/contracts"
import type {
  PreviewAutomationActionEvent,
  PreviewAutomationOperation,
  PreviewAutomationRequest,
  PreviewAutomationResponse,
  PreviewAutomationStatus,
  PreviewAutomationStreamEvent,
} from "@cozea/contracts/t3"
import type { T3RpcSessionHandle } from "@cozea/client-runtime"

import {
  buildDevServerRunKey,
  ensureDevServerRun,
  useDevServerRunStore,
} from "@/features/projects/devserver/devServerRunStore"
import {
  ensureDevServerSurface,
  focusDevServerSurface,
  releaseDevServerSurfaceLease,
  renewDevServerSurfaceLease,
  type DevServerSurfaceHandle,
} from "@/features/projects/devserver/devServerSurfaceController"
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"

const SUPPORTED_OPERATIONS = [
  "devServerStatus",
  "devServerEnsure",
  "devServerAttach",
  "status",
  "open",
  "navigate",
  "snapshot",
  "click",
  "type",
  "press",
  "scroll",
  "waitFor",
] as const satisfies readonly PreviewAutomationOperation[]

const HOST_CLIENT_ID = "cozea-desktop-dev-server"

// A fresh module instance must re-register the long-lived stream during Vite
// HMR. React preserves the cutover hook across compatible refreshes, so a
// stable dependency list would otherwise leave the old module's listener
// attached while the broker continues routing requests to it.
export const T3_PREVIEW_AUTOMATION_HOST_REVISION = Date.now()

interface T3PreviewAutomationCandidate {
  session: T3RpcSessionHandle
  baseUrl: string
}

interface ThreadWorkbenchContext {
  projectId: string
  laneId: string
  workspaceId: string
  assistantTileId: string
}

interface ThreadSurfaceState {
  context: ThreadWorkbenchContext
  handle: DevServerSurfaceHandle
}

interface ActiveHostConnection {
  owner: symbol
  candidate: T3PreviewAutomationCandidate
  stop: () => Promise<void>
  removeFocusListeners: () => void
}

interface T3PreviewAutomationRuntime {
  candidates: Map<symbol, T3PreviewAutomationCandidate>
  active: ActiveHostConnection | null
  transition: Promise<void>
  generation: number
  surfacesByThread: Map<string, ThreadSurfaceState>
  actionTimelineByTile: Map<string, PreviewAutomationActionEvent[]>
  requestQueues: Map<string, Promise<void>>
}

const RUNTIME_KEY = Symbol.for("cozea.t3PreviewAutomationHost")
const runtimeHost = globalThis as { [RUNTIME_KEY]?: T3PreviewAutomationRuntime }
const runtime: T3PreviewAutomationRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  candidates: new Map(),
  active: null,
  transition: Promise.resolve(),
  generation: 0,
  surfacesByThread: new Map(),
  actionTimelineByTile: new Map(),
  requestQueues: new Map(),
})
// Preserve HMR-stable runtimes created before request serialization was added.
runtime.requestQueues ||= new Map()
// Promises created by the previous module instance cannot be resumed after a
// Vite replacement. Keeping those tails would permanently block every later
// request for that thread even though the replacement host stream is healthy.
runtime.requestQueues.clear()

class PreviewHostError extends Error {
  readonly tag: string
  readonly detail?: unknown

  constructor(
    tag: string,
    message: string,
    detail?: unknown,
  ) {
    super(message)
    this.tag = tag
    this.detail = detail
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function findThreadWorkbenchContext(threadId: string): ThreadWorkbenchContext | null {
  const matches: Array<ThreadWorkbenchContext & { createdAt: number }> = []
  for (const workbench of Object.values(useProjectWorkbenchStore.getState().workbenches)) {
    if (!workbench.workspaceId) continue
    for (const tileId of workbench.order) {
      const tile = workbench.tiles[tileId]
      if (tile?.type !== "assistantChat" || tile.threadId !== threadId) continue
      matches.push({
        projectId: workbench.projectId,
        laneId: workbench.laneId,
        workspaceId: workbench.workspaceId,
        assistantTileId: tile.id,
        createdAt: tile.createdAt,
      })
    }
  }
  const match = matches.sort((left, right) => right.createdAt - left.createdAt)[0]
  if (!match) return null
  const { createdAt: _createdAt, ...context } = match
  return context
}

function isSurfaceStillPresent(state: ThreadSurfaceState): boolean {
  return Object.values(useProjectWorkbenchStore.getState().workbenches).some((workbench) => {
    const tile = workbench.tiles[state.handle.tileId]
    return tile?.type === "devServer" && !tile.devAppId
  })
}

function isDevServerTilePresent(tileId: string): boolean {
  return Object.values(useProjectWorkbenchStore.getState().workbenches).some((workbench) => {
    const tile = workbench.tiles[tileId]
    return tile?.type === "devServer" && !tile.devAppId
  })
}

function hasDevServerSurface(context: ThreadWorkbenchContext): boolean {
  return Object.values(useProjectWorkbenchStore.getState().workbenches).some((workbench) =>
    workbench.workspaceId === context.workspaceId &&
    workbench.laneId === context.laneId &&
    workbench.order.some((tileId) => {
      const tile = workbench.tiles[tileId]
      return tile?.type === "devServer" && !tile.devAppId
    }),
  )
}

async function ensureThreadSurface(
  threadId: string,
  options: {
    preferredTileId?: string
    forceNew?: boolean
  } = {},
): Promise<ThreadSurfaceState> {
  const existing = runtime.surfacesByThread.get(threadId)
  if (
    existing &&
    isSurfaceStillPresent(existing) &&
    (!options.preferredTileId || options.preferredTileId === existing.handle.tileId) &&
    !options.forceNew &&
    renewDevServerSurfaceLease(existing.handle.tileId, existing.handle.leaseToken)
  ) {
    return existing
  }

  if (existing) {
    releaseDevServerSurfaceLease(existing.handle.tileId, existing.handle.leaseToken)
    runtime.surfacesByThread.delete(threadId)
  }

  const context = findThreadWorkbenchContext(threadId)
  if (!context) {
    throw new PreviewHostError(
      "PreviewAutomationUnavailableError",
      "No open agent tile is bound to this thread in the project workbench.",
    )
  }

  const handle = await ensureDevServerSurface({
    ...context,
    ownerId: `t3:${threadId}`,
    preferredTileId: options.preferredTileId,
    forceNew: options.forceNew,
    focus: false,
  })
  const state = { context, handle }
  runtime.surfacesByThread.set(threadId, state)
  return state
}

async function waitForBrowserTile(tileId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await window.electronAPI.workbenchBrowser.getState({ tileId })) return
    await new Promise((resolve) => window.setTimeout(resolve, 25))
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "The Dev Server preview surface did not initialize before the request timed out.",
  )
}

async function readStatus(tileId: string | null): Promise<PreviewAutomationStatus> {
  if (!tileId) {
    return {
      available: true,
      visible: false,
      tabId: null,
      url: null,
      title: null,
      loading: false,
    }
  }
  const state = await window.electronAPI.workbenchBrowser.getState({ tileId })
  if (!state && isDevServerTilePresent(tileId)) {
    return {
      available: true,
      visible: false,
      tabId: tileId,
      url: null,
      title: "Dev Server",
      loading: false,
    }
  }
  return {
    available: Boolean(state),
    visible: Boolean(state?.visible),
    tabId: state ? tileId : null,
    url: state?.url || null,
    title: state?.title || null,
    loading: Boolean(state?.isLoading),
  }
}

async function readDevServerStatus(
  context: ThreadWorkbenchContext,
  surface: ThreadSurfaceState | null,
  reusedProcess: boolean,
): Promise<{
  running: boolean
  ready: boolean
  port: number | null
  runId: string | null
  phase: 'bootstrapping' | 'launching' | 'running' | null
  headless: boolean
  reusedProcess: boolean
  surface: PreviewAutomationStatus
}> {
  const process = await window.electronAPI.devServer.getState({
    workspaceId: context.workspaceId,
    laneId: context.laneId,
  })
  const surfaceStatus = await readStatus(surface?.handle.tileId ?? null)
  return {
    running: process.running,
    ready: process.ready,
    port: process.port,
    runId: process.runId,
    phase: process.phase,
    headless: process.running && !hasDevServerSurface(context),
    reusedProcess,
    surface: surfaceStatus,
  }
}

async function waitForDevServerLaunchContext(
  context: ThreadWorkbenchContext,
  timeoutMs: number,
): Promise<string> {
  const runKey = buildDevServerRunKey(context.workspaceId, context.laneId)
  const deadline = Date.now() + Math.min(timeoutMs, 5_000)
  while (Date.now() <= deadline) {
    const terminalId = useDevServerRunStore.getState().contexts[runKey]?.terminalId
    if (terminalId) {
      const terminalIds = await window.electronAPI.terminal.list({ workspaceId: context.workspaceId })
      if (terminalIds.includes(terminalId)) return runKey
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25))
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "The Dev Server launch terminal did not initialize before the request timed out.",
  )
}

async function waitForDevServerReady(
  context: ThreadWorkbenchContext,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const state = await window.electronAPI.devServer.getState({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    })
    if (state.running && state.ready && state.port) return
    if (!state.running) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "Dev Server stopped before it became ready.",
      )
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "Dev Server did not become ready before the request timed out.",
  )
}

function normalizeNavigationUrl(input: Record<string, unknown>): string {
  const target = asRecord(input.target)
  let value = typeof input.url === "string" ? input.url.trim() : ""
  if (target.kind === "environment-port" && typeof target.port === "number") {
    const protocol = target.protocol === "https" ? "https" : "http"
    const path = typeof target.path === "string"
      ? target.path.startsWith("/") ? target.path : `/${target.path}`
      : ""
    value = `${protocol}://127.0.0.1:${target.port}${path}`
  }
  if (!value) {
    throw new PreviewHostError("PreviewAutomationExecutionError", "A preview URL is required.")
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    value = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value)
      ? `http://${value}`
      : `https://${value}`
  }
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PreviewHostError(
      "PreviewAutomationExecutionError",
      "Only HTTP and HTTPS preview URLs are supported.",
    )
  }
  return parsed.toString()
}

async function ensureBrowserTileForUrl(
  surface: ThreadSurfaceState,
  url: string,
  timeoutMs: number,
): Promise<void> {
  const { context, handle } = surface
  useProjectWorkbenchStore.getState().actions.updateRuntimePreviewTile(
    context.projectId,
    context.laneId,
    handle.tileId,
    { previewOverrideUrl: url },
    context.workspaceId,
  )
  await waitForBrowserTile(handle.tileId, Math.min(timeoutMs, 5_000))
}

async function waitForNavigation(tileId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    const state = await window.electronAPI.workbenchBrowser.getState({ tileId })
    if (state && !state.isLoading) return
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "Preview navigation did not finish before the request timed out.",
  )
}

function appendAction(
  tileId: string,
  request: PreviewAutomationRequest,
  status: PreviewAutomationActionEvent["status"],
  startedAt: string,
  error?: string,
): void {
  const current = runtime.actionTimelineByTile.get(tileId) ?? []
  const event: PreviewAutomationActionEvent = {
    id: request.requestId,
    action: request.operation,
    status,
    startedAt,
    ...(status === "running" ? {} : { completedAt: new Date().toISOString() }),
    ...(error ? { error } : {}),
  }
  const withoutPrevious = current.filter((item) => item.id !== request.requestId)
  runtime.actionTimelineByTile.set(tileId, [...withoutPrevious, event].slice(-24))
}

function throwForActionResult(result: {
  ok: boolean
  error?: string
  message?: string
}): void {
  if (result.ok) return
  const message = result.message ?? "Preview action failed."
  switch (result.error) {
    case "invalid_selector":
      throw new PreviewHostError("PreviewAutomationInvalidSelectorError", message)
    case "not_editable":
      throw new PreviewHostError("PreviewAutomationTargetNotEditableError", message)
    case "timeout":
      throw new PreviewHostError("PreviewAutomationTimeoutError", message)
    default:
      throw new PreviewHostError("PreviewAutomationExecutionError", message)
  }
}

async function runRequest(request: PreviewAutomationRequest): Promise<unknown> {
  const input = asRecord(request.input)
  const current = runtime.surfacesByThread.get(request.threadId)

  if (request.operation === "devServerStatus") {
    const context = findThreadWorkbenchContext(request.threadId)
    if (!context) {
      throw new PreviewHostError(
        "PreviewAutomationUnavailableError",
        "No open agent tile is bound to this thread in the project workbench.",
      )
    }
    return await readDevServerStatus(context, current ?? null, false)
  }

  if (request.operation === "devServerAttach" || request.operation === "devServerEnsure") {
    const surface = await ensureThreadSurface(request.threadId, {
      preferredTileId: request.tabId ? String(request.tabId) : undefined,
      // Ensure is process-idempotent and must never multiply surfaces as a
      // recovery strategy. The controller will still create a new surface
      // when every existing one has an active lease from another thread.
      forceNew: request.operation === "devServerAttach" && input.reuseExistingSurface === false,
    })
    const { context, handle } = surface

    if (!handle.created && input.open === true) {
      focusDevServerSurface(handle.scopeKey, handle.tileId)
    }

    const before = await window.electronAPI.devServer.getState({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    })
    if (request.operation === "devServerEnsure") {
      const runKey = await waitForDevServerLaunchContext(context, request.timeoutMs)
      await ensureDevServerRun(runKey, {
        ...(typeof input.command === "string" ? { command: input.command } : {}),
        ...(typeof input.port === "number" ? { port: input.port } : {}),
      })
      const rendererRun = useDevServerRunStore.getState().runs[runKey]
      if (rendererRun?.status === "error") {
        throw new PreviewHostError(
          "PreviewAutomationExecutionError",
          rendererRun.error ?? "Dev Server failed to start.",
        )
      }
      await waitForDevServerReady(context, request.timeoutMs)
      await waitForBrowserTile(handle.tileId, Math.min(request.timeoutMs, 5_000))
    } else if (before.running && before.ready) {
      await waitForBrowserTile(handle.tileId, Math.min(request.timeoutMs, 5_000))
    }
    return await readDevServerStatus(context, surface, before.running)
  }

  if (request.operation === "status") {
    return await readStatus(current?.handle.tileId ?? null)
  }

  const preferredTileId = request.tabId ? String(request.tabId) : undefined
  const surface = await ensureThreadSurface(request.threadId, {
    preferredTileId,
    forceNew: request.operation === "open" && input.reuseExistingTab === false,
  })
  const { tileId, leaseToken, scopeKey, created } = surface.handle

  if (!renewDevServerSurfaceLease(tileId, leaseToken)) {
    throw new PreviewHostError(
      "PreviewAutomationControlInterruptedError",
      "The user took control of this Dev Server surface.",
    )
  }

  const startedAt = new Date().toISOString()
  appendAction(tileId, request, "running", startedAt)
  try {
    let result: unknown
    switch (request.operation) {
      case "open": {
        if (typeof input.url === "string" && input.url.trim()) {
          const url = normalizeNavigationUrl(input)
          await ensureBrowserTileForUrl(surface, url, request.timeoutMs)
          await window.electronAPI.workbenchBrowser.navigate({ tileId, url })
          await waitForNavigation(tileId, request.timeoutMs)
        }
        // New agent surfaces deliberately remain inactive. An explicit open
        // may reveal an existing surface without rearranging it.
        if (!created && (input.open === true || input.show === true)) {
          focusDevServerSurface(scopeKey, tileId)
        }
        result = await readStatus(tileId)
        break
      }
      case "navigate": {
        const url = normalizeNavigationUrl(input)
        if (!await window.electronAPI.workbenchBrowser.getState({ tileId })) {
          await ensureBrowserTileForUrl(surface, url, request.timeoutMs)
        }
        const state = await window.electronAPI.workbenchBrowser.navigate({ tileId, url })
        if (!state) {
          throw new PreviewHostError("PreviewAutomationTabNotFoundError", "Dev Server preview is not open.")
        }
        if (input.readiness !== "none") {
          await waitForNavigation(tileId, request.timeoutMs)
        }
        result = await readStatus(tileId)
        break
      }
      case "snapshot": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const snapshot = await window.electronAPI.workbenchBrowser.devServerPreviewSnapshot({ tileId })
        if (!snapshot) {
          throw new PreviewHostError("PreviewAutomationTabNotFoundError", "Dev Server preview is not open.")
        }
        result = {
          ...snapshot,
          consoleEntries: [],
          networkEntries: [],
          actionTimeline: runtime.actionTimelineByTile.get(tileId) ?? [],
        }
        break
      }
      case "click": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const action = await window.electronAPI.workbenchBrowser.devServerPreviewClick({
          tileId,
          ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
          ...(typeof input.locator === "string" ? { locator: input.locator } : {}),
          ...(typeof input.x === "number" ? { x: input.x } : {}),
          ...(typeof input.y === "number" ? { y: input.y } : {}),
        })
        throwForActionResult(action)
        result = {}
        break
      }
      case "type": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const action = await window.electronAPI.workbenchBrowser.devServerPreviewType({
          tileId,
          text: typeof input.text === "string" ? input.text : "",
          clear: input.clear === true,
          ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
          ...(typeof input.locator === "string" ? { locator: input.locator } : {}),
        })
        throwForActionResult(action)
        result = {}
        break
      }
      case "press": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const modifiers = Array.isArray(input.modifiers)
          ? input.modifiers.filter((modifier): modifier is "Alt" | "Control" | "Meta" | "Shift" =>
              modifier === "Alt" || modifier === "Control" || modifier === "Meta" || modifier === "Shift")
          : undefined
        const action = await window.electronAPI.workbenchBrowser.devServerPreviewPress({
          tileId,
          key: typeof input.key === "string" ? input.key : "",
          modifiers,
        })
        throwForActionResult(action)
        result = {}
        break
      }
      case "scroll": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const action = await window.electronAPI.workbenchBrowser.devServerPreviewScroll({
          tileId,
          ...(typeof input.deltaX === "number" ? { deltaX: input.deltaX } : {}),
          ...(typeof input.deltaY === "number" ? { deltaY: input.deltaY } : {}),
          ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
          ...(typeof input.locator === "string" ? { locator: input.locator } : {}),
        })
        throwForActionResult(action)
        result = {}
        break
      }
      case "waitFor": {
        await waitForBrowserTile(tileId, Math.min(request.timeoutMs, 5_000))
        const action = await window.electronAPI.workbenchBrowser.devServerPreviewWaitFor({
          tileId,
          timeoutMs: request.timeoutMs,
          ...(typeof input.selector === "string" ? { selector: input.selector } : {}),
          ...(typeof input.locator === "string" ? { locator: input.locator } : {}),
          ...(typeof input.text === "string" ? { text: input.text } : {}),
          ...(typeof input.urlIncludes === "string" ? { urlIncludes: input.urlIncludes } : {}),
        })
        throwForActionResult(action)
        result = {}
        break
      }
      default:
        throw new PreviewHostError(
          "PreviewAutomationUnsupportedClientError",
          `This Cozea Dev Server host does not support ${request.operation}.`,
        )
    }

    if (!renewDevServerSurfaceLease(tileId, leaseToken)) {
      throw new PreviewHostError(
        "PreviewAutomationControlInterruptedError",
        "The user took control of this Dev Server surface.",
      )
    }
    appendAction(tileId, request, "succeeded", startedAt)
    return result
  } catch (error) {
    appendAction(
      tileId,
      request,
      error instanceof PreviewHostError && error.tag === "PreviewAutomationControlInterruptedError"
        ? "interrupted"
        : "failed",
      startedAt,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }
}

async function serializeThreadRequest<T>(
  threadId: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = runtime.requestQueues.get(threadId) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => {}).then(() => gate)
  runtime.requestQueues.set(threadId, tail)
  await previous.catch(() => {})
  try {
    return await task()
  } finally {
    release()
    if (runtime.requestQueues.get(threadId) === tail) {
      runtime.requestQueues.delete(threadId)
    }
  }
}

function toResponseError(error: unknown): NonNullable<PreviewAutomationResponse["error"]> {
  if (error instanceof PreviewHostError) {
    return {
      _tag: error.tag,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    }
  }
  return {
    _tag: "PreviewAutomationExecutionError",
    message: error instanceof Error ? error.message : String(error),
  }
}

async function respondToRequest(
  session: T3RpcSessionHandle,
  connectionId: string,
  request: PreviewAutomationRequest,
): Promise<void> {
  let response: PreviewAutomationResponse
  try {
    const result = await serializeThreadRequest(request.threadId, () => runRequest(request))
    response = {
      clientId: HOST_CLIENT_ID,
      connectionId,
      requestId: request.requestId,
      ok: true,
      result,
    }
  } catch (error) {
    response = {
      clientId: HOST_CLIENT_ID,
      connectionId,
      requestId: request.requestId,
      ok: false,
      error: toResponseError(error),
    }
  }
  await session.client.callUnary(WS_METHODS.previewAutomationRespond, response)
}

async function startCandidate(
  owner: symbol,
  candidate: T3PreviewAutomationCandidate,
  generation: number,
): Promise<ActiveHostConnection | null> {
  const response = await fetch(new URL("/.well-known/t3/environment", candidate.baseUrl))
  if (!response.ok) {
    throw new Error(`T3 environment descriptor unavailable (${response.status}).`)
  }
  const descriptor = await response.json() as { environmentId?: string }
  if (!descriptor.environmentId) {
    throw new Error("T3 environment descriptor did not include environmentId.")
  }
  if (generation !== runtime.generation || !runtime.candidates.has(owner)) return null

  let connectionId: string | null = null
  const updateFocus = () => {
    if (!connectionId) return
    void candidate.session.client.callUnary(WS_METHODS.previewAutomationFocusHost, {
      clientId: HOST_CLIENT_ID,
      environmentId: descriptor.environmentId,
      connectionId,
      focused: document.hasFocus(),
    }).catch(() => {})
  }
  const onFocus = () => updateFocus()
  const onBlur = () => updateFocus()
  window.addEventListener("focus", onFocus)
  window.addEventListener("blur", onBlur)

  let stopping = false
  const stopStream = await candidate.session.client.openStream(
    WS_METHODS.previewAutomationConnect,
    {
      clientId: HOST_CLIENT_ID,
      environmentId: descriptor.environmentId,
      supportedOperations: [...SUPPORTED_OPERATIONS],
    },
    (value) => {
      const event = value as PreviewAutomationStreamEvent
      if (event.type === "connected") {
        connectionId = event.connectionId
        updateFocus()
        return
      }
      if (event.type === "request") {
        void respondToRequest(candidate.session, event.connectionId, event.request).catch((error) => {
          console.warn("[T3PreviewAutomation] Failed to respond to preview request", error)
        })
      }
    },
    () => {
      if (
        stopping ||
        generation !== runtime.generation ||
        runtime.candidates.get(owner) !== candidate
      ) {
        return
      }
      window.setTimeout(() => {
        if (
          stopping ||
          generation !== runtime.generation ||
          runtime.candidates.get(owner) !== candidate ||
          runtime.active?.owner !== owner ||
          runtime.active.candidate !== candidate
        ) {
          return
        }
        runtime.active.removeFocusListeners()
        runtime.active = null
        scheduleReconcile()
      }, 0)
    },
  )

  return {
    owner,
    candidate,
    stop: async () => {
      stopping = true
      await stopStream()
    },
    removeFocusListeners: () => {
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("blur", onBlur)
    },
  }
}

function scheduleReconcile(): void {
  runtime.transition = runtime.transition.then(async () => {
    const activeOwner = runtime.active?.owner
    if (
      activeOwner &&
      runtime.candidates.get(activeOwner) === runtime.active?.candidate
    ) {
      return
    }

    if (runtime.active) {
      runtime.active.removeFocusListeners()
      await runtime.active.stop().catch(() => {})
      runtime.active = null
    }

    const next = runtime.candidates.entries().next().value as
      | [symbol, T3PreviewAutomationCandidate]
      | undefined
    if (!next) return
    const [owner, candidate] = next
    const generation = ++runtime.generation
    try {
      runtime.active = await startCandidate(owner, candidate, generation)
    } catch (error) {
      console.warn("[T3PreviewAutomation] Failed to connect preview host", error)
    }
  })
}

export function registerT3PreviewAutomationHost(
  owner: symbol,
  candidate: T3PreviewAutomationCandidate,
): () => void {
  runtime.candidates.set(owner, candidate)
  scheduleReconcile()
  return () => {
    if (runtime.candidates.get(owner) === candidate) {
      runtime.candidates.delete(owner)
    }
    if (runtime.active?.owner === owner) {
      runtime.generation += 1
    }
    scheduleReconcile()
  }
}
