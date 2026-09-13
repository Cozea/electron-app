import type {
  DesktopPreviewAnnotationTheme,
  DesktopPreviewBridge,
  DesktopPreviewColorScheme,
  DesktopPreviewPointerEvent,
  DesktopPreviewRecordingFrame,
  DesktopPreviewTabDefaults,
  DesktopPreviewTabState,
  DesktopPreviewWebviewConfig,
} from "@cozea/contracts/t3/ipc";
import type { BrowserStorageScope } from "./browserTileTypes"
import type { BrowserSurfaceBounds } from "./browserSurfaceLayout";

export type BrowserSurfaceKind =
  | "browser"
  | "devServer"
  | "projectDevApp"
  | "orgDevApp"
  /** An unpublished package being developed on this machine. Never shares a published app's session. */
  | "devAppPreview";

export interface BrowserSurfaceDescriptor {
  runtimeTabId: string;
  tileId: string;
  workbenchSessionKey: string;
  kind: BrowserSurfaceKind;
  title: string;
  initialUrl: string | null;
  storageScope: BrowserStorageScope;
  workspaceId?: string | null;
  laneId?: string | null;
  publicationId?: string | null;
  organizationId?: string | null;
  contentHash?: string | null;
  runtimeKind?: "static" | "service" | null;
  runtimeGeneration?: string | number | null;
  /** Opaque id of the development source, for a preview surface. */
  devSourceId?: string | null;
}

export interface BrowserFindState {
  query: string;
  visible: boolean;
  matchCase: boolean;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export interface BrowserHttpDiagnostic {
  url: string;
  statusCode: number;
  statusText: string;
  blank: boolean;
}

export interface CozeaBrowserSurfaceState extends DesktopPreviewTabState {
  descriptor: BrowserSurfaceDescriptor;
  requestedUrl: string | null;
  find: BrowserFindState;
  httpDiagnostic: BrowserHttpDiagnostic | null;
}

export interface PreparedBrowserSurface {
  config: DesktopPreviewWebviewConfig;
  state: CozeaBrowserSurfaceState;
}

export interface BrowserSurfaceInventoryEntry {
  runtimeTabId: string;
  tileId: string;
  workbenchSessionKey: string;
  kind: BrowserSurfaceKind;
  title: string;
  url: string | null;
  active: boolean;
  controller: "human" | "agent" | "none";
}

export interface BrowserFindInPageOptions {
  forward?: boolean;
  findNext?: boolean;
  matchCase?: boolean;
}

/**
 * A still of a native surface, shown in its DOM slot while application UI has
 * taken the live view off screen (INV-009). Main owns the contents and takes
 * the capture; the renderer only ever displays it.
 */
export interface BrowserSurfacePlaceholder {
  readonly dataUrl: string;
  readonly capturedAt: number;
}

export interface CozeaDesktopPreviewBridge extends Omit<DesktopPreviewBridge, "clearCookies" | "clearCache" | "listBrowserImportSources" | "importBrowserCookies"> {
  /**
   * Native surface layout. A surface is named only by its runtime tab id: the
   * renderer never receives or supplies a WebContents id, so it cannot point
   * main at contents main did not create.
   */
  ensureNativeSurface: (tabId: string) => Promise<void>
  releaseNativeSurface: (tabId: string) => Promise<void>
  layoutNativeSurface: (tabId: string, bounds: BrowserSurfaceBounds) => Promise<void>
  setNativeSurfaceVisible: (tabId: string, visible: boolean) => Promise<void>
  /** Occluding resolves with a fresh still of what the user was looking at. */
  setNativeSurfaceOccluded: (
    tabId: string,
    occluded: boolean,
  ) => Promise<BrowserSurfacePlaceholder | null>
  captureNativeSurfacePlaceholder: (tabId: string) => Promise<BrowserSurfacePlaceholder | null>
  setNativeSurfaceOrder: (orderedTabIds: ReadonlyArray<string>) => Promise<void>
  focusNativeSurface: (tabId: string) => Promise<void>
  /** Cozea has one local host and owns partition scope in the main process. */
  clearCookies: () => Promise<void>;
  clearCache: () => Promise<void>;
  prepareSurface: (descriptor: BrowserSurfaceDescriptor) => Promise<PreparedBrowserSurface>;
  releaseSurface: (runtimeTabId: string) => Promise<void>;
  getSurfaceState: (runtimeTabId: string) => Promise<CozeaBrowserSurfaceState | null>;
  listSurfaces: () => Promise<BrowserSurfaceInventoryEntry[]>;
  setSurfaceActive: (runtimeTabId: string, active: boolean) => Promise<void>;
  findInPage: (
    runtimeTabId: string,
    query: string,
    options?: BrowserFindInPageOptions,
  ) => Promise<void>;
  stopFindInPage: (
    runtimeTabId: string,
    action?: "clearSelection" | "keepSelection" | "activateSelection",
  ) => Promise<void>;
  onSurfaceStateChange: (
    listener: (runtimeTabId: string, state: CozeaBrowserSurfaceState) => void,
  ) => () => void;
  onPointerEvent: (listener: (event: DesktopPreviewPointerEvent) => void) => () => void;
  /**
   * Keyboard focus entering or leaving a native surface. Chromium moves focus
   * between views on a click without any DOM event reaching the renderer, so
   * main is the only party that can see it.
   */
  onNativeSurfaceFocusChange: (
    listener: (runtimeTabId: string, focused: boolean) => void,
  ) => () => void;
  recording: DesktopPreviewBridge["recording"] & {
    onFrame: (listener: (frame: DesktopPreviewRecordingFrame) => void) => () => void;
  };
  createTab: (tabId: string, defaults?: DesktopPreviewTabDefaults) => Promise<void>;
  setColorScheme: (tabId: string, colorScheme: DesktopPreviewColorScheme) => Promise<void>;
  setAnnotationTheme: (theme: DesktopPreviewAnnotationTheme) => Promise<void>;
}
