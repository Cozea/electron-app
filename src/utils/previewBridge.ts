/**
 * Preview Bridge Script
 *
 * Injected into preview iframes to enable:
 * - Element inspection (click-to-select with highlight overlay)
 * - Computed style extraction
 * - Screenshot capture via html2canvas
 * - Live style updates via postMessage
 */

import { BRIDGE_SCRIPT } from '../../shared/previewBridgeScript'

/** Message types for bridge communication */
export type BridgeMessageType =
  // iframe → host
  | 'bridge:ready'
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
  // host → iframe
  | 'host:enable-inspector'
  | 'host:disable-inspector'
  | 'host:request-screenshot'
  | 'host:update-style'
  | 'host:update-text'
  | 'host:clear-selection'

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

/**
 * Inject bridge script into an iframe
 * - Browser: works for same-origin iframes only
 * - Electron: uses main-process injection (cross-origin safe)
 */
export async function injectBridgeScript(iframe: HTMLIFrameElement): Promise<boolean> {
  const frameName = iframe.getAttribute('name') || undefined
  const targetUrl = iframe.src || '(no-src)'
  console.log('[PreviewBridge][Renderer] Injection requested', { frameName, url: targetUrl })

  // Prefer Electron main-process injection when available (works cross-origin).
  const electronInject = window.electronAPI?.preview?.injectBridge
  if (electronInject && iframe.src) {
    try {
      const result = await electronInject({ url: iframe.src, frameName })
      if (result.success) {
        console.log('[PreviewBridge][Renderer] Electron injection succeeded', { frameName, url: targetUrl })
        return true
      }
      console.warn('[PreviewBridge][Renderer] Electron injection returned unsuccessful result', {
        frameName,
        url: targetUrl,
        error: result.error,
      })
    } catch (err) {
      console.warn('[PreviewBridge][Renderer] Electron injection failed', { frameName, url: targetUrl, error: err })
    }
  }

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      console.warn('[PreviewBridge][Renderer] Cannot access iframe document', { frameName, url: targetUrl })
      return false
    }

    // Force-refresh bridge instance so style/script updates apply immediately.
    try {
      const bridgeWindow = iframe.contentWindow as unknown as { __COZEA_BRIDGE_LOADED__?: boolean } | null
      if (bridgeWindow) bridgeWindow.__COZEA_BRIDGE_LOADED__ = false
      iframeDoc.getElementById('cozea-highlight')?.remove()
      iframeDoc.getElementById('cozea-selected')?.remove()
      iframeDoc.getElementById('cozea-highlight-label')?.remove()
      iframeDoc.getElementById('cozea-selected-label')?.remove()
    } catch {
      // Ignore and continue with injection.
    }

    const script = iframeDoc.createElement('script')
    script.textContent = BRIDGE_SCRIPT
    iframeDoc.head.appendChild(script)
    console.log('[PreviewBridge][Renderer] DOM injection fallback succeeded', { frameName, url: targetUrl })
    return true
  } catch (err) {
    // Cross-origin iframe
    console.warn('[PreviewBridge][Renderer] Cannot inject into cross-origin iframe', { frameName, url: targetUrl, error: err })
    return false
  }
}

/**
 * Send a message to the iframe bridge
 */
export function sendBridgeMessage(
  iframe: HTMLIFrameElement,
  message: BridgeMessage
): void {
  const noisyType = message.type === 'host:update-style' || message.type === 'host:update-text'
  if (!noisyType) {
    console.log('[PreviewBridge][Renderer] Sending host message', {
      type: message.type,
      frameName: iframe.getAttribute('name') || undefined,
      url: iframe.src || '(no-src)',
    })
  }
  try {
    iframe.contentWindow?.postMessage(message, '*')
  } catch (err) {
    console.warn('[PreviewBridge][Renderer] Failed to send message', { type: message.type, error: err })
  }
}
