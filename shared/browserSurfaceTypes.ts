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
import type { BrowserStorageScope } from "./browserTileTypes";

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

export interface CozeaDesktopPreviewBridge extends DesktopPreviewBridge {
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
  recording: DesktopPreviewBridge["recording"] & {
    onFrame: (listener: (frame: DesktopPreviewRecordingFrame) => void) => () => void;
  };
  createTab: (tabId: string, defaults?: DesktopPreviewTabDefaults) => Promise<void>;
  setColorScheme: (tabId: string, colorScheme: DesktopPreviewColorScheme) => Promise<void>;
  setAnnotationTheme: (theme: DesktopPreviewAnnotationTheme) => Promise<void>;
}
