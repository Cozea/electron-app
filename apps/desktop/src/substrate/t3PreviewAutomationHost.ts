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

async function readStatus(tileId: string | null): Promise<PreviewAutomationStatus> {
  return {
    available: false,
    visible: false,
    tabId: tileId,
    url: null,
    title: tileId && isDevServerTilePresent(tileId) ? "Dev Server" : null,
    loading: false,
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
    headless: process.running,
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
    }
    return await readDevServerStatus(context, surface, before.running)
  }

  if (request.operation === "status") {
    return await readStatus(current?.handle.tileId ?? null)
  }

  throw new PreviewHostError(
    "PreviewAutomationUnavailableError",
    "The embedded browser is unavailable while the T3 browser is being ported.",
  )
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
