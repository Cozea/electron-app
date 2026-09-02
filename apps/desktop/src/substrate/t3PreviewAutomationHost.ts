import { WS_METHODS } from "@cozea/contracts";
import type {
  DevAppPreviewAutomationDiagnostic,
  DevAppPreviewAutomationStatus,
  DevAppToolCatalogStatus,
  DevAppToolInvocationResult,
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationNavigateInput,
  PreviewAutomationOperation,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  PreviewAutomationRequest,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationResponse,
  PreviewAutomationScrollInput,
  PreviewAutomationSetColorSchemeInput,
  PreviewAutomationSetColorSchemeResult,
  PreviewAutomationStatus,
  PreviewAutomationStreamEvent,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
  PreviewRenderedViewportSize,
  PreviewViewportSetting,
  ScopedThreadRef,
} from "@cozea/contracts/t3";
import type { T3RpcSessionHandle } from "@cozea/client-runtime";
import type { BrowserSurfaceInventoryEntry } from "@shared/browserSurfaceTypes";

import {
  readActiveBrowserRecordingTargets,
  startBrowserRecording,
  stopBrowserRecording,
} from "@/features/projects/browser/browserRecording";
import { useBrowserSurfaceStore } from "@/features/projects/browser/browserSurfaceStore";
import { normalizeUrlInput } from "@/features/projects/browser/urlInput";
import { commitBrowserViewportChange } from "@/features/projects/browser/browserViewportActions";
import { readBrowserViewport } from "@/features/projects/browser/browserViewportStore";
import { resolvePreviewViewport } from "@/features/projects/browser/previewViewport";
import { isPreviewViewportReady } from "@/features/projects/browser/previewViewportReadiness";
import { shouldRollbackPreviewViewport } from "@/features/projects/browser/previewViewportRollback";
import {
  buildDevServerRunKey,
  ensureDevServerRun,
  useDevServerRunStore,
} from "@/features/projects/devserver/devServerRunStore";
import {
  ensureDevServerSurface,
  focusDevServerSurface,
  releaseDevServerSurfaceLease,
  renewDevServerSurfaceLease,
  type DevServerSurfaceHandle,
} from "@/features/projects/devserver/devServerSurfaceController";
import {
  ensureDevAppPreviewSurface,
  focusDevAppPreviewSurface,
  normalizeDevAppPreviewRelativePath,
} from "@/features/projects/devapps/devAppPreviewSurfaceController";
import {
  readDevAppPreviewRuntime,
  type DevAppPreviewRuntimeSnapshot,
} from "@/features/projects/devapps/devAppPreviewRuntimeStore";
import {
  useProjectWorkbenchStore,
  type WorkbenchDevAppPreviewTile,
  type WorkbenchOrgDevAppTile,
} from "@/stores/useProjectWorkbenchStore";

const SUPPORTED_OPERATIONS = [
  "status",
  "open",
  "navigate",
  "snapshot",
  "click",
  "type",
  "press",
  "scroll",
  "evaluate",
  "waitFor",
  "recordingStart",
  "recordingStop",
  "resize",
  "setColorScheme",
  "devServerStatus",
  "devServerEnsure",
  "devServerAttach",
  "devAppPreviewEnsure",
  "devAppPreviewAttach",
  "devAppToolCatalog",
  "devAppToolInvoke",
] as const satisfies readonly PreviewAutomationOperation[];

const HOST_CLIENT_ID = "cozea-desktop-dev-server";

// A fresh module instance must re-register the long-lived stream during Vite
// HMR. React preserves the cutover hook across compatible refreshes, so a
// stable dependency list would otherwise leave the old module's listener
// attached while the broker continues routing requests to it.
export const T3_PREVIEW_AUTOMATION_HOST_REVISION = Date.now();

interface T3PreviewAutomationCandidate {
  session: T3RpcSessionHandle;
  baseUrl: string;
}

interface ThreadWorkbenchContext {
  projectId: string;
  laneId: string;
  workspaceId: string;
  assistantTileId: string;
  activeTileId: string | null;
  tileIds: ReadonlySet<string>;
}

interface ThreadSurfaceState {
  context: ThreadWorkbenchContext;
  handle: DevServerSurfaceHandle;
}

interface ActiveHostConnection {
  owner: symbol;
  candidate: T3PreviewAutomationCandidate;
  environmentId: string;
  stop: () => Promise<void>;
  removeFocusListeners: () => void;
}

interface T3PreviewAutomationRuntime {
  candidates: Map<symbol, T3PreviewAutomationCandidate>;
  active: ActiveHostConnection | null;
  transition: Promise<void>;
  generation: number;
  surfacesByThread: Map<string, ThreadSurfaceState>;
  lastControlledSurfaceByThread: Map<string, string>;
  requestQueues: Map<string, Promise<void>>;
}

const RUNTIME_KEY = Symbol.for("cozea.t3PreviewAutomationHost");
const runtimeHost = globalThis as { [RUNTIME_KEY]?: T3PreviewAutomationRuntime };
const runtime: T3PreviewAutomationRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  candidates: new Map(),
  active: null,
  transition: Promise.resolve(),
  generation: 0,
  surfacesByThread: new Map(),
  lastControlledSurfaceByThread: new Map(),
  requestQueues: new Map(),
});
// Preserve HMR-stable runtimes created before request serialization was added.
runtime.requestQueues ||= new Map();
runtime.lastControlledSurfaceByThread ||= new Map();
// Promises created by the previous module instance cannot be resumed after a
// Vite replacement. Keeping those tails would permanently block every later
// request for that thread even though the replacement host stream is healthy.
runtime.requestQueues.clear();

class PreviewHostError extends Error {
  readonly tag: string;
  readonly detail?: unknown;

  constructor(tag: string, message: string, detail?: unknown) {
    super(message);
    this.tag = tag;
    this.detail = detail;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function findThreadWorkbenchContext(threadId: string): ThreadWorkbenchContext | null {
  const matches: Array<ThreadWorkbenchContext & { createdAt: number }> = [];
  for (const workbench of Object.values(useProjectWorkbenchStore.getState().workbenches)) {
    if (!workbench.workspaceId) continue;
    for (const tileId of workbench.order) {
      const tile = workbench.tiles[tileId];
      if (tile?.type !== "assistantChat" || tile.threadId !== threadId) continue;
      matches.push({
        projectId: workbench.projectId,
        laneId: workbench.laneId,
        workspaceId: workbench.workspaceId,
        assistantTileId: tile.id,
        activeTileId: workbench.activeTileId,
        tileIds: new Set(Object.keys(workbench.tiles)),
        createdAt: tile.createdAt,
      });
    }
  }
  const match = matches.sort((left, right) => right.createdAt - left.createdAt)[0];
  if (!match) return null;
  const { createdAt: _createdAt, ...context } = match;
  return context;
}

function isSurfaceStillPresent(state: ThreadSurfaceState): boolean {
  return Object.values(useProjectWorkbenchStore.getState().workbenches).some((workbench) => {
    const tile = workbench.tiles[state.handle.tileId];
    return tile?.type === "devServer" && !tile.devAppId;
  });
}

function isDevServerTilePresent(tileId: string): boolean {
  return Object.values(useProjectWorkbenchStore.getState().workbenches).some((workbench) => {
    const tile = workbench.tiles[tileId];
    return tile?.type === "devServer" && !tile.devAppId;
  });
}

function readDevAppPreviewTile(
  context: ThreadWorkbenchContext,
  tileId: string,
): WorkbenchDevAppPreviewTile | null {
  for (const workbench of Object.values(useProjectWorkbenchStore.getState().workbenches)) {
    if (
      workbench.projectId !== context.projectId ||
      workbench.laneId !== context.laneId ||
      workbench.workspaceId !== context.workspaceId
    ) {
      continue;
    }
    const tile = workbench.tiles[tileId];
    return tile?.type === "devAppPreview" ? tile : null;
  }
  return null;
}

function findDevAppPreviewTile(
  context: ThreadWorkbenchContext,
  relativePath: string,
): WorkbenchDevAppPreviewTile | null {
  const expected = normalizeDevAppPreviewRelativePath(relativePath);
  for (const tileId of context.tileIds) {
    const tile = readDevAppPreviewTile(context, tileId);
    if (tile && normalizeDevAppPreviewRelativePath(tile.relativePath) === expected) return tile;
  }
  return null;
}

function readOrgDevAppTile(
  context: ThreadWorkbenchContext,
  tileId: string,
): WorkbenchOrgDevAppTile | null {
  for (const workbench of Object.values(useProjectWorkbenchStore.getState().workbenches)) {
    if (
      workbench.projectId !== context.projectId ||
      workbench.laneId !== context.laneId ||
      workbench.workspaceId !== context.workspaceId
    ) {
      continue;
    }
    const tile = workbench.tiles[tileId];
    return tile?.type === "orgDevApp" ? tile : null;
  }
  return null;
}

interface CozeaPreviewAutomationSurfaceStatus extends PreviewAutomationStatus {
  readonly surfaces: ReadonlyArray<{
    readonly tabId: string;
    readonly kind: BrowserSurfaceInventoryEntry["kind"];
    readonly title: string;
    readonly url: string | null;
    readonly active: boolean;
    readonly controller: BrowserSurfaceInventoryEntry["controller"];
  }>;
}

interface ExecutablePreviewWebview extends Element {
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
}

const waitForDelay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function previewBridge() {
  return window.desktopBridge?.preview ?? null;
}

function eligibleSurfaces(
  context: ThreadWorkbenchContext,
  surfaces: ReadonlyArray<BrowserSurfaceInventoryEntry>,
): BrowserSurfaceInventoryEntry[] {
  return surfaces.filter((surface) => context.tileIds.has(surface.tileId));
}

function resolveSurfaceTarget(
  context: ThreadWorkbenchContext,
  surfaces: ReadonlyArray<BrowserSurfaceInventoryEntry>,
  requestedTabId: string | null,
  lastControlledTabId: string | null,
): BrowserSurfaceInventoryEntry | null {
  const eligible = eligibleSurfaces(context, surfaces);
  if (requestedTabId) {
    return (
      eligible.find(
        (surface) => surface.runtimeTabId === requestedTabId || surface.tileId === requestedTabId,
      ) ?? null
    );
  }
  if (lastControlledTabId) {
    const controlled = eligible.find((surface) => surface.runtimeTabId === lastControlledTabId);
    if (controlled) return controlled;
  }
  if (context.activeTileId) {
    return eligible.find((surface) => surface.tileId === context.activeTileId) ?? null;
  }
  return null;
}

function surfaceInventoryStatus(
  surfaces: ReadonlyArray<BrowserSurfaceInventoryEntry>,
): CozeaPreviewAutomationSurfaceStatus["surfaces"] {
  return surfaces.slice(0, 64).map((surface) => ({
    tabId: surface.runtimeTabId,
    kind: surface.kind,
    title: surface.title.slice(0, 512),
    url: surface.url,
    active: surface.active,
    controller: surface.controller,
  }));
}

const findPreviewWebview = (runtimeTabId: string): ExecutablePreviewWebview | null =>
  Array.from(document.querySelectorAll<ExecutablePreviewWebview>("webview[data-preview-tab]")).find(
    (candidate) => candidate.getAttribute("data-preview-tab") === runtimeTabId,
  ) ?? null;

async function readWebviewViewport(
  webview: ExecutablePreviewWebview,
): Promise<PreviewRenderedViewportSize | null> {
  const value = await webview.executeJavaScript(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  if (typeof value !== "object" || value === null) return null;
  const { width, height } = value as { readonly width?: unknown; readonly height?: unknown };
  return typeof width === "number" &&
    Number.isInteger(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isInteger(height) &&
    height > 0
    ? { width, height }
    : null;
}

async function readRenderedViewport(
  runtimeTabId: string,
): Promise<PreviewRenderedViewportSize | null> {
  const webview = findPreviewWebview(runtimeTabId);
  return webview ? await readWebviewViewport(webview) : null;
}

function readDeclaredViewport(
  webview: ExecutablePreviewWebview | null,
): PreviewRenderedViewportSize | null {
  const width = Number(webview?.getAttribute("data-preview-css-width"));
  const height = Number(webview?.getAttribute("data-preview-css-height"));
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0
    ? { width, height }
    : null;
}

async function waitForRenderedViewport(
  runtimeTabId: string,
  setting: PreviewViewportSetting,
  timeoutMs: number,
): Promise<PreviewRenderedViewportSize> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const webview = findPreviewWebview(runtimeTabId);
      const appliedSettingKey = webview?.getAttribute("data-preview-viewport-key") ?? null;
      const declaredViewport = readDeclaredViewport(webview);
      const renderedViewport = webview ? await readWebviewViewport(webview) : null;
      if (
        renderedViewport &&
        isPreviewViewportReady({
          setting,
          appliedSettingKey,
          declaredViewport,
          renderedViewport,
        })
      ) {
        return renderedViewport;
      }
    } catch {
      // Registration and crash recovery may transiently replace the guest.
    }
    await waitForDelay(50);
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    `Preview viewport for tab ${runtimeTabId} was not rendered within ${timeoutMs}ms.`,
  );
}

async function ensureThreadSurface(
  threadId: string,
  options: {
    preferredTileId?: string;
    forceNew?: boolean;
  } = {},
): Promise<ThreadSurfaceState> {
  const existing = runtime.surfacesByThread.get(threadId);
  if (
    existing &&
    isSurfaceStillPresent(existing) &&
    (!options.preferredTileId || options.preferredTileId === existing.handle.tileId) &&
    !options.forceNew &&
    renewDevServerSurfaceLease(existing.handle.tileId, existing.handle.leaseToken)
  ) {
    return existing;
  }

  if (existing) {
    releaseDevServerSurfaceLease(existing.handle.tileId, existing.handle.leaseToken);
    runtime.surfacesByThread.delete(threadId);
  }

  const context = findThreadWorkbenchContext(threadId);
  if (!context) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "No open agent tile is bound to this thread in the project workbench.",
    );
  }

  const handle = await ensureDevServerSurface({
    ...context,
    ownerId: `t3:${threadId}`,
    preferredTileId: options.preferredTileId,
    forceNew: options.forceNew,
    focus: false,
  });
  const refreshedContext = findThreadWorkbenchContext(threadId);
  if (!refreshedContext?.tileIds.has(handle.tileId)) {
    releaseDevServerSurfaceLease(handle.tileId, handle.leaseToken);
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The agent-created Dev Server surface was not added to the requesting workbench.",
    );
  }
  const state = { context: refreshedContext, handle };
  runtime.surfacesByThread.set(threadId, state);
  return state;
}

async function readStatus(
  context: ThreadWorkbenchContext,
  requestedTabId: string | null,
  lastControlledTabId: string | null,
): Promise<CozeaPreviewAutomationSurfaceStatus> {
  const bridge = previewBridge();
  const surfaces = bridge ? eligibleSurfaces(context, await bridge.listSurfaces()) : [];
  const target = resolveSurfaceTarget(context, surfaces, requestedTabId, lastControlledTabId);
  const inventory = surfaceInventoryStatus(surfaces);
  if (!bridge || !target) {
    return {
      available: false,
      visible: false,
      tabId: requestedTabId,
      url: null,
      title: requestedTabId && isDevServerTilePresent(requestedTabId) ? "Dev Server" : null,
      loading: false,
      surfaces: inventory,
    };
  }
  const status = await bridge.automation.status(target.runtimeTabId);
  const presentation = useBrowserSurfaceStore.getState().byTabId[target.runtimeTabId];
  const viewportSetting = readBrowserViewport(target.runtimeTabId);
  const viewport = await readRenderedViewport(target.runtimeTabId).catch(() => null);
  return {
    ...status,
    tabId: target.runtimeTabId,
    visible: presentation?.visible ?? false,
    viewportSetting,
    ...(viewport ? { viewport } : {}),
    surfaces: inventory,
  };
}

async function readStatusForTile(
  context: ThreadWorkbenchContext,
  tileId: string | null,
): Promise<CozeaPreviewAutomationSurfaceStatus> {
  const bridge = previewBridge();
  if (!tileId) {
    const surfaces = bridge ? eligibleSurfaces(context, await bridge.listSurfaces()) : [];
    return {
      available: false,
      visible: false,
      tabId: null,
      url: null,
      title: null,
      loading: false,
      surfaces: surfaceInventoryStatus(surfaces),
    };
  }
  const surface = bridge
    ? (eligibleSurfaces(context, await bridge.listSurfaces()).find(
        (candidate) => candidate.tileId === tileId,
      ) ?? null)
    : null;
  return await readStatus(context, surface?.runtimeTabId ?? tileId, null);
}

async function readDevServerStatus(
  context: ThreadWorkbenchContext,
  surface: ThreadSurfaceState | null,
  reusedProcess: boolean,
): Promise<{
  running: boolean;
  ready: boolean;
  port: number | null;
  runId: string | null;
  phase: "bootstrapping" | "launching" | "running" | null;
  headless: boolean;
  reusedProcess: boolean;
  surface: PreviewAutomationStatus;
}> {
  const process = await window.electronAPI.devServer.getState({
    workspaceId: context.workspaceId,
    laneId: context.laneId,
  });
  const surfaceStatus = await readStatusForTile(context, surface?.handle.tileId ?? null);
  const hasWorkbenchSurface = Array.from(context.tileIds).some(isDevServerTilePresent);
  return {
    running: process.running,
    ready: process.ready,
    port: process.port,
    runId: process.runId,
    phase: process.phase,
    headless: process.running && !hasWorkbenchSurface,
    reusedProcess,
    surface: surfaceStatus,
  };
}

function boundedText(value: string | undefined, maximum = 2_048): string | undefined {
  return value === undefined ? undefined : value.slice(0, maximum);
}

function readDevAppPreviewDiagnostics(
  snapshot: DevAppPreviewRuntimeSnapshot,
): DevAppPreviewAutomationDiagnostic[] {
  const status = snapshot.status;
  if (snapshot.openError) {
    return [
      {
        code: "preview-open-error",
        severity: "blocker",
        message: snapshot.openError.slice(0, 2_048),
      },
    ];
  }
  if (!status) return [];
  const diagnostics =
    status.status === "invalid" ? status.diagnostics : status.preflight.diagnostics;
  return diagnostics.slice(0, 64).map((diagnostic) => {
    const detail =
      "field" in diagnostic
        ? diagnostic.field
        : "detail" in diagnostic
          ? diagnostic.detail
          : undefined;
    return {
      code: diagnostic.code.slice(0, 128),
      severity: diagnostic.severity,
      message: diagnostic.message.slice(0, 2_048),
      ...(boundedText(detail) ? { detail: boundedText(detail) } : {}),
      ...(boundedText(diagnostic.fix) ? { fix: boundedText(diagnostic.fix) } : {}),
    };
  });
}

async function readDevAppPreviewAutomationStatus(
  context: ThreadWorkbenchContext,
  tile: WorkbenchDevAppPreviewTile,
  snapshot: DevAppPreviewRuntimeSnapshot,
): Promise<DevAppPreviewAutomationStatus> {
  const status = snapshot.status;
  const rawSurface = await readStatusForTile(context, tile.id);
  const name = status && status.status !== "invalid" ? status.name.slice(0, 512) : null;
  const surface = rawSurface.available
    ? rawSurface
    : {
        ...rawSurface,
        tabId: null,
        title: name ?? tile.title.slice(0, 512),
      };
  const requestedCapabilities =
    !status || status.status === "invalid"
      ? []
      : status.status === "needsApproval"
        ? status.requested.capabilities
        : status.grant.capabilities;
  const agentInvocable =
    status?.status === "needsApproval"
      ? status.requested.agentInvocable
      : status?.status === "running"
        ? status.grant.agentInvocable
        : false;
  const declaredTools =
    status && status.status !== "invalid"
      ? status.declaredTools.slice(0, 32).map((tool) => ({
          name: tool.name.slice(0, 64),
          description: tool.description.slice(0, 500),
          inputSchema: tool.inputSchema,
        }))
      : [];
  const phase = snapshot.openError ? "invalid" : (status?.status ?? "opening");
  const worker =
    status?.status === "running" && status.worker
      ? {
          status: status.worker.status,
          restarts: Math.max(0, status.worker.restarts),
          lastError: status.worker.lastError?.slice(0, 2_048) ?? null,
        }
      : null;

  return {
    phase,
    relativePath: normalizeDevAppPreviewRelativePath(tile.relativePath).slice(0, 1_024),
    sourceId: status && status.status !== "invalid" ? status.sourceId.slice(0, 128) : null,
    name,
    hotReload: snapshot.hotReload,
    ready: status?.status === "running" && status.view.kind !== "unavailable" && surface.available,
    requestedCapabilities: requestedCapabilities.slice(0, 64).map((value) => value.slice(0, 128)),
    agentInvocable,
    declaredTools,
    toolInvocationAvailable:
      phase === "running" &&
      agentInvocable &&
      worker?.status === "ready" &&
      declaredTools.length > 0,
    diagnostics: readDevAppPreviewDiagnostics(snapshot),
    worker,
    surface,
  };
}

async function waitForDevAppPreviewRuntime(
  tileId: string,
  timeoutMs: number,
): Promise<DevAppPreviewRuntimeSnapshot> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const snapshot = readDevAppPreviewRuntime(tileId);
    if (snapshot && (snapshot.status !== null || snapshot.openError !== null)) return snapshot;
    await waitForDelay(25);
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    `DevApp preview ${tileId} did not finish opening within ${timeoutMs}ms.`,
  );
}

async function resolveDevAppPreviewAutomationStatus(
  threadId: string,
  context: ThreadWorkbenchContext,
  tile: WorkbenchDevAppPreviewTile,
  timeoutMs: number,
): Promise<DevAppPreviewAutomationStatus> {
  const snapshot = await waitForDevAppPreviewRuntime(tile.id, timeoutMs);
  if (snapshot.status?.status === "running" && snapshot.status.view.kind !== "unavailable") {
    const surface = await waitForReadySurface(context, tile.id, timeoutMs, true);
    runtime.lastControlledSurfaceByThread.set(threadId, surface.runtimeTabId);
  }
  return await readDevAppPreviewAutomationStatus(context, tile, snapshot);
}

interface ResolvedDevAppToolTarget {
  catalog: DevAppToolCatalogStatus;
  invoke: (name: string, input: unknown, timeoutMs: number) => Promise<unknown>;
}

async function resolveDevAppToolTarget(
  request: PreviewAutomationRequest,
  input: Record<string, unknown>,
): Promise<ResolvedDevAppToolTarget> {
  const context = requireThreadWorkbenchContext(request.threadId);
  const bridge = previewBridge();
  const surfaces = bridge ? eligibleSurfaces(context, await bridge.listSurfaces()) : [];
  const requestedSurface = request.tabId
    ? resolveSurfaceTarget(context, surfaces, request.tabId, null)
    : null;
  if (
    requestedSurface &&
    requestedSurface.kind !== "devAppPreview" &&
    requestedSurface.kind !== "orgDevApp"
  ) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      `Preview tab ${request.tabId} is not a DevApp.`,
    );
  }

  const requestedTileId = requestedSurface?.tileId ?? request.tabId ?? null;
  const publishedTile = requestedTileId ? readOrgDevAppTile(context, requestedTileId) : null;
  if (publishedTile) {
    if (typeof input.relativePath === "string") {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "Published DevApps must be targeted only by their exact tabId.",
      );
    }
    const result = await window.electronAPI.orgDevApp.getPublishedToolStatus({
      ref: publishedTile.devAppRef,
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    });
    if (!result.success) {
      throw new PreviewHostError("PreviewAutomationExecutionError", result.error);
    }
    const status = result.status;
    const catalog = {
      kind: "published",
      tabId: requestedSurface?.runtimeTabId ?? publishedTile.id,
      name: status.name.slice(0, 512),
      reference: status.ref.slice(0, 2_048),
      sourceId: null,
      agentInvocable: status.agentInvocable,
      toolInvocationAvailable: status.toolInvocationAvailable,
      declaredTools: status.declaredTools.slice(0, 32).map((tool) => ({
        name: tool.name.slice(0, 64),
        description: tool.description.slice(0, 500),
        inputSchema: tool.inputSchema,
      })),
      worker: status.worker
        ? {
            status: status.worker.status,
            restarts: Math.max(0, status.worker.restarts),
            lastError: status.worker.lastError?.slice(0, 2_048) ?? null,
          }
        : null,
    } satisfies DevAppToolCatalogStatus;
    return {
      catalog,
      invoke: async (name, toolInput, timeoutMs) => {
        const invocation = await window.electronAPI.orgDevApp.invokePublishedTool({
          ref: publishedTile.devAppRef,
          workspaceId: context.workspaceId,
          laneId: context.laneId,
          name,
          input: toolInput,
          timeoutMs,
        });
        if (!invocation.success) {
          throw new PreviewHostError("PreviewAutomationExecutionError", invocation.error);
        }
        return invocation.result;
      },
    };
  }

  const requestedDevelopmentTile = requestedTileId
    ? readDevAppPreviewTile(context, requestedTileId)
    : null;
  const inputRelativePath =
    typeof input.relativePath === "string"
      ? normalizeDevAppPreviewRelativePath(input.relativePath)
      : null;
  if (request.tabId && !requestedDevelopmentTile) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      `DevApp ${request.tabId} is not available in this workbench.`,
    );
  }
  if (
    requestedDevelopmentTile &&
    inputRelativePath &&
    normalizeDevAppPreviewRelativePath(requestedDevelopmentTile.relativePath) !== inputRelativePath
  ) {
    throw new PreviewHostError(
      "PreviewAutomationExecutionError",
      "The requested preview tab belongs to a different development package.",
    );
  }
  const tile =
    requestedDevelopmentTile ??
    (inputRelativePath ? findDevAppPreviewTile(context, inputRelativePath) : null);
  if (!tile) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The requested development DevApp must already be open in this workbench.",
    );
  }
  const snapshot = await waitForDevAppPreviewRuntime(tile.id, Math.min(request.timeoutMs, 5_000));
  const previewStatus = await readDevAppPreviewAutomationStatus(context, tile, snapshot);
  const approvedAgentInvocation =
    previewStatus.phase === "running" && previewStatus.agentInvocable;
  const catalog = {
    kind: "development",
    tabId: requestedSurface?.runtimeTabId ?? tile.id,
    name: previewStatus.name ?? tile.title.slice(0, 512),
    reference: null,
    sourceId: previewStatus.sourceId,
    agentInvocable: approvedAgentInvocation,
    toolInvocationAvailable:
      approvedAgentInvocation &&
      previewStatus.worker?.status === "ready" &&
      previewStatus.declaredTools.length > 0,
    declaredTools: previewStatus.declaredTools,
    worker: previewStatus.worker,
  } satisfies DevAppToolCatalogStatus;
  return {
    catalog,
    invoke: async (name, toolInput, timeoutMs) => {
      if (!previewStatus.sourceId) {
        throw new PreviewHostError(
          "PreviewAutomationExecutionError",
          "The development DevApp has no running worker source.",
        );
      }
      const invocation = await window.electronAPI.devAppPreview.invokeTool({
        sourceId: previewStatus.sourceId,
        name,
        input: toolInput,
        timeoutMs,
      });
      if (!invocation.success) {
        throw new PreviewHostError("PreviewAutomationExecutionError", invocation.error);
      }
      return invocation.result;
    },
  };
}

async function waitForDevServerLaunchContext(
  context: ThreadWorkbenchContext,
  timeoutMs: number,
): Promise<string> {
  const runKey = buildDevServerRunKey(context.workspaceId, context.laneId);
  const deadline = Date.now() + Math.min(timeoutMs, 5_000);
  while (Date.now() <= deadline) {
    const terminalId = useDevServerRunStore.getState().contexts[runKey]?.terminalId;
    if (terminalId) {
      const terminalIds = await window.electronAPI.terminal.list({
        workspaceId: context.workspaceId,
      });
      if (terminalIds.includes(terminalId)) return runKey;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "The Dev Server launch terminal did not initialize before the request timed out.",
  );
}

async function waitForDevServerReady(
  context: ThreadWorkbenchContext,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const state = await window.electronAPI.devServer.getState({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    });
    if (state.running && state.ready && state.port) return;
    if (!state.running) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "Dev Server stopped before it became ready.",
      );
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    "Dev Server did not become ready before the request timed out.",
  );
}

function requireThreadWorkbenchContext(threadId: string): ThreadWorkbenchContext {
  const context = findThreadWorkbenchContext(threadId);
  if (context) return context;
  throw new PreviewHostError(
    "PreviewAutomationTabNotFoundError",
    "No open agent tile is bound to this thread in the project workbench.",
  );
}

async function waitForReadySurface(
  context: ThreadWorkbenchContext,
  requestedTabId: string,
  timeoutMs: number,
  allowPendingRegistration: boolean,
): Promise<BrowserSurfaceInventoryEntry> {
  const bridge = previewBridge();
  if (!bridge) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The desktop preview bridge is unavailable.",
    );
  }
  const deadline = Date.now() + timeoutMs;
  let found = false;
  while (Date.now() <= deadline) {
    const surfaces = eligibleSurfaces(context, await bridge.listSurfaces());
    const target = resolveSurfaceTarget(context, surfaces, requestedTabId, null);
    if (target) {
      found = true;
      const status = await bridge.automation.status(target.runtimeTabId);
      if (status.available) return target;
    } else if (!allowPendingRegistration) {
      break;
    }
    await waitForDelay(50);
  }
  throw new PreviewHostError(
    found ? "PreviewAutomationTimeoutError" : "PreviewAutomationTabNotFoundError",
    found
      ? `Browser surface ${requestedTabId} did not register within ${timeoutMs}ms.`
      : `Browser surface ${requestedTabId} is not available in this workbench.`,
  );
}

async function requireReadySurface(
  request: PreviewAutomationRequest,
  context: ThreadWorkbenchContext,
): Promise<BrowserSurfaceInventoryEntry> {
  const bridge = previewBridge();
  if (!bridge) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The desktop preview bridge is unavailable.",
    );
  }
  const surfaces = eligibleSurfaces(context, await bridge.listSurfaces());
  const target = resolveSurfaceTarget(
    context,
    surfaces,
    request.tabId ?? null,
    runtime.lastControlledSurfaceByThread.get(request.threadId) ?? null,
  );
  if (!target) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      request.tabId
        ? `Browser surface ${request.tabId} is not available in this workbench.`
        : "No previously controlled or active browser-backed tile is available in this workbench.",
    );
  }
  const ready = await waitForReadySurface(context, target.runtimeTabId, request.timeoutMs, false);
  runtime.lastControlledSurfaceByThread.set(request.threadId, ready.runtimeTabId);
  return ready;
}

function resolveNavigationUrl(input: PreviewAutomationNavigateInput): string {
  if (input.target?.kind === "environment-port") {
    const protocol = input.target.protocol ?? "http";
    const path = input.target.path?.trim() || "/";
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${protocol}://127.0.0.1:${input.target.port}${normalizedPath}`;
  }
  const raw = input.url?.trim() ?? "";
  const normalized = normalizeUrlInput(raw);
  if (!normalized) {
    throw new PreviewHostError(
      "PreviewAutomationExecutionError",
      "Preview navigation requires a non-empty URL.",
    );
  }
  return normalized;
}

async function waitForNavigationReadiness(
  runtimeTabId: string,
  readiness: "load" | "domContentLoaded" | "none",
  timeoutMs: number,
): Promise<void> {
  if (readiness === "none") return;
  const bridge = previewBridge();
  if (!bridge) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The desktop preview bridge is unavailable.",
    );
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const status = await bridge.automation.status(runtimeTabId);
    if (status.available && !status.loading) {
      if (readiness === "load") return;
      const readyState = await bridge.automation
        .evaluate(runtimeTabId, {
          expression: "document.readyState",
          awaitPromise: true,
          returnByValue: true,
        })
        .catch(() => null);
      if (readyState === "interactive" || readyState === "complete") return;
    }
    await waitForDelay(50);
  }
  throw new PreviewHostError(
    "PreviewAutomationTimeoutError",
    `Preview navigation in tab ${runtimeTabId} did not reach ${readiness} readiness within ${timeoutMs}ms.`,
  );
}

function resolveBrowserRecordingStopTarget(
  activeTabIds: ReadonlySet<string>,
  implicitTabId: string | null,
  explicitTabId?: string,
): string | null {
  if (explicitTabId !== undefined) {
    return activeTabIds.has(explicitTabId) ? explicitTabId : null;
  }
  if (implicitTabId !== null && activeTabIds.has(implicitTabId)) return implicitTabId;
  if (activeTabIds.size !== 1) return null;
  return activeTabIds.values().next().value ?? null;
}

async function runRequestInternal(
  request: PreviewAutomationRequest,
  environmentId: string,
): Promise<unknown> {
  const input = asRecord(request.input);
  const current = runtime.surfacesByThread.get(request.threadId);

  if (request.operation === "devAppToolCatalog" || request.operation === "devAppToolInvoke") {
    const target = await resolveDevAppToolTarget(request, input);
    if (request.operation === "devAppToolCatalog") return target.catalog;

    const name = typeof input.name === "string" ? input.name : "";
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "The DevApp tool name is invalid.",
      );
    }
    if (!target.catalog.declaredTools.some((tool) => tool.name === name)) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        `The targeted DevApp did not declare the tool ${name}.`,
      );
    }
    if (!target.catalog.toolInvocationAvailable) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "The DevApp worker is not running with an active agent-invocation approval.",
      );
    }
    const result = (await target.invoke(
      name,
      input.input,
      request.timeoutMs,
    )) as DevAppToolInvocationResult["result"];
    return {
      target: target.catalog,
      name,
      result,
    } satisfies DevAppToolInvocationResult;
  }

  if (request.operation === "devAppPreviewEnsure" || request.operation === "devAppPreviewAttach") {
    const initialContext = requireThreadWorkbenchContext(request.threadId);
    const bridge = previewBridge();
    const surfaces = bridge ? eligibleSurfaces(initialContext, await bridge.listSurfaces()) : [];
    const requestedSurface = request.tabId
      ? resolveSurfaceTarget(initialContext, surfaces, request.tabId, null)
      : null;
    if (requestedSurface && requestedSurface.kind !== "devAppPreview") {
      throw new PreviewHostError(
        "PreviewAutomationTabNotFoundError",
        `Preview tab ${request.tabId} is not a development DevApp preview.`,
      );
    }
    const requestedTile = request.tabId
      ? readDevAppPreviewTile(initialContext, requestedSurface?.tileId ?? request.tabId)
      : null;
    if (request.tabId && !requestedTile) {
      throw new PreviewHostError(
        "PreviewAutomationTabNotFoundError",
        `Development preview ${request.tabId} is not available in this workbench.`,
      );
    }

    const inputRelativePath =
      typeof input.relativePath === "string"
        ? normalizeDevAppPreviewRelativePath(input.relativePath)
        : null;
    const relativePath = requestedTile?.relativePath
      ? normalizeDevAppPreviewRelativePath(requestedTile.relativePath)
      : inputRelativePath;
    if (!relativePath) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "A project-relative DevApp package path is required.",
      );
    }
    if (
      requestedTile &&
      inputRelativePath &&
      normalizeDevAppPreviewRelativePath(requestedTile.relativePath) !== inputRelativePath
    ) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        "The requested preview tab belongs to a different DevApp package.",
      );
    }

    const existingTile = requestedTile ?? findDevAppPreviewTile(initialContext, relativePath);
    const handle = await ensureDevAppPreviewSurface({
      ...initialContext,
      relativePath,
      ...(existingTile ? { preferredTileId: existingTile.id } : {}),
      create: request.operation === "devAppPreviewEnsure",
      focus: input.open === true,
    });
    const context = requireThreadWorkbenchContext(request.threadId);
    const tile = readDevAppPreviewTile(context, handle.tileId);
    if (!tile) {
      throw new PreviewHostError(
        "PreviewAutomationTabNotFoundError",
        "The development preview closed before it could be attached.",
      );
    }
    if (!handle.focused && input.open === true) {
      focusDevAppPreviewSurface(handle.scopeKey, handle.tileId);
    }
    return await resolveDevAppPreviewAutomationStatus(
      request.threadId,
      context,
      tile,
      request.timeoutMs,
    );
  }

  if (request.operation === "devServerStatus") {
    const context = requireThreadWorkbenchContext(request.threadId);
    return await readDevServerStatus(context, current ?? null, false);
  }

  if (request.operation === "devServerAttach" || request.operation === "devServerEnsure") {
    const threadContext = requireThreadWorkbenchContext(request.threadId);
    const surfaces = previewBridge()
      ? eligibleSurfaces(threadContext, await previewBridge()!.listSurfaces())
      : [];
    const preferredSurface = request.tabId
      ? resolveSurfaceTarget(threadContext, surfaces, request.tabId, null)
      : null;
    const surface = await ensureThreadSurface(request.threadId, {
      preferredTileId: preferredSurface?.tileId ?? request.tabId,
      // Ensure is process-idempotent and must never multiply surfaces as a
      // recovery strategy. The controller will still create a new surface
      // when every existing one has an active lease from another thread.
      forceNew: request.operation === "devServerAttach" && input.reuseExistingSurface === false,
    });
    const { context, handle } = surface;

    if (!handle.created && input.open === true) {
      focusDevServerSurface(handle.scopeKey, handle.tileId);
    }

    const before = await window.electronAPI.devServer.getState({
      workspaceId: context.workspaceId,
      laneId: context.laneId,
    });
    if (request.operation === "devServerEnsure") {
      const runKey = await waitForDevServerLaunchContext(context, request.timeoutMs);
      await ensureDevServerRun(runKey, {
        ...(typeof input.command === "string" ? { command: input.command } : {}),
        ...(typeof input.port === "number" ? { port: input.port } : {}),
      });
      const rendererRun = useDevServerRunStore.getState().runs[runKey];
      if (rendererRun?.status === "error") {
        throw new PreviewHostError(
          "PreviewAutomationExecutionError",
          rendererRun.error ?? "Dev Server failed to start.",
        );
      }
      await waitForDevServerReady(context, request.timeoutMs);
    }
    return await readDevServerStatus(context, surface, before.running);
  }

  if (request.operation === "status") {
    const context = requireThreadWorkbenchContext(request.threadId);
    return await readStatus(
      context,
      request.tabId ?? null,
      runtime.lastControlledSurfaceByThread.get(request.threadId) ?? null,
    );
  }

  const context = requireThreadWorkbenchContext(request.threadId);
  const bridge = previewBridge();
  if (!bridge) {
    throw new PreviewHostError(
      "PreviewAutomationTabNotFoundError",
      "The desktop preview bridge is unavailable.",
    );
  }

  if (request.operation === "open") {
    const openInput = request.input as PreviewAutomationOpenInput;
    let target: BrowserSurfaceInventoryEntry;
    let targetContext = context;
    if (request.tabId) {
      target = await requireReadySurface(request, context);
    } else {
      const surface = await ensureThreadSurface(request.threadId, {
        forceNew: openInput.reuseExistingTab === false,
      });
      targetContext = surface.context;
      const shouldPresent = openInput.open ?? openInput.show ?? true;
      if (shouldPresent) focusDevServerSurface(surface.handle.scopeKey, surface.handle.tileId);
      target = await waitForReadySurface(
        targetContext,
        surface.handle.tileId,
        request.timeoutMs,
        true,
      );
      runtime.lastControlledSurfaceByThread.set(request.threadId, target.runtimeTabId);
    }
    if (openInput.url) {
      const url = resolveNavigationUrl({ url: openInput.url } as PreviewAutomationNavigateInput);
      await bridge.navigate(target.runtimeTabId, url);
      await waitForNavigationReadiness(target.runtimeTabId, "load", request.timeoutMs);
    }
    return await readStatus(targetContext, target.runtimeTabId, target.runtimeTabId);
  }

  if (request.operation === "recordingStop") {
    const threadRef = { environmentId, threadId: request.threadId } as ScopedThreadRef;
    const activeRecordings = readActiveBrowserRecordingTargets(threadRef);
    const activeTabIds = new Set(activeRecordings.map((recording) => recording.serverTabId));
    const surfaces = eligibleSurfaces(context, await bridge.listSurfaces());
    const implicitTarget = resolveSurfaceTarget(
      context,
      surfaces,
      request.tabId ?? null,
      runtime.lastControlledSurfaceByThread.get(request.threadId) ?? null,
    );
    const explicitRuntimeTabId = request.tabId
      ? resolveSurfaceTarget(context, surfaces, request.tabId, null)?.runtimeTabId
      : undefined;
    const stopTabId = resolveBrowserRecordingStopTarget(
      activeTabIds,
      implicitTarget?.runtimeTabId ?? null,
      request.tabIdExplicit ? (explicitRuntimeTabId ?? request.tabId) : undefined,
    );
    const artifact = stopTabId ? await stopBrowserRecording(stopTabId) : null;
    if (!artifact || !stopTabId) {
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        `No active recording is available for tab ${request.tabId ?? "unassigned"}.`,
      );
    }
    return { ...artifact, tabId: stopTabId };
  }

  const target = await requireReadySurface(request, context);
  switch (request.operation) {
    case "navigate": {
      const navigateInput = request.input as PreviewAutomationNavigateInput;
      const url = resolveNavigationUrl(navigateInput);
      await bridge.navigate(target.runtimeTabId, url);
      await waitForNavigationReadiness(
        target.runtimeTabId,
        navigateInput.readiness ?? "load",
        navigateInput.timeoutMs ?? request.timeoutMs,
      );
      return await readStatus(context, target.runtimeTabId, target.runtimeTabId);
    }
    case "resize": {
      const resizeInput = request.input as PreviewAutomationResizeInput;
      const setting = resolvePreviewViewport(resizeInput);
      const previousSetting = readBrowserViewport(target.runtimeTabId);
      await commitBrowserViewportChange(target.runtimeTabId, setting);
      let viewport: PreviewRenderedViewportSize;
      try {
        viewport = await waitForRenderedViewport(
          target.runtimeTabId,
          setting,
          resizeInput.timeoutMs ?? request.timeoutMs,
        );
      } catch (cause) {
        const latestSetting = readBrowserViewport(target.runtimeTabId);
        if (shouldRollbackPreviewViewport(previousSetting, setting, latestSetting, null, null)) {
          await commitBrowserViewportChange(target.runtimeTabId, previousSetting).catch(
            () => undefined,
          );
        }
        throw cause;
      }
      return {
        tabId: target.runtimeTabId,
        setting,
        viewport,
      } satisfies PreviewAutomationResizeResult;
    }
    case "setColorScheme": {
      const colorInput = request.input as PreviewAutomationSetColorSchemeInput;
      await bridge.setColorScheme(target.runtimeTabId, colorInput.colorScheme);
      return {
        tabId: target.runtimeTabId,
        colorScheme: colorInput.colorScheme,
      } satisfies PreviewAutomationSetColorSchemeResult;
    }
    case "snapshot":
      return await bridge.automation.snapshot(target.runtimeTabId);
    case "click":
      return await bridge.automation.click(
        target.runtimeTabId,
        request.input as PreviewAutomationClickInput,
      );
    case "type":
      return await bridge.automation.type(
        target.runtimeTabId,
        request.input as PreviewAutomationTypeInput,
      );
    case "press":
      return await bridge.automation.press(
        target.runtimeTabId,
        request.input as PreviewAutomationPressInput,
      );
    case "scroll":
      return await bridge.automation.scroll(
        target.runtimeTabId,
        request.input as PreviewAutomationScrollInput,
      );
    case "evaluate":
      return await bridge.automation.evaluate(
        target.runtimeTabId,
        request.input as PreviewAutomationEvaluateInput,
      );
    case "waitFor":
      return await bridge.automation.waitFor(
        target.runtimeTabId,
        request.input as PreviewAutomationWaitForInput,
      );
    case "recordingStart": {
      const threadRef = { environmentId, threadId: request.threadId } as ScopedThreadRef;
      const startedAt = await startBrowserRecording(
        target.runtimeTabId,
        threadRef,
        target.runtimeTabId,
      );
      return { tabId: target.runtimeTabId, recording: true, startedAt };
    }
    default:
      throw new PreviewHostError(
        "PreviewAutomationExecutionError",
        `Unsupported preview automation operation ${request.operation}.`,
      );
  }
}

async function withRequestTimeout<T>(
  request: PreviewAutomationRequest,
  operation: Promise<T>,
): Promise<T> {
  let timeoutId: number | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(
      () =>
        reject(
          new PreviewHostError(
            "PreviewAutomationTimeoutError",
            `Preview automation ${request.operation} did not complete within ${request.timeoutMs}ms.`,
          ),
        ),
      request.timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
}

async function runRequest(
  request: PreviewAutomationRequest,
  environmentId = "cozea-desktop",
): Promise<unknown> {
  return await withRequestTimeout(request, runRequestInternal(request, environmentId));
}

export const __t3PreviewAutomationHostTestUtils = {
  eligibleSurfaces,
  readDevServerStatus,
  readStatus,
  resolveBrowserRecordingStopTarget,
  resolveSurfaceTarget,
  surfaceInventoryStatus,
  resetRuntime: () => {
    runtime.surfacesByThread.clear();
    runtime.lastControlledSurfaceByThread.clear();
    runtime.requestQueues.clear();
  },
  runRequest,
  supportedOperations: SUPPORTED_OPERATIONS,
  toResponseError: (error: unknown) => toResponseError(error),
};

async function serializeThreadRequest<T>(threadId: string, task: () => Promise<T>): Promise<T> {
  const previous = runtime.requestQueues.get(threadId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => {}).then(() => gate);
  runtime.requestQueues.set(threadId, tail);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (runtime.requestQueues.get(threadId) === tail) {
      runtime.requestQueues.delete(threadId);
    }
  }
}

function toResponseError(error: unknown): NonNullable<PreviewAutomationResponse["error"]> {
  if (error instanceof PreviewHostError) {
    return {
      _tag: error.tag,
      message: error.message,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  const record = asRecord(error);
  const cause = asRecord(record.cause);
  const remoteTag =
    typeof record._tag === "string"
      ? record._tag
      : typeof cause._tag === "string"
        ? cause._tag
        : null;
  const message = error instanceof Error ? error.message : String(error);
  const inferredTag = (() => {
    if (remoteTag) {
      if (
        remoteTag === "PreviewTabNotFoundError" ||
        remoteTag === "PreviewWebContentsNotFoundError" ||
        remoteTag === "PreviewWebviewNotInitializedError"
      ) {
        return "PreviewAutomationTabNotFoundError";
      }
      return remoteTag;
    }
    if (/not attached|unknown browser surface|not available in this workbench/i.test(message)) {
      return "PreviewAutomationTabNotFoundError";
    }
    if (/interrupted by human input/i.test(message)) {
      return "PreviewAutomationControlInterruptedError";
    }
    if (/rejected .*selector|invalid selector/i.test(message)) {
      return "PreviewAutomationInvalidSelectorError";
    }
    if (/maximum is \d+ bytes|result.*too large/i.test(message)) {
      return "PreviewAutomationResultTooLargeError";
    }
    if (/did not .* within \d+ms|timed out|timeout/i.test(message)) {
      return "PreviewAutomationTimeoutError";
    }
    return "PreviewAutomationExecutionError";
  })();
  return {
    _tag: inferredTag,
    message,
    ...(record.detail === undefined ? {} : { detail: record.detail }),
  };
}

async function respondToRequest(
  session: T3RpcSessionHandle,
  connectionId: string,
  request: PreviewAutomationRequest,
  environmentId: string,
): Promise<void> {
  let response: PreviewAutomationResponse;
  try {
    const result = await serializeThreadRequest(request.threadId, () =>
      runRequest(request, environmentId),
    );
    response = {
      clientId: HOST_CLIENT_ID,
      connectionId,
      requestId: request.requestId,
      ok: true,
      result,
    };
  } catch (error) {
    response = {
      clientId: HOST_CLIENT_ID,
      connectionId,
      requestId: request.requestId,
      ok: false,
      error: toResponseError(error),
    };
  }
  await session.client.callUnary(WS_METHODS.previewAutomationRespond, response);
}

async function startCandidate(
  owner: symbol,
  candidate: T3PreviewAutomationCandidate,
  generation: number,
): Promise<ActiveHostConnection | null> {
  const response = await fetch(new URL("/.well-known/t3/environment", candidate.baseUrl));
  if (!response.ok) {
    throw new Error(`T3 environment descriptor unavailable (${response.status}).`);
  }
  const descriptor = (await response.json()) as { environmentId?: string };
  if (!descriptor.environmentId) {
    throw new Error("T3 environment descriptor did not include environmentId.");
  }
  if (generation !== runtime.generation || !runtime.candidates.has(owner)) return null;

  let connectionId: string | null = null;
  const updateFocus = () => {
    if (!connectionId) return;
    void candidate.session.client
      .callUnary(WS_METHODS.previewAutomationFocusHost, {
        clientId: HOST_CLIENT_ID,
        environmentId: descriptor.environmentId,
        connectionId,
        focused: document.hasFocus(),
      })
      .catch(() => {});
  };
  const onFocus = () => updateFocus();
  const onBlur = () => updateFocus();
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);

  let stopping = false;
  const stopStream = await candidate.session.client.openStream(
    WS_METHODS.previewAutomationConnect,
    {
      clientId: HOST_CLIENT_ID,
      environmentId: descriptor.environmentId,
      supportedOperations: [...SUPPORTED_OPERATIONS],
    },
    (value) => {
      const event = value as PreviewAutomationStreamEvent;
      if (event.type === "connected") {
        connectionId = event.connectionId;
        updateFocus();
        return;
      }
      if (event.type === "request") {
        void respondToRequest(
          candidate.session,
          event.connectionId,
          event.request,
          descriptor.environmentId!,
        ).catch((error) => {
          console.warn("[T3PreviewAutomation] Failed to respond to preview request", error);
        });
      }
    },
    () => {
      if (
        stopping ||
        generation !== runtime.generation ||
        runtime.candidates.get(owner) !== candidate
      ) {
        return;
      }
      window.setTimeout(() => {
        if (
          stopping ||
          generation !== runtime.generation ||
          runtime.candidates.get(owner) !== candidate ||
          runtime.active?.owner !== owner ||
          runtime.active.candidate !== candidate
        ) {
          return;
        }
        runtime.active.removeFocusListeners();
        runtime.active = null;
        scheduleReconcile();
      }, 0);
    },
  );

  return {
    owner,
    candidate,
    environmentId: descriptor.environmentId,
    stop: async () => {
      stopping = true;
      await stopStream();
    },
    removeFocusListeners: () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    },
  };
}

function scheduleReconcile(): void {
  runtime.transition = runtime.transition.then(async () => {
    const activeOwner = runtime.active?.owner;
    if (activeOwner && runtime.candidates.get(activeOwner) === runtime.active?.candidate) {
      return;
    }

    if (runtime.active) {
      runtime.active.removeFocusListeners();
      await runtime.active.stop().catch(() => {});
      runtime.active = null;
    }

    const next = runtime.candidates.entries().next().value as
      | [symbol, T3PreviewAutomationCandidate]
      | undefined;
    if (!next) return;
    const [owner, candidate] = next;
    const generation = ++runtime.generation;
    try {
      runtime.active = await startCandidate(owner, candidate, generation);
    } catch (error) {
      console.warn("[T3PreviewAutomation] Failed to connect preview host", error);
    }
  });
}

export function registerT3PreviewAutomationHost(
  owner: symbol,
  candidate: T3PreviewAutomationCandidate,
): () => void {
  runtime.candidates.set(owner, candidate);
  scheduleReconcile();
  return () => {
    if (runtime.candidates.get(owner) === candidate) {
      runtime.candidates.delete(owner);
    }
    if (runtime.active?.owner === owner) {
      runtime.generation += 1;
    }
    scheduleReconcile();
  };
}
