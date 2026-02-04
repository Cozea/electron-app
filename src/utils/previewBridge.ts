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
  // Prefer Electron main-process injection when available (works cross-origin).
  const electronInject = window.electronAPI?.preview?.injectBridge
  if (electronInject && iframe.src) {
    try {
      const result = await electronInject({ url: iframe.src })
      if (result.success) return true
    } catch (err) {
      console.warn('[Bridge] Electron injection failed:', err)
    }
  }

  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!iframeDoc) {
      console.warn('[Bridge] Cannot access iframe document')
      return false
    }

    // Check if already injected
    if ((iframe.contentWindow as unknown as { __COZEA_BRIDGE_LOADED__?: boolean })?.__COZEA_BRIDGE_LOADED__) {
      return true
    }

    const script = iframeDoc.createElement('script')
    script.textContent = BRIDGE_SCRIPT
    iframeDoc.head.appendChild(script)
    return true
  } catch (err) {
    // Cross-origin iframe
    console.warn('[Bridge] Cannot inject into cross-origin iframe:', err)
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
  try {
    iframe.contentWindow?.postMessage(message, '*')
  } catch (err) {
    console.warn('[Bridge] Failed to send message:', err)
  }
}
