import { BrowserWindow, type IpcMain, type WebFrameMain } from 'electron'

import { BRIDGE_SCRIPT } from '../../shared/previewBridgeScript'
import type {
  PreviewCaptureScreenshotResult,
  PreviewFailureReason,
  PreviewHeaderDiagnostic,
  PreviewInjectBridgeResult,
  PreviewProbeUrlResult,
} from '../../shared/electronApiTypes'

interface RegisterPreviewHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  getLatestPreviewHeaderDiagnostic?: (url: string) => PreviewHeaderDiagnostic | null
}

function isExpectedPreviewConnectivityError(message: string): boolean {
  return (
    message.includes('ERR_CONNECTION_REFUSED') ||
    message.includes('ERR_CONNECTION_RESET') ||
    message.includes('ERR_NETWORK_CHANGED')
  )
}

async function loadUrlForCapture(
  targetWindow: BrowserWindow,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      targetWindow.webContents.removeListener('did-finish-load', onFinishLoad)
      targetWindow.webContents.removeListener('did-fail-load', onFailLoad)
      callback()
    }

    const onFinishLoad = () => {
      finish(resolve)
    }

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame) return
      finish(() => reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`)))
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Page load timeout')))
    }, timeoutMs)

    targetWindow.webContents.on('did-finish-load', onFinishLoad)
    targetWindow.webContents.on('did-fail-load', onFailLoad)

    void targetWindow.loadURL(targetUrl).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      finish(() => reject(err))
    })
  })
}

function isAllowedPreviewUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

function isChromiumErrorDocumentUrl(url: string): boolean {
  return url.startsWith('chrome-error://')
}

function classifyPreviewFailure(message: string): {
  reason: PreviewFailureReason
  likelyBlocked: boolean
} {
  const normalized = message.toLowerCase()
  if (normalized.includes('err_blocked_by_response') || normalized.includes('blocked by response')) {
    return { reason: 'blocked_response', likelyBlocked: true }
  }
  if (normalized.includes('chrome-error://')) {
    return { reason: 'chrome_error_document', likelyBlocked: true }
  }
  if (normalized.includes('x-frame-options') || normalized.includes('frame-ancestors')) {
    return { reason: 'blocked_response', likelyBlocked: true }
  }
  if (normalized.includes('frame not found')) {
    return { reason: 'frame_not_found', likelyBlocked: false }
  }
  if (normalized.includes('err_network_changed')) {
    return { reason: 'network_quality_degraded', likelyBlocked: false }
  }
  if (
    normalized.includes('err_connection_refused') ||
    normalized.includes('err_connection_reset') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('timeout')
  ) {
    return { reason: 'server_unreachable', likelyBlocked: false }
  }
  return { reason: 'bridge_injection_failed', likelyBlocked: false }
}

async function getFrameLocationHref(frame: WebFrameMain): Promise<string | null> {
  try {
    const href = await frame.executeJavaScript('window.location.href')
    return typeof href === 'string' ? href : null
  } catch {
    return null
  }
}

function summarizePreviewFrames(
  getMainWindow: () => BrowserWindow | null,
  maxFrames = 12
): Array<{
  name: string
  url: string
  frameTreeNodeId: number
  routingId: number
}> {
  const win = getMainWindow()
  if (!win) return []
  return win.webContents.mainFrame.frames
    .filter((frame) => frame !== win.webContents.mainFrame)
    .slice(0, maxFrames)
    .map((frame) => ({
      name: frame.name || '(unnamed)',
      url: frame.url,
      frameTreeNodeId: frame.frameTreeNodeId,
      routingId: frame.routingId,
    }))
}

function getHeaderDiagnostic(
  deps: RegisterPreviewHandlersDeps,
  url: string
): PreviewHeaderDiagnostic | null {
  return deps.getLatestPreviewHeaderDiagnostic ? deps.getLatestPreviewHeaderDiagnostic(url) : null
}

async function findFrameByUrl(
  getMainWindow: () => BrowserWindow | null,
  targetUrl: string,
  options?: { attempts?: number; delayMs?: number; frameName?: string }
): Promise<WebFrameMain | null> {
  const attempts = options?.attempts ?? 15
  const delayMs = options?.delayMs ?? 50
  const frameName = options?.frameName?.trim() || null

  const win = getMainWindow()
  if (!win) return null

  let targetOrigin: string | null = null
  try {
    targetOrigin = new URL(targetUrl).origin
  } catch {
    targetOrigin = null
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const frames = win.webContents.mainFrame.frames.filter((frame) => frame !== win.webContents.mainFrame)
    const namedFrames = frameName ? frames.filter((frame) => frame.name === frameName) : frames
    const candidates = frameName ? namedFrames : frames

    if (frameName && candidates.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    const exact = candidates.find((frame) => frame.url === targetUrl)
    if (exact) return exact

    if (targetOrigin) {
      const sameOrigin = candidates.find((frame) => {
        try {
          return new URL(frame.url).origin === targetOrigin
        } catch {
          return false
        }
      })
      if (sameOrigin) return sameOrigin
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return null
}

export function registerPreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterPreviewHandlersDeps
): void {
  // Inject the preview bridge into the project's dev-server iframe (cross-origin safe via WebFrameMain)
  ipcMain.handle(
    'preview:injectBridge',
    async (
      _event,
      { url, frameName }: { url: string; frameName?: string }
    ): Promise<PreviewInjectBridgeResult> => {
      try {
        console.log('[PreviewBridge][Main] Injection requested', {
          url,
          frameName: frameName || '(none)',
        })

        const win = deps.getMainWindow()
        if (!win) {
          return {
            success: false,
            error: 'No window available',
            reason: 'window_unavailable',
            likelyBlocked: false,
            headerDiagnostic: typeof url === 'string' ? getHeaderDiagnostic(deps, url) : null,
          }
        }
        if (!url || typeof url !== 'string') {
          return {
            success: false,
            error: 'Missing url',
            reason: 'invalid_url',
            likelyBlocked: false,
            headerDiagnostic: null,
          }
        }

        let parsedUrl: URL
        try {
          parsedUrl = new URL(url)
        } catch {
          return {
            success: false,
            error: 'Invalid url',
            reason: 'invalid_url',
            likelyBlocked: false,
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        if (!isAllowedPreviewUrl(parsedUrl)) {
          return {
            success: false,
            error: 'Only localhost preview URLs are supported',
            reason: 'unsupported_origin',
            likelyBlocked: false,
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        try {
          const mainUrl = win.webContents.getURL()
          const mainOrigin = new URL(mainUrl).origin
          if (mainOrigin === parsedUrl.origin) {
            return {
              success: false,
              error: 'Refusing to inject into main frame origin',
              reason: 'unsupported_origin',
              likelyBlocked: false,
              headerDiagnostic: getHeaderDiagnostic(deps, url),
            }
          }
        } catch {
          // Ignore parse errors (e.g. about:blank during startup)
        }

        const frame = await findFrameByUrl(deps.getMainWindow, url, { frameName })
        if (!frame) {
          const availableFrames = summarizePreviewFrames(deps.getMainWindow)
          console.warn('[PreviewBridge][Main] Frame not found for injection', {
            url,
            frameName: frameName || '(none)',
            availableFrames,
          })
          return {
            success: false,
            error: 'Preview frame not found',
            reason: 'frame_not_found',
            likelyBlocked: false,
            frame: {
              requestedFrameName: frameName,
              availableFrames,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        const frameHref = await getFrameLocationHref(frame)
        if (frameHref && isChromiumErrorDocumentUrl(frameHref)) {
          console.warn('[PreviewBridge][Main] Refusing injection into Chromium error document', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            frameHref,
          })
          return {
            success: false,
            error: 'Preview frame resolved to Chromium error document (ERR_BLOCKED_BY_RESPONSE)',
            reason: 'chrome_error_document',
            likelyBlocked: true,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameHref,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }

        try {
          console.log('[PreviewBridge][Main] Matched frame', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            frameTreeNodeId: frame.frameTreeNodeId,
            routingId: frame.routingId,
          })

          await frame.executeJavaScript(`
            try {
              window.__COZEA_BRIDGE_LOADED__ = false;
              document.getElementById('cozea-highlight')?.remove();
              document.getElementById('cozea-selected')?.remove();
              document.getElementById('cozea-highlight-label')?.remove();
              document.getElementById('cozea-selected-label')?.remove();
            } catch {}
          `)
          await frame.executeJavaScript(BRIDGE_SCRIPT)

          const postInjectHref = await getFrameLocationHref(frame)
          if (postInjectHref && isChromiumErrorDocumentUrl(postInjectHref)) {
            console.warn('[PreviewBridge][Main] Bridge injection landed on Chromium error document', {
              requestedUrl: url,
              requestedFrameName: frameName || '(none)',
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameHref: postInjectHref,
            })
            return {
              success: false,
              error: 'Preview frame is Chromium error document after injection (ERR_BLOCKED_BY_RESPONSE)',
              reason: 'blocked_response',
              likelyBlocked: true,
              frame: {
                requestedFrameName: frameName,
                matchedFrameName: frame.name || '(unnamed)',
                matchedFrameUrl: frame.url,
                frameHref: postInjectHref,
                frameTreeNodeId: frame.frameTreeNodeId,
                routingId: frame.routingId,
              },
              headerDiagnostic: getHeaderDiagnostic(deps, url),
            }
          }

          console.log('[PreviewBridge][Main] Bridge script injected successfully', {
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
          })
          return {
            success: true,
            reason: 'none',
            likelyBlocked: false,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to inject preview bridge'
          const classified = classifyPreviewFailure(message)
          console.error('[PreviewBridge][Main] Bridge script injection failed', {
            requestedUrl: url,
            requestedFrameName: frameName || '(none)',
            matchedFrameName: frame.name || '(unnamed)',
            matchedFrameUrl: frame.url,
            error: message,
          })
          return {
            success: false,
            error: message,
            reason: classified.reason,
            likelyBlocked: classified.likelyBlocked,
            frame: {
              requestedFrameName: frameName,
              matchedFrameName: frame.name || '(unnamed)',
              matchedFrameUrl: frame.url,
              frameTreeNodeId: frame.frameTreeNodeId,
              routingId: frame.routingId,
            },
            headerDiagnostic: getHeaderDiagnostic(deps, url),
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Preview bridge injection failed unexpectedly'
        const classified = classifyPreviewFailure(message)
        console.error('[PreviewBridge][Main] Unexpected injection handler failure', {
          requestedUrl: url,
          requestedFrameName: frameName || '(none)',
          error: message,
        })
        return {
          success: false,
          error: message,
          reason: classified.reason,
          likelyBlocked: classified.likelyBlocked,
          headerDiagnostic: typeof url === 'string' ? getHeaderDiagnostic(deps, url) : null,
        }
      }
    }
  )

  ipcMain.handle(
    'preview:probeUrl',
    async (
      _event,
      { url, timeoutMs = 2500 }: { url: string; timeoutMs?: number }
    ): Promise<PreviewProbeUrlResult> => {
      const startedAt = Date.now()
      if (!url || typeof url !== 'string') {
        return {
          success: false,
          url: url || '',
          reachable: false,
          reason: 'invalid_url',
          error: 'Missing url',
          elapsedMs: Date.now() - startedAt,
        }
      }

      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return {
          success: false,
          url,
          reachable: false,
          reason: 'invalid_url',
          error: 'Invalid url',
          elapsedMs: Date.now() - startedAt,
        }
      }

      if (!isAllowedPreviewUrl(parsedUrl)) {
        return {
          success: false,
          url,
          reachable: false,
          reason: 'unsupported_origin',
          error: 'Only localhost preview URLs are supported',
          elapsedMs: Date.now() - startedAt,
        }
      }

      const boundedTimeoutMs = Math.max(250, Math.min(timeoutMs, 15_000))
      const controller = new AbortController()
      const timeoutHandle = setTimeout(() => controller.abort(), boundedTimeoutMs)

      try {
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          cache: 'no-store',
        })

        return {
          success: true,
          url,
          reachable: true,
          statusCode: response.status,
          finalUrl: response.url,
          reason: 'none',
          elapsedMs: Date.now() - startedAt,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const classified = classifyPreviewFailure(message)
        return {
          success: false,
          url,
          reachable: false,
          reason: classified.reason === 'bridge_injection_failed' ? 'server_unreachable' : classified.reason,
          error: message,
          elapsedMs: Date.now() - startedAt,
        }
      } finally {
        clearTimeout(timeoutHandle)
      }
    }
  )

  // Capture a screenshot of a URL using a hidden BrowserWindow
  ipcMain.handle(
    'preview:captureScreenshot',
    async (
      _event,
      { url, width = 1280, height = 800 }: { url: string; width?: number; height?: number }
    ): Promise<PreviewCaptureScreenshotResult> => {
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return { success: false, error: 'Invalid URL' }
      }

      if (!isAllowedPreviewUrl(parsedUrl)) {
        return { success: false, error: 'Only localhost URLs are supported' }
      }

      const captureWindow = new BrowserWindow({
        width,
        height,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          offscreen: true,
        },
      })

      try {
        // Load the URL with explicit timeout + listener cleanup to avoid unhandled rejections.
        await loadUrlForCapture(captureWindow, url, 30000)

        // Wait a bit for any animations/rendering to complete.
        await new Promise((resolve) => setTimeout(resolve, 500))

        const image = await captureWindow.webContents.capturePage()
        const base64 = image.toPNG().toString('base64')

        return { success: true, base64 }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Screenshot capture failed'
        if (!isExpectedPreviewConnectivityError(message)) {
          console.error('[Preview] Screenshot capture failed:', error)
        }
        return { success: false, error: message }
      } finally {
        captureWindow.destroy()
      }
    }
  )
}
