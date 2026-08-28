import type { IpcMain, Rectangle } from 'electron'

import { WorkbenchBrowserService } from '../services/WorkbenchBrowserService'
import type { WorkbenchBrowserViewState } from '../../../../shared/electronApiTypes'
import type {
  BrowserFindInPageOptions,
  BrowserStorageScope,
} from '../../../../shared/browserHostTypes'
import type {
  DevServerPreviewActionResult,
  DevServerPreviewClickInput,
  DevServerPreviewElement,
  DevServerPreviewScrollInput,
  DevServerPreviewSnapshotResult,
  DevServerPreviewTypeInput,
  DevServerPreviewWaitForInput,
} from '../../../../shared/devServerPreviewAutomationTypes'
import { buildSnapshotScript } from '../browser-automation/pageScripts'
import {
  buildDevServerPreviewClickScript,
  buildDevServerPreviewScrollScript,
  buildDevServerPreviewTypeScript,
  buildDevServerPreviewWaitForScript,
} from '../browser-automation/devServerPreviewPageScripts'

interface RegisterWorkbenchBrowserHandlersDeps {
  service: WorkbenchBrowserService
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function asActionResult(value: unknown): DevServerPreviewActionResult {
  const record = asRecord(value)
  if (!record || typeof record.ok !== 'boolean') {
    return { ok: false, message: 'Preview action returned an unexpected result.' }
  }
  const error =
    record.error === 'not_found' ||
    record.error === 'not_editable' ||
    record.error === 'invalid_selector' ||
    record.error === 'timeout'
      ? record.error
      : undefined
  return {
    ok: record.ok,
    ...(error ? { error } : {}),
    ...(typeof record.message === 'string' ? { message: record.message } : {}),
  }
}

function asPreviewElements(value: unknown): DevServerPreviewElement[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const record = asRecord(item)
    if (!record) return []
    return [{
      tag: typeof record.tag === 'string' ? record.tag : 'unknown',
      role: typeof record.role === 'string' ? record.role : null,
      name: typeof record.name === 'string' ? record.name : '',
      selector: typeof record.selector === 'string' ? record.selector : '',
      x: typeof record.x === 'number' ? record.x : 0,
      y: typeof record.y === 'number' ? record.y : 0,
      width: typeof record.width === 'number' ? record.width : 0,
      height: typeof record.height === 'number' ? record.height : 0,
    }]
  })
}

export function registerWorkbenchBrowserHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkbenchBrowserHandlersDeps,
): void {
  const { service } = deps

  ipcMain.handle(
    'workbenchBrowser:ensureTile',
    async (
      _event,
      options: {
        tileId: string
        initialUrl?: string
        storageScope?: BrowserStorageScope
        workspaceId?: string
        partitionKey?: string
        navigationPolicy?: 'open' | 'orgDevApp'
      },
    ): Promise<WorkbenchBrowserViewState> => {
      return service.ensureTile(options.tileId, {
        initialUrl: options.initialUrl,
        storageScope: options.storageScope,
        workspaceId: options.workspaceId,
        partitionKey: options.partitionKey,
        navigationPolicy: options.navigationPolicy,
      })
    },
  )

  ipcMain.handle(
    'workbenchBrowser:destroyTile',
    (_event, options: { tileId: string }): boolean => {
      return service.destroyTile(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:setBounds',
    (
      _event,
      options: { tileId: string; bounds?: Rectangle; visible?: boolean },
    ): boolean => {
      return service.setBounds(options.tileId, options.bounds ?? null, Boolean(options.visible))
    },
  )

  ipcMain.handle(
    'workbenchBrowser:navigate',
    async (
      _event,
      options: { tileId: string; url: string },
    ): Promise<WorkbenchBrowserViewState | null> => {
      return service.navigate(options.tileId, options.url)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:getState',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.getState(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:getViewBounds',
    (_event, options: { tileId: string }): { bounds: Rectangle; visible: boolean } | null => {
      return service.getViewBounds(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:goBack',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.goBack(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:goForward',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.goForward(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:reload',
    (_event, options: { tileId: string; hard?: boolean }): WorkbenchBrowserViewState | null => {
      return service.reload(options.tileId, options.hard)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:focus',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.focus(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:toggleDevTools',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.toggleDevTools(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:openExternal',
    async (_event, options: { tileId: string }) => {
      return service.openExternal(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:zoomIn',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.zoomIn(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:zoomOut',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.zoomOut(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:resetZoom',
    (_event, options: { tileId: string }): WorkbenchBrowserViewState | null => {
      return service.resetZoom(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:findInPage',
    (
      _event,
      options: { tileId: string; text: string } & BrowserFindInPageOptions,
    ): WorkbenchBrowserViewState | null => {
      return service.findInPage(options.tileId, options.text, options)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:stopFindInPage',
    (
      _event,
      options: { tileId: string; keepSelection?: boolean },
    ): WorkbenchBrowserViewState | null => {
      return service.stopFindInPage(options.tileId, options.keepSelection)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:getSelectedText',
    (_event, options: { tileId: string }): string => {
      return service.getSelectedText(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:captureScreenshot',
    async (_event, options: { tileId: string }): Promise<string | null> => {
      return service.captureScreenshot(options.tileId)
    },
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewSnapshot',
    async (_event, options: { tileId: string }): Promise<DevServerPreviewSnapshotResult | null> => {
      const state = service.getState(options.tileId)
      if (!state) return null
      const page = asRecord(await service.executeJavaScript(options.tileId, buildSnapshotScript()))
      const screenshot = await service.capturePngScreenshot(options.tileId)
      if (!page || !screenshot) return null
      const interactiveElements = asPreviewElements(page.interactiveElements)
      return {
        url: typeof page.url === 'string' ? page.url : state.url,
        title: typeof page.title === 'string' ? page.title : state.title,
        loading: state.isLoading,
        visibleText: typeof page.visibleText === 'string' ? page.visibleText : '',
        interactiveElements,
        accessibilityTree: {
          role: 'document',
          name: typeof page.title === 'string' ? page.title : state.title,
          children: interactiveElements.map((element) => ({
            role: element.role,
            name: element.name,
          })),
        },
        screenshot: {
          mimeType: 'image/png',
          ...screenshot,
        },
      }
    },
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewClick',
    async (_event, options: DevServerPreviewClickInput): Promise<DevServerPreviewActionResult> => {
      if (Number.isFinite(options.x) && Number.isFinite(options.y)) {
        return service.sendAutomationClick(options.tileId, options.x!, options.y!)
          ? { ok: true }
          : { ok: false, error: 'not_found', message: 'Dev Server preview is not open.' }
      }
      return asActionResult(await service.executeJavaScript(
        options.tileId,
        buildDevServerPreviewClickScript(options),
      ))
    },
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewType',
    async (_event, options: DevServerPreviewTypeInput): Promise<DevServerPreviewActionResult> =>
      asActionResult(await service.executeJavaScript(
        options.tileId,
        buildDevServerPreviewTypeScript(options),
      )),
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewPress',
    async (
      _event,
      options: {
        tileId: string
        key: string
        modifiers?: Array<'Alt' | 'Control' | 'Meta' | 'Shift'>
      },
    ): Promise<DevServerPreviewActionResult> =>
      service.sendAutomationKey(options.tileId, options.key, options.modifiers)
        ? { ok: true }
        : { ok: false, error: 'not_found', message: 'Dev Server preview is not open.' },
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewScroll',
    async (_event, options: DevServerPreviewScrollInput): Promise<DevServerPreviewActionResult> =>
      asActionResult(await service.executeJavaScript(
        options.tileId,
        buildDevServerPreviewScrollScript(options),
      )),
  )

  ipcMain.handle(
    'workbenchBrowser:devServerPreviewWaitFor',
    async (_event, options: DevServerPreviewWaitForInput): Promise<DevServerPreviewActionResult> =>
      asActionResult(await service.executeJavaScript(
        options.tileId,
        buildDevServerPreviewWaitForScript(options),
      )),
  )
}
