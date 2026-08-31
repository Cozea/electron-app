import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron";

import { BROWSER_SURFACE_IPC } from "../../../../shared/browserSurfaceIpc";
import type {
  BrowserFindInPageOptions,
  BrowserSurfaceDescriptor,
} from "../../../../shared/browserSurfaceTypes";
import type {
  DesktopPreviewAnnotationTheme,
  DesktopPreviewColorScheme,
  DesktopPreviewTabDefaults,
} from "@cozea/contracts/t3/ipc";
import type {
  PreviewAutomationClickInput,
  PreviewAutomationEvaluateInput,
  PreviewAutomationPressInput,
  PreviewAutomationScrollInput,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "@cozea/contracts/t3/previewAutomation";
import type { T3BrowserSurfaceService } from "../services/T3BrowserSurfaceService";

interface BrowserSurfaceHandlerOptions {
  service: T3BrowserSurfaceService;
  getMainWindow: () => BrowserWindow | null;
}

function assertMainRenderer(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error("Browser surface IPC is restricted to the main Cozea renderer.");
  }
}

export function registerBrowserSurfaceHandlers(
  ipcMain: IpcMain,
  options: BrowserSurfaceHandlerOptions,
): () => void {
  const { service } = options;
  const handles: Array<[string, (event: IpcMainInvokeEvent, payload?: never) => unknown]> = [];
  const handle = <Payload, Result>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, payload: Payload) => Result | Promise<Result>,
  ): void => {
    const wrapped = (event: IpcMainInvokeEvent, payload: Payload) => {
      assertMainRenderer(event, options.getMainWindow);
      return listener(event, payload);
    };
    ipcMain.handle(channel, wrapped);
    handles.push([channel, wrapped as (event: IpcMainInvokeEvent, payload?: never) => unknown]);
  };

  handle(BROWSER_SURFACE_IPC.prepareSurface, (_event, descriptor: BrowserSurfaceDescriptor) =>
    service.prepareSurface(descriptor),
  );
  handle(BROWSER_SURFACE_IPC.releaseSurface, (_event, tabId: string) =>
    service.releaseSurface(tabId),
  );
  handle(BROWSER_SURFACE_IPC.getSurfaceState, (_event, tabId: string) =>
    service.getSurfaceState(tabId),
  );
  handle(BROWSER_SURFACE_IPC.listSurfaces, () => service.listSurfaces());
  handle(
    BROWSER_SURFACE_IPC.setSurfaceActive,
    (_event, payload: { tabId: string; active: boolean }) =>
      service.setSurfaceActive(payload.tabId, payload.active),
  );
  handle(
    BROWSER_SURFACE_IPC.findInPage,
    (_event, payload: { tabId: string; query: string; options?: BrowserFindInPageOptions }) =>
      service.findInPage(payload.tabId, payload.query, payload.options),
  );
  handle(
    BROWSER_SURFACE_IPC.stopFindInPage,
    (
      _event,
      payload: {
        tabId: string;
        action?: "clearSelection" | "keepSelection" | "activateSelection";
      },
    ) => service.stopFindInPage(payload.tabId, payload.action),
  );
  handle(
    BROWSER_SURFACE_IPC.createTab,
    (_event, payload: { tabId: string; defaults?: DesktopPreviewTabDefaults }) =>
      service.createTab(payload.tabId, payload.defaults),
  );
  handle(BROWSER_SURFACE_IPC.closeTab, (_event, tabId: string) => service.closeTab(tabId));
  handle(
    BROWSER_SURFACE_IPC.registerWebview,
    (event, payload: { tabId: string; webContentsId: number }) =>
      service.registerWebview(event, payload.tabId, payload.webContentsId),
  );
  handle(BROWSER_SURFACE_IPC.navigate, (_event, payload: { tabId: string; url: string }) =>
    service.navigate(payload.tabId, payload.url),
  );

  const tabMethod = (channel: string, method: (tabId: string) => Promise<void>): void => {
    handle(channel, (_event, tabId: string) => method(tabId));
  };
  tabMethod(BROWSER_SURFACE_IPC.goBack, (tabId) => service.goBack(tabId));
  tabMethod(BROWSER_SURFACE_IPC.goForward, (tabId) => service.goForward(tabId));
  tabMethod(BROWSER_SURFACE_IPC.refresh, (tabId) => service.refresh(tabId));
  tabMethod(BROWSER_SURFACE_IPC.zoomIn, (tabId) => service.zoomIn(tabId));
  tabMethod(BROWSER_SURFACE_IPC.zoomOut, (tabId) => service.zoomOut(tabId));
  tabMethod(BROWSER_SURFACE_IPC.resetZoom, (tabId) => service.resetZoom(tabId));
  tabMethod(BROWSER_SURFACE_IPC.hardReload, (tabId) => service.hardReload(tabId));
  tabMethod(BROWSER_SURFACE_IPC.openDevTools, (tabId) => service.openDevTools(tabId));
  tabMethod(BROWSER_SURFACE_IPC.cancelPickElement, (tabId) => service.cancelPickElement(tabId));
  tabMethod(BROWSER_SURFACE_IPC.pictureInPictureOpen, (tabId) =>
    service.openPictureInPicture(tabId),
  );
  tabMethod(BROWSER_SURFACE_IPC.pictureInPictureClose, (tabId) =>
    service.closePictureInPicture(tabId),
  );
  tabMethod(BROWSER_SURFACE_IPC.recordingStart, (tabId) => service.startRecording(tabId));
  tabMethod(BROWSER_SURFACE_IPC.recordingStop, (tabId) => service.stopRecording(tabId));

  handle(
    BROWSER_SURFACE_IPC.setColorScheme,
    (_event, payload: { tabId: string; colorScheme: DesktopPreviewColorScheme }) =>
      service.setColorScheme(payload.tabId, payload.colorScheme),
  );
  handle(
    BROWSER_SURFACE_IPC.setAudioMuted,
    (_event, payload: { tabId: string; audioMuted: boolean }) =>
      service.setAudioMuted(payload.tabId, payload.audioMuted),
  );
  handle(BROWSER_SURFACE_IPC.clearCookies, () => service.clearCookies());
  handle(BROWSER_SURFACE_IPC.clearCache, () => service.clearCache());
  handle(BROWSER_SURFACE_IPC.getPreviewConfig, (_event, tabId: string) =>
    service.getPreviewConfig(tabId),
  );
  handle(BROWSER_SURFACE_IPC.setAnnotationTheme, (_event, theme: DesktopPreviewAnnotationTheme) =>
    service.setAnnotationTheme(theme),
  );
  handle(BROWSER_SURFACE_IPC.pickElement, (_event, tabId: string) => service.pickElement(tabId));
  handle(BROWSER_SURFACE_IPC.captureScreenshot, (_event, tabId: string) =>
    service.captureScreenshot(tabId),
  );
  handle(BROWSER_SURFACE_IPC.revealArtifact, (_event, artifactPath: string) =>
    service.revealArtifact(artifactPath),
  );
  handle(BROWSER_SURFACE_IPC.copyArtifactToClipboard, (_event, artifactPath: string) =>
    service.copyArtifactToClipboard(artifactPath),
  );
  handle(
    BROWSER_SURFACE_IPC.recordingSave,
    (_event, payload: { tabId: string; mimeType: string; data: Uint8Array }) =>
      service.saveRecording(payload.tabId, payload.mimeType, payload.data),
  );
  handle(BROWSER_SURFACE_IPC.automationStatus, (_event, tabId: string) =>
    service.automationStatus(tabId),
  );
  handle(BROWSER_SURFACE_IPC.automationSnapshot, (_event, tabId: string) =>
    service.automationSnapshot(tabId),
  );
  handle(
    BROWSER_SURFACE_IPC.automationClick,
    (_event, payload: { tabId: string; input: PreviewAutomationClickInput }) =>
      service.automationClick(payload.tabId, payload.input),
  );
  handle(
    BROWSER_SURFACE_IPC.automationType,
    (_event, payload: { tabId: string; input: PreviewAutomationTypeInput }) =>
      service.automationType(payload.tabId, payload.input),
  );
  handle(
    BROWSER_SURFACE_IPC.automationPress,
    (_event, payload: { tabId: string; input: PreviewAutomationPressInput }) =>
      service.automationPress(payload.tabId, payload.input),
  );
  handle(
    BROWSER_SURFACE_IPC.automationScroll,
    (_event, payload: { tabId: string; input: PreviewAutomationScrollInput }) =>
      service.automationScroll(payload.tabId, payload.input),
  );
  handle(
    BROWSER_SURFACE_IPC.automationEvaluate,
    (_event, payload: { tabId: string; input: PreviewAutomationEvaluateInput }) =>
      service.automationEvaluate(payload.tabId, payload.input),
  );
  handle(
    BROWSER_SURFACE_IPC.automationWaitFor,
    (_event, payload: { tabId: string; input: PreviewAutomationWaitForInput }) =>
      service.automationWaitFor(payload.tabId, payload.input),
  );

  const removeStateListener = service.onStateChange((tabId, state) => {
    const window = options.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(BROWSER_SURFACE_IPC.stateChanged, tabId, state);
    }
  });
  const removePointerListener = service.onPointerEvent((event) => {
    const window = options.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(BROWSER_SURFACE_IPC.pointerEvent, event);
    }
  });
  const removeRecordingListener = service.onRecordingFrame((frame) => {
    const window = options.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(BROWSER_SURFACE_IPC.recordingFrame, frame);
    }
  });

  return () => {
    removeStateListener();
    removePointerListener();
    removeRecordingListener();
    for (const [channel] of handles) ipcMain.removeHandler(channel);
  };
}
