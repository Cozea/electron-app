import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  BrowserWindow,
  type Event,
  type IpcMainInvokeEvent,
  type Session,
  session,
  shell,
  webContents,
  type WebContents,
  type WebPreferences,
} from "electron";
import type {
  DesktopPreviewAnnotationTheme,
  DesktopPreviewColorScheme,
  DesktopPreviewRecordingArtifact,
  DesktopPreviewScreenshotArtifact,
  DesktopPreviewTabDefaults,
  DesktopPreviewWebviewConfig,
  PreviewAnnotationSubmissionResult,
} from "@cozea/contracts/t3/ipc";
import type {
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationPressInput,
  PreviewAutomationScrollInput,
  PreviewAutomationSnapshot,
  PreviewAutomationStatus,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "@cozea/contracts/t3/previewAutomation";
import type {
  BrowserFindInPageOptions,
  BrowserFindState,
  BrowserHttpDiagnostic,
  BrowserSurfaceDescriptor,
  BrowserSurfaceInventoryEntry,
  CozeaBrowserSurfaceState,
  PreparedBrowserSurface,
} from "../../../../shared/browserSurfaceTypes";
import { browserHttpDiagnosticForResponse } from "../../../../shared/browserHttpDiagnostics";
import {
  evaluateOrgDevAppNavigation,
  getOrgDevAppNavigationScope,
  isContentHash,
  normalizeContentHash,
} from "../../../../shared/orgDevAppProtocol";
import type { OrgDevAppArtifactService } from "./OrgDevAppArtifactService";

import * as T3Effect from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/Effect.js";
import * as T3Fiber from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/Fiber.js";
import * as T3FileSystem from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/FileSystem.js";
import * as T3Layer from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/Layer.js";
import * as T3ManagedRuntime from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/ManagedRuntime.js";
import * as T3Path from "../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/Path.js";
import { HostProcessPlatform as T3HostProcessPlatform } from "../../../../vendor/t3code/packages/shared/src/hostProcess.ts";
import * as T3BrowserSession from "../../../../vendor/t3code/apps/desktop/src/preview/BrowserSession.ts";
import * as T3DesktopEnvironment from "../../../../vendor/t3code/apps/desktop/src/app/DesktopEnvironment.ts";
import * as T3PreviewManager from "../../../../vendor/t3code/apps/desktop/src/preview/Manager.ts";

const PREVIEW_WEBVIEW_PREFERENCES = "contextIsolation=false,sandbox=true,nodeIntegration=false";
const ALLOWED_PREVIEW_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "notifications",
  "geolocation",
]);

const EMPTY_FIND_STATE: BrowserFindState = {
  query: "",
  visible: false,
  matchCase: false,
  activeMatchOrdinal: 0,
  matches: 0,
  finalUpdate: false,
};

type T3Manager = T3PreviewManager.PreviewManager["Service"];

interface AttachedSurfaceListeners {
  webContents: WebContents;
  dispose: () => void;
}

interface BrowserSurfaceServiceOptions {
  getMainWindow: () => BrowserWindow | null;
  orgDevAppArtifactService: OrgDevAppArtifactService;
  artifactsDirectory: string;
  pickPreloadPath: string;
  pictureInPicturePreloadPath: string;
}

function normalizeSessionSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-z0-9_-]+/gi, "-");
  return normalized.length > 0 ? normalized.slice(0, 120) : "default";
}

function partitionForDescriptor(descriptor: BrowserSurfaceDescriptor): string {
  if (descriptor.storageScope === "global") {
    return "persist:cozea-browser-global";
  }
  if (descriptor.storageScope === "orgDevApp" && descriptor.publicationId) {
    return `persist:cozea-devapp-${normalizeSessionSegment(descriptor.publicationId)}`;
  }
  if (descriptor.storageScope === "workspace" && descriptor.workspaceId) {
    return `persist:cozea-browser-workspace-${normalizeSessionSegment(descriptor.workspaceId)}`;
  }
  return `cozea-browser-ephemeral-${normalizeSessionSegment(descriptor.tileId)}`;
}

function navUrl(state: T3PreviewManager.PreviewTabState): string | null {
  return state.navStatus.kind === "Idle" ? null : state.navStatus.url;
}

function isHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function evaluateOrgSurfaceNavigation(descriptor: BrowserSurfaceDescriptor, rawUrl: string) {
  const expectedScope = descriptor.initialUrl
    ? getOrgDevAppNavigationScope(descriptor.initialUrl)
    : null;
  return evaluateOrgDevAppNavigation(rawUrl, expectedScope);
}

function shouldOpenOrgSurfaceExternally(
  descriptor: BrowserSurfaceDescriptor,
  rawUrl: string,
): boolean {
  const decision = evaluateOrgSurfaceNavigation(descriptor, rawUrl);
  return !decision.allowed && decision.reason === "external-https";
}

function validateOrgSurfaceDescriptor(descriptor: BrowserSurfaceDescriptor): void {
  if (descriptor.kind !== "orgDevApp") {
    if (descriptor.storageScope === "orgDevApp") {
      throw new Error("Only an Organization DevApp may use an Organization DevApp session.");
    }
    return;
  }
  if (
    descriptor.storageScope !== "orgDevApp" ||
    !descriptor.publicationId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(descriptor.publicationId) ||
    !descriptor.contentHash ||
    !isContentHash(descriptor.contentHash) ||
    !descriptor.initialUrl ||
    (descriptor.runtimeKind !== "static" && descriptor.runtimeKind !== "service")
  ) {
    throw new Error("The Organization DevApp surface descriptor is incomplete.");
  }
  const contentHash = normalizeContentHash(descriptor.contentHash);
  const scope = getOrgDevAppNavigationScope(descriptor.initialUrl);
  const expectedScope =
    descriptor.runtimeKind === "static" ? `static:${contentHash}` : `service:${contentHash}:`;
  const scopeMatches =
    descriptor.runtimeKind === "static"
      ? scope === expectedScope
      : scope?.startsWith(expectedScope) === true;
  if (!scopeMatches) {
    throw new Error("The Organization DevApp URL does not match its prepared release.");
  }
}

function cloneFindState(state: BrowserFindState): BrowserFindState {
  return { ...state };
}

export class T3BrowserSurfaceService {
  private readonly descriptors = new Map<string, BrowserSurfaceDescriptor>();
  private readonly partitionsByScope = new Map<string, string>();
  private readonly sessionsByPartition = new Map<string, Session>();
  private readonly partitionOperations = new Map<string, Promise<void>>();
  private readonly stateByTabId = new Map<string, CozeaBrowserSurfaceState>();
  private readonly activeByTabId = new Map<string, boolean>();
  private readonly pendingOrgNavigationByTabId = new Map<string, string>();
  private readonly listenersByTabId = new Map<string, AttachedSurfaceListeners>();
  private readonly stateListeners = new Set<
    (tabId: string, state: CozeaBrowserSurfaceState) => void
  >();
  private readonly pointerListeners = new Set<
    (event: import("@cozea/contracts/t3/ipc").DesktopPreviewPointerEvent) => void
  >();
  private readonly recordingFrameListeners = new Set<
    (frame: import("@cozea/contracts/t3/ipc").DesktopPreviewRecordingFrame) => void
  >();
  private readonly inventoryListeners = new Set<(workbenchSessionKey: string) => void>();
  private readonly options: BrowserSurfaceServiceOptions;
  private readonly runtime;
  private readonly managerPromise: Promise<T3Manager>;
  private stateSubscriptionFiber: T3Fiber.Fiber<never, unknown> | null = null;
  private pointerSubscriptionFiber: T3Fiber.Fiber<never, unknown> | null = null;
  private recordingSubscriptionFiber: T3Fiber.Fiber<never, unknown> | null = null;

  constructor(options: BrowserSurfaceServiceOptions) {
    this.options = options;
    const browserSessionService = T3BrowserSession.BrowserSession.of({
      getPartition: (scope = "shared") =>
        T3Effect.sync(() => {
          const partition = this.partitionsByScope.get(scope);
          if (!partition) {
            throw new Error(`No browser partition is prepared for ${scope}`);
          }
          return partition;
        }),
      isPartition: (partition: string) => this.sessionsByPartition.has(partition),
      getSession: (scope = "shared") =>
        T3Effect.sync(() => {
          const partition = this.partitionsByScope.get(scope);
          if (!partition) {
            throw new Error(`No browser partition is prepared for ${scope}`);
          }
          return this.ensureSession(partition, this.descriptors.get(scope) ?? null);
        }),
      clearCookies: () =>
        T3Effect.promise(() =>
          Promise.all(
            Array.from(this.sessionsByPartition.values(), (browserSession) =>
              browserSession.clearStorageData({
                storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers"],
              }),
            ),
          ).then(() => undefined),
        ),
      clearCache: () =>
        T3Effect.promise(() =>
          Promise.all(
            Array.from(this.sessionsByPartition.values(), (browserSession) =>
              browserSession.clearCache(),
            ),
          ).then(() => undefined),
        ),
    });

    const environmentService = T3DesktopEnvironment.DesktopEnvironment.of({
      browserArtifactsDir: options.artifactsDirectory,
      dirname: path.dirname(options.pictureInPicturePreloadPath),
      path,
    } as unknown as T3DesktopEnvironment.DesktopEnvironment["Service"]);

    const fileSystemLayer = T3FileSystem.layerNoop({
      makeDirectory: (directoryPath, createOptions) =>
        T3Effect.sync(() => {
          fs.mkdirSync(directoryPath, createOptions);
        }),
      writeFile: (filePath, data) =>
        T3Effect.sync(() => {
          fs.writeFileSync(filePath, data);
        }),
    });

    const layer = T3PreviewManager.layer.pipe(
      T3Layer.provideMerge(T3Layer.succeed(T3BrowserSession.BrowserSession, browserSessionService)),
      T3Layer.provideMerge(
        T3Layer.succeed(T3DesktopEnvironment.DesktopEnvironment, environmentService),
      ),
      T3Layer.provideMerge(fileSystemLayer),
      T3Layer.provideMerge(T3Path.layer),
      T3Layer.provideMerge(T3Layer.succeed(T3HostProcessPlatform, process.platform)),
    );

    this.runtime = T3ManagedRuntime.make(layer);
    this.managerPromise = this.runtime.runPromise(
      T3Effect.service(T3PreviewManager.PreviewManager),
    );
    void this.startSubscriptions();
  }

  private ensureSession(partition: string, descriptor: BrowserSurfaceDescriptor | null): Session {
    const existing = this.sessionsByPartition.get(partition);
    if (existing) return existing;

    const browserSession = session.fromPartition(partition);
    const userAgent = browserSession
      .getUserAgent()
      .replace(/Electron\/[\d.]+ /, "")
      .replace(/\s*Cozea\/[\d.]+/, "");
    browserSession.setUserAgent(userAgent);
    browserSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      callback(ALLOWED_PREVIEW_PERMISSIONS.has(permission));
    });
    browserSession.setPermissionCheckHandler((_webContents, permission) =>
      ALLOWED_PREVIEW_PERMISSIONS.has(permission),
    );
    browserSession.on("will-download", (event) => event.preventDefault());
    if (descriptor?.kind === "orgDevApp" && descriptor.publicationId) {
      this.options.orgDevAppArtifactService.registerProtocolForSession(
        browserSession,
        descriptor.publicationId,
      );
    }
    this.sessionsByPartition.set(partition, browserSession);
    return browserSession;
  }

  private async manager(): Promise<T3Manager> {
    return await this.managerPromise;
  }

  private async runPartitionOperation<A>(
    partition: string,
    operation: () => Promise<A>,
  ): Promise<A> {
    const previous = this.partitionOperations.get(partition) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const completion = result.then(
      () => undefined,
      () => undefined,
    );
    this.partitionOperations.set(partition, completion);
    try {
      return await result;
    } finally {
      if (this.partitionOperations.get(partition) === completion) {
        this.partitionOperations.delete(partition);
      }
    }
  }

  private async run<A>(
    operation: (manager: T3Manager) => T3Effect.Effect<A, unknown, never>,
  ): Promise<A> {
    const manager = await this.manager();
    return await this.runtime.runPromise(operation(manager));
  }

  private async startSubscriptions(): Promise<void> {
    const manager = await this.manager();
    const keepAlive = <A>(
      subscribe: T3Effect.Effect<
        A,
        never,
        import("../../../../vendor/t3code/apps/desktop/node_modules/effect/dist/Scope.js").Scope
      >,
    ) => T3Effect.scoped(subscribe.pipe(T3Effect.andThen(T3Effect.never)));

    this.stateSubscriptionFiber = this.runtime.runFork(
      keepAlive(
        manager.subscribeStateChanges((tabId, state) =>
          T3Effect.sync(() => this.acceptT3State(tabId, state)),
        ),
      ),
    );
    this.pointerSubscriptionFiber = this.runtime.runFork(
      keepAlive(
        manager.subscribePointerEvents((event) =>
          T3Effect.sync(() => {
            for (const listener of this.pointerListeners) listener(event);
          }),
        ),
      ),
    );
    this.recordingSubscriptionFiber = this.runtime.runFork(
      keepAlive(
        manager.subscribeRecordingFrames((frame) =>
          T3Effect.sync(() => {
            for (const listener of this.recordingFrameListeners) listener(frame);
          }),
        ),
      ),
    );
  }

  private acceptT3State(tabId: string, state: T3PreviewManager.PreviewTabState): void {
    const descriptor = this.descriptors.get(tabId);
    if (!descriptor) return;
    const previous = this.stateByTabId.get(tabId);
    const next: CozeaBrowserSurfaceState = {
      ...state,
      descriptor,
      requestedUrl: previous?.requestedUrl ?? descriptor.initialUrl,
      find: cloneFindState(previous?.find ?? EMPTY_FIND_STATE),
      httpDiagnostic: previous?.httpDiagnostic ?? null,
    };
    this.stateByTabId.set(tabId, next);
    this.emitState(tabId, next);
  }

  private emitState(tabId: string, state: CozeaBrowserSurfaceState): void {
    for (const listener of this.stateListeners) listener(tabId, state);
  }

  private updateExtendedState(
    tabId: string,
    patch: Partial<Pick<CozeaBrowserSurfaceState, "requestedUrl" | "find" | "httpDiagnostic">>,
  ): void {
    const current = this.stateByTabId.get(tabId);
    if (!current) return;
    const next: CozeaBrowserSurfaceState = {
      ...current,
      ...patch,
      find: patch.find ? cloneFindState(patch.find) : current.find,
    };
    this.stateByTabId.set(tabId, next);
    this.emitState(tabId, next);
  }

  async setMainWindow(window: BrowserWindow): Promise<void> {
    await this.run((manager) => manager.setMainWindow(window));
  }

  canAttachWebview(webPreferences: WebPreferences, params: Record<string, unknown>): boolean {
    const partition = typeof params.partition === "string" ? params.partition : "";
    if (!partition || !this.sessionsByPartition.has(partition)) return false;
    const hasPreparedTab = Array.from(this.descriptors.entries()).some(([tabId, descriptor]) => {
      if (partitionForDescriptor(descriptor) !== partition) return false;
      return this.stateByTabId.get(tabId)?.webContentsId == null;
    });
    if (!hasPreparedTab) return false;

    const preload = typeof params.preload === "string" ? params.preload : null;
    const normalizedPreload = preload?.startsWith("file:")
      ? path.normalize(new URL(preload).pathname)
      : preload
        ? path.normalize(preload)
        : null;
    if (normalizedPreload !== path.normalize(this.options.pickPreloadPath)) return false;

    webPreferences.sandbox = true;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = false;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.webviewTag = false;
    webPreferences.preload = this.options.pickPreloadPath;
    return true;
  }

  async prepareSurface(descriptor: BrowserSurfaceDescriptor): Promise<PreparedBrowserSurface> {
    if (!descriptor.runtimeTabId.trim() || !descriptor.tileId.trim()) {
      throw new Error("Browser surface identifiers must be non-empty.");
    }
    validateOrgSurfaceDescriptor(descriptor);
    if (descriptor.initialUrl && !this.isAllowedNavigation(descriptor, descriptor.initialUrl)) {
      throw new Error(`The initial URL is not allowed for this ${descriptor.kind} surface.`);
    }

    const partition = partitionForDescriptor(descriptor);
    return await this.runPartitionOperation(partition, async () => {
      this.descriptors.set(descriptor.runtimeTabId, { ...descriptor });
      this.partitionsByScope.set(descriptor.runtimeTabId, partition);
      this.ensureSession(partition, descriptor);

      await this.run((manager) => manager.getBrowserSession(descriptor.runtimeTabId));
      const state = await this.run((manager) =>
        manager.createTab(descriptor.runtimeTabId, {
          zoomFactor: 1,
          colorScheme: "system",
        }),
      );
      this.acceptT3State(descriptor.runtimeTabId, state);
      const initialUrl = descriptor.initialUrl;
      if (initialUrl) {
        this.updateExtendedState(descriptor.runtimeTabId, {
          requestedUrl: initialUrl,
          httpDiagnostic: null,
        });
        if (descriptor.kind !== "orgDevApp") {
          await this.run((manager) => manager.navigate(descriptor.runtimeTabId, initialUrl));
        }
      }

      const preparedState = this.stateByTabId.get(descriptor.runtimeTabId);
      if (!preparedState) throw new Error("The browser surface did not initialize.");
      this.emitInventoryChange(descriptor.workbenchSessionKey);
      return {
        config: {
          partition,
          webPreferences: PREVIEW_WEBVIEW_PREFERENCES,
          preloadUrl: pathToFileURL(this.options.pickPreloadPath).href,
        },
        state: preparedState,
      };
    });
  }

  async releaseSurface(tabId: string): Promise<void> {
    const descriptor = this.descriptors.get(tabId);
    const partition = descriptor ? partitionForDescriptor(descriptor) : null;
    const release = async () => {
      this.detachCozeaListeners(tabId);
      await this.run((manager) => manager.closeTab(tabId));
      this.descriptors.delete(tabId);
      this.partitionsByScope.delete(tabId);
      this.stateByTabId.delete(tabId);
      this.activeByTabId.delete(tabId);
      this.pendingOrgNavigationByTabId.delete(tabId);
      if (partition && !partition.startsWith("persist:")) {
        const stillUsed = Array.from(this.descriptors.values()).some(
          (candidate) => partitionForDescriptor(candidate) === partition,
        );
        if (!stillUsed) {
          const ephemeralSession = this.sessionsByPartition.get(partition);
          if (ephemeralSession) {
            await Promise.allSettled([
              ephemeralSession.clearStorageData({
                storages: ["cookies", "localstorage", "indexdb", "websql", "serviceworkers"],
              }),
              ephemeralSession.clearCache(),
            ]);
          }
          this.sessionsByPartition.delete(partition);
        }
      }
      if (descriptor) this.emitInventoryChange(descriptor.workbenchSessionKey);
    };
    if (partition) {
      await this.runPartitionOperation(partition, release);
    } else {
      await release();
    }
  }

  async createTab(tabId: string, defaults?: DesktopPreviewTabDefaults): Promise<void> {
    await this.run((manager) => manager.createTab(tabId, defaults));
  }

  getPreviewConfig(tabId: string): DesktopPreviewWebviewConfig {
    const descriptor = this.descriptors.get(tabId);
    if (!descriptor) throw new Error(`Unknown browser surface ${tabId}`);
    return {
      partition: partitionForDescriptor(descriptor),
      webPreferences: PREVIEW_WEBVIEW_PREFERENCES,
      preloadUrl: pathToFileURL(this.options.pickPreloadPath).href,
    };
  }

  async closeTab(tabId: string): Promise<void> {
    await this.releaseSurface(tabId);
  }

  async registerWebview(
    event: IpcMainInvokeEvent,
    tabId: string,
    webContentsId: number,
  ): Promise<void> {
    const mainWindow = this.options.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
      throw new Error("Only the main Cozea renderer may register a browser surface.");
    }
    const descriptor = this.descriptors.get(tabId);
    if (!descriptor) throw new Error(`Unknown browser surface ${tabId}`);
    const guest = webContents.fromId(webContentsId);
    const partition = this.partitionsByScope.get(tabId);
    if (
      !guest ||
      guest.isDestroyed() ||
      guest.getType() !== "webview" ||
      guest.hostWebContents !== event.sender ||
      !partition ||
      guest.session !== this.sessionsByPartition.get(partition)
    ) {
      throw new Error("The supplied WebContents is not the prepared Cozea browser guest.");
    }

    await this.run((manager) => manager.registerWebview(tabId, webContentsId));
    this.attachCozeaListeners(tabId, guest, descriptor);
    const pendingOrgNavigation = this.pendingOrgNavigationByTabId.get(tabId);
    if (pendingOrgNavigation) {
      this.pendingOrgNavigationByTabId.delete(tabId);
      if (guest.getURL() !== pendingOrgNavigation) {
        await guest.loadURL(pendingOrgNavigation);
      }
    }
  }

  private attachCozeaListeners(
    tabId: string,
    guest: WebContents,
    descriptor: BrowserSurfaceDescriptor,
  ): void {
    this.detachCozeaListeners(tabId);
    let navigationGeneration = 0;
    let pendingHttpResponse: {
      readonly generation: number;
      readonly url: string;
      readonly statusCode: number;
      readonly statusText: string;
    } | null = null;

    const didStartNavigation = (
      _event: Event,
      url: string,
      _isInPlace: boolean,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) return;
      navigationGeneration += 1;
      pendingHttpResponse = null;
      this.updateExtendedState(tabId, {
        requestedUrl: url,
        httpDiagnostic: null,
      });
    };
    const didNavigate = (_event: Event, url: string, statusCode: number, statusText: string) => {
      if (statusCode < 400) {
        pendingHttpResponse = null;
        this.updateExtendedState(tabId, {
          requestedUrl: url,
          httpDiagnostic: null,
        });
        return;
      }
      pendingHttpResponse = {
        generation: navigationGeneration,
        url,
        statusCode,
        statusText,
      };
    };
    const didFinishLoad = () => {
      const response = pendingHttpResponse;
      if (!response) return;
      void this.classifyHttpError(
        guest,
        response.url,
        response.statusCode,
        response.statusText,
      ).then((diagnostic) => {
        if (
          pendingHttpResponse !== response ||
          navigationGeneration !== response.generation ||
          guest.isDestroyed() ||
          guest.getURL() !== response.url
        ) {
          return;
        }
        this.updateExtendedState(tabId, {
          requestedUrl: response.url,
          httpDiagnostic: diagnostic,
        });
      });
    };
    const foundInPage = (_event: Event, result: Electron.FoundInPageResult) => {
      const current = this.stateByTabId.get(tabId)?.find ?? EMPTY_FIND_STATE;
      this.updateExtendedState(tabId, {
        find: {
          ...current,
          activeMatchOrdinal: result.activeMatchOrdinal,
          matches: result.matches,
          finalUpdate: result.finalUpdate,
        },
      });
    };
    const willNavigate = (event: Event, url: string) => {
      if (this.isAllowedNavigation(descriptor, url)) return;
      event.preventDefault();
      if (descriptor.kind === "orgDevApp" && shouldOpenOrgSurfaceExternally(descriptor, url)) {
        void shell.openExternal(url);
      }
    };
    const destroyed = () => this.detachCozeaListeners(tabId);

    guest.on("did-start-navigation", didStartNavigation);
    guest.on("did-navigate", didNavigate);
    guest.on("did-finish-load", didFinishLoad);
    guest.on("found-in-page", foundInPage);
    guest.on("will-navigate", willNavigate);
    guest.on("destroyed", destroyed);
    guest.setWindowOpenHandler(({ url }) => {
      if (this.isAllowedNavigation(descriptor, url)) {
        void guest.loadURL(url).catch(() => undefined);
      } else if (
        descriptor.kind === "orgDevApp" &&
        shouldOpenOrgSurfaceExternally(descriptor, url)
      ) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });

    this.listenersByTabId.set(tabId, {
      webContents: guest,
      dispose: () => {
        if (guest.isDestroyed()) return;
        guest.off("did-start-navigation", didStartNavigation);
        guest.off("did-navigate", didNavigate);
        guest.off("did-finish-load", didFinishLoad);
        guest.off("found-in-page", foundInPage);
        guest.off("will-navigate", willNavigate);
        guest.off("destroyed", destroyed);
      },
    });
  }

  private detachCozeaListeners(tabId: string): void {
    const current = this.listenersByTabId.get(tabId);
    if (!current) return;
    current.dispose();
    this.listenersByTabId.delete(tabId);
  }

  private async classifyHttpError(
    guest: WebContents,
    url: string,
    statusCode: number,
    statusText: string,
  ): Promise<BrowserHttpDiagnostic | null> {
    let blank = false;
    try {
      blank = Boolean(
        await guest.executeJavaScript(
          `(() => { const body = document.body; if (!body) return true; return body.innerText.trim().length === 0 && body.children.length === 0; })()`,
          true,
        ),
      );
    } catch {
      return null;
    }
    const diagnostic: BrowserHttpDiagnostic | null = browserHttpDiagnosticForResponse({
      url,
      statusCode,
      statusText,
      blank,
    });
    return diagnostic;
  }

  private isAllowedNavigation(descriptor: BrowserSurfaceDescriptor, rawUrl: string): boolean {
    if (descriptor.kind !== "orgDevApp") return isHttpUrl(rawUrl);
    return evaluateOrgSurfaceNavigation(descriptor, rawUrl).allowed;
  }

  async navigate(tabId: string, url: string): Promise<void> {
    const descriptor = this.descriptors.get(tabId);
    if (!descriptor || !this.isAllowedNavigation(descriptor, url)) {
      throw new Error(`Navigation is not allowed for browser surface ${tabId}.`);
    }
    this.updateExtendedState(tabId, {
      requestedUrl: url,
      httpDiagnostic: null,
    });
    if (descriptor.kind === "orgDevApp") {
      const webContentsId = this.stateByTabId.get(tabId)?.webContentsId;
      const guest = webContentsId == null ? null : webContents.fromId(webContentsId);
      if (!guest || guest.isDestroyed()) {
        this.pendingOrgNavigationByTabId.set(tabId, url);
        return;
      }
      if (guest.getURL() === url) {
        guest.reload();
      } else {
        await guest.loadURL(url);
      }
      return;
    }
    await this.run((manager) => manager.navigate(tabId, url));
  }

  async goBack(tabId: string): Promise<void> {
    await this.run((manager) => manager.goBack(tabId));
  }

  async goForward(tabId: string): Promise<void> {
    await this.run((manager) => manager.goForward(tabId));
  }

  async refresh(tabId: string): Promise<void> {
    await this.run((manager) => manager.refresh(tabId));
  }

  async hardReload(tabId: string): Promise<void> {
    await this.run((manager) => manager.hardReload(tabId));
  }

  async zoomIn(tabId: string): Promise<void> {
    await this.run((manager) => manager.zoomIn(tabId));
  }

  async zoomOut(tabId: string): Promise<void> {
    await this.run((manager) => manager.zoomOut(tabId));
  }

  async resetZoom(tabId: string): Promise<void> {
    await this.run((manager) => manager.resetZoom(tabId));
  }

  async setColorScheme(tabId: string, colorScheme: DesktopPreviewColorScheme): Promise<void> {
    await this.run((manager) => manager.setColorScheme(tabId, colorScheme));
  }

  async setAudioMuted(tabId: string, audioMuted: boolean): Promise<void> {
    await this.run((manager) => manager.setAudioMuted(tabId, audioMuted));
  }

  async openDevTools(tabId: string): Promise<void> {
    await this.run((manager) => manager.openDevTools(tabId));
  }

  async clearCookies(): Promise<void> {
    await this.run((manager) => manager.clearCookies());
  }

  async clearCache(): Promise<void> {
    await this.run((manager) => manager.clearCache());
  }

  async setAnnotationTheme(theme: DesktopPreviewAnnotationTheme): Promise<void> {
    await this.run((manager) => manager.setAnnotationTheme(theme));
  }

  async pickElement(tabId: string): Promise<PreviewAnnotationSubmissionResult | null> {
    return await this.run((manager) => manager.pickElement(tabId));
  }

  async cancelPickElement(tabId: string): Promise<void> {
    await this.run((manager) => manager.cancelPickElement(tabId));
  }

  async captureScreenshot(tabId: string): Promise<DesktopPreviewScreenshotArtifact> {
    return await this.run((manager) => manager.captureScreenshot(tabId));
  }

  async revealArtifact(artifactPath: string): Promise<void> {
    await this.run((manager) => manager.revealArtifact(artifactPath));
  }

  async copyArtifactToClipboard(artifactPath: string): Promise<void> {
    await this.run((manager) => manager.copyArtifactToClipboard(artifactPath));
  }

  async openPictureInPicture(tabId: string): Promise<void> {
    await this.run((manager) => manager.openPictureInPicture(tabId));
  }

  async closePictureInPicture(tabId: string): Promise<void> {
    await this.run((manager) => manager.closePictureInPicture(tabId));
  }

  async startRecording(tabId: string): Promise<void> {
    await this.run((manager) => manager.startRecording(tabId));
  }

  async stopRecording(tabId: string): Promise<void> {
    await this.run((manager) => manager.stopRecording(tabId));
  }

  async saveRecording(
    tabId: string,
    mimeType: string,
    data: Uint8Array,
  ): Promise<DesktopPreviewRecordingArtifact> {
    return await this.run((manager) => manager.saveRecording(tabId, mimeType, data));
  }

  async automationStatus(tabId: string): Promise<PreviewAutomationStatus> {
    return await this.run((manager) => manager.automationStatus(tabId));
  }

  async automationSnapshot(tabId: string): Promise<PreviewAutomationSnapshot> {
    return await this.run((manager) => manager.automationSnapshot(tabId));
  }

  async automationClick(tabId: string, input: PreviewAutomationClickInput): Promise<void> {
    await this.run((manager) => manager.automationClick(tabId, input));
  }

  async automationType(tabId: string, input: PreviewAutomationTypeInput): Promise<void> {
    await this.run((manager) => manager.automationType(tabId, input));
  }

  async automationPress(tabId: string, input: PreviewAutomationPressInput): Promise<void> {
    await this.run((manager) => manager.automationPress(tabId, input));
  }

  async automationScroll(tabId: string, input: PreviewAutomationScrollInput): Promise<void> {
    await this.run((manager) => manager.automationScroll(tabId, input));
  }

  async automationEvaluate(tabId: string, input: PreviewAutomationEvaluateInput): Promise<unknown> {
    return await this.run((manager) => manager.automationEvaluate(tabId, input));
  }

  async automationWaitFor(tabId: string, input: PreviewAutomationWaitForInput): Promise<void> {
    await this.run((manager) => manager.automationWaitFor(tabId, input));
  }

  async findInPage(
    tabId: string,
    query: string,
    options: BrowserFindInPageOptions = {},
  ): Promise<void> {
    const state = this.stateByTabId.get(tabId);
    const guest = state?.webContentsId ? webContents.fromId(state.webContentsId) : null;
    if (!guest || guest.isDestroyed()) throw new Error(`Browser surface ${tabId} is not attached.`);
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      await this.stopFindInPage(tabId, "clearSelection");
      return;
    }
    const nextFind: BrowserFindState = {
      ...(state?.find ?? EMPTY_FIND_STATE),
      query: normalizedQuery,
      visible: true,
      matchCase: options.matchCase ?? false,
      finalUpdate: false,
    };
    this.updateExtendedState(tabId, { find: nextFind });
    guest.findInPage(normalizedQuery, {
      forward: options.forward ?? true,
      findNext: options.findNext ?? false,
      matchCase: options.matchCase ?? false,
    });
  }

  async stopFindInPage(
    tabId: string,
    action: "clearSelection" | "keepSelection" | "activateSelection" = "keepSelection",
  ): Promise<void> {
    const state = this.stateByTabId.get(tabId);
    const guest = state?.webContentsId ? webContents.fromId(state.webContentsId) : null;
    if (guest && !guest.isDestroyed()) guest.stopFindInPage(action);
    this.updateExtendedState(tabId, {
      find: { ...EMPTY_FIND_STATE, visible: false },
    });
  }

  getSurfaceState(tabId: string): CozeaBrowserSurfaceState | null {
    return this.stateByTabId.get(tabId) ?? null;
  }

  listSurfaces(): BrowserSurfaceInventoryEntry[] {
    return Array.from(this.stateByTabId.entries(), ([runtimeTabId, state]) => ({
      runtimeTabId,
      tileId: state.descriptor.tileId,
      workbenchSessionKey: state.descriptor.workbenchSessionKey,
      kind: state.descriptor.kind,
      title: state.navStatus.kind === "Idle" ? state.descriptor.title : state.navStatus.title,
      url: navUrl(state),
      active: this.activeByTabId.get(runtimeTabId) ?? false,
      controller: state.controller,
    }));
  }

  hasSurfaceForWorkbenchSession(workbenchSessionKey: string): boolean {
    return Array.from(this.descriptors.values()).some(
      (descriptor) => descriptor.workbenchSessionKey === workbenchSessionKey,
    );
  }

  async releaseSurfacesForWorkbenchSession(workbenchSessionKey: string): Promise<void> {
    const tabIds = Array.from(this.descriptors.entries())
      .filter(([, descriptor]) => descriptor.workbenchSessionKey === workbenchSessionKey)
      .map(([tabId]) => tabId);
    await Promise.all(tabIds.map((tabId) => this.releaseSurface(tabId)));
  }

  private emitInventoryChange(workbenchSessionKey: string): void {
    for (const listener of this.inventoryListeners) listener(workbenchSessionKey);
  }

  onInventoryChange(listener: (workbenchSessionKey: string) => void): () => void {
    this.inventoryListeners.add(listener);
    return () => this.inventoryListeners.delete(listener);
  }

  setSurfaceActive(tabId: string, active: boolean): void {
    if (!this.descriptors.has(tabId)) return;
    this.activeByTabId.set(tabId, active);
  }

  onStateChange(listener: (tabId: string, state: CozeaBrowserSurfaceState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onPointerEvent(
    listener: (event: import("@cozea/contracts/t3/ipc").DesktopPreviewPointerEvent) => void,
  ): () => void {
    this.pointerListeners.add(listener);
    return () => this.pointerListeners.delete(listener);
  }

  onRecordingFrame(
    listener: (frame: import("@cozea/contracts/t3/ipc").DesktopPreviewRecordingFrame) => void,
  ): () => void {
    this.recordingFrameListeners.add(listener);
    return () => this.recordingFrameListeners.delete(listener);
  }

  async dispose(): Promise<void> {
    for (const tabId of Array.from(this.descriptors.keys())) {
      try {
        await this.releaseSurface(tabId);
      } catch {
        // Continue disposing the remaining guests.
      }
    }
    for (const fiber of [
      this.stateSubscriptionFiber,
      this.pointerSubscriptionFiber,
      this.recordingSubscriptionFiber,
    ]) {
      if (fiber) await this.runtime.runPromise(T3Fiber.interrupt(fiber));
    }
    await this.runtime.dispose();
  }
}
