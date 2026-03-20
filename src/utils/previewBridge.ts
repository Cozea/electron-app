/**
 * Preview Bridge utilities.
 *
 * In the desktop app, bridge injection is owned by the Electron main process.
 * The renderer no longer attempts a same-origin fallback injection path.
 */
import type {
  PreviewBridgeFrameDetails,
  PreviewFailureReason,
  PreviewHeaderDiagnostic,
} from '@shared/electronApiTypes'

/** Message types for bridge communication */
export type BridgeMessageType =
  // iframe → host
  | 'bridge:ready'
  | 'bridge:dom-snapshot'
  | 'bridge:close-inspector'
  | 'bridge:shift-keydown'
  | 'bridge:shift-keyup'
  | 'bridge:element-selected'
  | 'bridge:element-contextmenu'
  | 'bridge:element-hover'
  | 'bridge:selection-cleared'
  | 'bridge:screenshot-ready'
  | 'bridge:style-update-ack'
  | 'bridge:navigation'
  | 'bridge:runtime-error'
  | 'bridge:console'
  | 'bridge:viewport-wheel'
  | 'bridge:viewport-pan'
  | 'bridge:viewport-pinch'
  // host → iframe
  | 'host:enable-inspector'
  | 'host:disable-inspector'
  | 'host:request-screenshot'
  | 'host:hide-overlays'
  | 'host:show-overlays'
  | 'host:update-style'
  | 'host:update-text'
  | 'host:clear-selection'
  | 'host:restore-selection'
  | 'host:set-viewport-state'

export interface BridgeMessage {
  type: BridgeMessageType
  payload?: unknown
  __cozeaBridgeMeta?: {
    frameName?: string
    href?: string
    instanceId?: string
  }
}

/** Data returned when an element is selected */
export interface SelectedElementData {
  tagName: string
  className: string
  id?: string
  selector: string
  boundingRect: { x: number; y: number; width: number; height: number }
  computedStyles: Record<string, string>
  htmlSnippet: string
  textContent?: string
  path: number[]
}

export interface ElementContextMenuData extends SelectedElementData {
  clientX: number
  clientY: number
  react?: {
    componentStack?: string[]
    source?: { fileName?: string; lineNumber?: number; columnNumber?: number } | null
  } | null
}

export interface InjectBridgeScriptResult {
  success: boolean
  error?: string
  likelyBlocked?: boolean
  reason?: PreviewFailureReason
  frame?: PreviewBridgeFrameDetails
  headerDiagnostic?: PreviewHeaderDiagnostic | null
}

/**
 * Inject bridge script into an iframe
 * - Browser: works for same-origin iframes only
 * - Electron: uses main-process injection (cross-origin safe)
 */
export async function injectBridgeScript(iframe: HTMLIFrameElement): Promise<InjectBridgeScriptResult> {
  const frameName = iframe.getAttribute('name') || undefined
  const targetUrl = iframe.src || '(no-src)'

  const electronInject = window.electronAPI.preview.injectBridge
  if (!iframe.src) {
    const error = 'Preview bridge target URL is missing'
    console.warn('[PreviewBridge][Renderer] No fallback injection path available', {
      frameName,
      url: targetUrl,
      error,
    })
    return {
      success: false,
      error,
      likelyBlocked: false,
    }
  }

  try {
    const result = await electronInject({ url: iframe.src, frameName })
    if (!result.success) {
      console.warn('[PreviewBridge][Renderer] Electron injection returned unsuccessful result', {
        frameName,
        url: targetUrl,
        error: result.error,
        reason: result.reason,
      })
    }
    return {
      success: result.success,
      error: result.error,
      likelyBlocked: result.likelyBlocked,
      reason: result.reason,
      frame: result.frame,
      headerDiagnostic: result.headerDiagnostic,
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.warn('[PreviewBridge][Renderer] Electron injection failed', {
      frameName,
      url: targetUrl,
      error,
    })
    return {
      success: false,
      error,
      likelyBlocked: false,
    }
  }
}

/**
 * Send a message to the iframe bridge
 */
export function sendBridgeMessage(
  iframe: HTMLIFrameElement,
  message: BridgeMessage
): void {
  try {
    iframe.contentWindow?.postMessage(message, '*')
  } catch (err) {
    console.warn('[PreviewBridge][Renderer] Failed to send message', { type: message.type, error: err })
  }
}
