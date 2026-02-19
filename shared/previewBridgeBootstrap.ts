/**
 * Cozea Preview Bridge Bootstrap
 *
 * This helper is intended to run inside preview apps (the iframe content).
 * It reads `cozeaBridgeScript` from the current URL query string and injects
 * that script into the page so host-driven bridge features can activate even
 * when the iframe is cross-origin.
 */

export type PreviewBridgeBootstrapStatus =
  | 'loaded'
  | 'already-loaded'
  | 'skipped'
  | 'failed'

export interface PreviewBridgeBootstrapResult {
  status: PreviewBridgeBootstrapStatus
  scriptUrl: string | null
  reason?: string
}

export interface PreviewBridgeBootstrapOptions {
  search?: string
  locationHref?: string
  fallbackScriptUrl?: string | null
}

interface CozeaBridgeBootstrapState {
  scriptUrl: string
  injectedAt: number
}

interface PreviewBridgeBootstrapWindow extends Window {
  __COZEA_PREVIEW_BRIDGE_BOOTSTRAP__?: CozeaBridgeBootstrapState
  __COZEA_BRIDGE_SCRIPT_URL__?: string
}

const BRIDGE_SCRIPT_QUERY_KEY = 'cozeaBridgeScript'
const BRIDGE_SCRIPT_DATA_ATTR = 'data-cozea-preview-bridge'
const BRIDGE_RUNTIME_ATTR_VALUE = 'runtime'

function resolveCandidateScriptUrl(options: PreviewBridgeBootstrapOptions): string | null {
  const search = options.search ?? window.location.search
  const params = new URLSearchParams(search || '')
  const fromQuery = params.get(BRIDGE_SCRIPT_QUERY_KEY)?.trim()
  if (fromQuery) return fromQuery

  if (options.fallbackScriptUrl?.trim()) return options.fallbackScriptUrl.trim()

  const bootstrapWindow = window as PreviewBridgeBootstrapWindow
  const fromWindow = bootstrapWindow.__COZEA_BRIDGE_SCRIPT_URL__?.trim()
  if (fromWindow) return fromWindow

  return null
}

function normalizeScriptUrl(candidate: string, options: PreviewBridgeBootstrapOptions): string | null {
  const locationHref = options.locationHref ?? window.location.href
  try {
    return new URL(candidate, locationHref).toString()
  } catch {
    return null
  }
}

function findExistingRuntimeScript(scriptUrl: string): HTMLScriptElement | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(`script[${BRIDGE_SCRIPT_DATA_ATTR}="${BRIDGE_RUNTIME_ATTR_VALUE}"]`)
  for (const script of scripts) {
    if (script.src === scriptUrl) return script
  }
  return null
}

function resolveNonce(): string | null {
  const nonceScript = document.querySelector<HTMLScriptElement>('script[nonce]')
  if (!nonceScript) return null
  if (typeof nonceScript.nonce === 'string' && nonceScript.nonce.trim()) return nonceScript.nonce.trim()
  const attrNonce = nonceScript.getAttribute('nonce')?.trim()
  return attrNonce || null
}

export function bootstrapPreviewBridge(options: PreviewBridgeBootstrapOptions = {}): PreviewBridgeBootstrapResult {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { status: 'skipped', scriptUrl: null, reason: 'No browser runtime detected' }
  }

  const bootstrapWindow = window as PreviewBridgeBootstrapWindow
  if (bootstrapWindow.__COZEA_PREVIEW_BRIDGE_BOOTSTRAP__) {
    return {
      status: 'already-loaded',
      scriptUrl: bootstrapWindow.__COZEA_PREVIEW_BRIDGE_BOOTSTRAP__.scriptUrl,
      reason: 'Bridge bootstrap already ran in this document',
    }
  }

  const candidate = resolveCandidateScriptUrl(options)
  if (!candidate) {
    return { status: 'skipped', scriptUrl: null, reason: 'No cozeaBridgeScript query parameter found' }
  }

  const scriptUrl = normalizeScriptUrl(candidate, options)
  if (!scriptUrl) {
    return { status: 'failed', scriptUrl: null, reason: 'cozeaBridgeScript is not a valid URL' }
  }

  if (findExistingRuntimeScript(scriptUrl)) {
    bootstrapWindow.__COZEA_PREVIEW_BRIDGE_BOOTSTRAP__ = {
      scriptUrl,
      injectedAt: Date.now(),
    }
    return {
      status: 'already-loaded',
      scriptUrl,
      reason: 'Bridge runtime script already present',
    }
  }

  try {
    const runtimeScript = document.createElement('script')
    runtimeScript.src = scriptUrl
    runtimeScript.async = true
    runtimeScript.crossOrigin = 'anonymous'
    runtimeScript.setAttribute(BRIDGE_SCRIPT_DATA_ATTR, BRIDGE_RUNTIME_ATTR_VALUE)

    const nonce = resolveNonce()
    if (nonce) runtimeScript.nonce = nonce

    const target = document.head || document.documentElement || document.body
    if (!target) {
      return { status: 'failed', scriptUrl, reason: 'No document mount point found for script injection' }
    }

    target.appendChild(runtimeScript)

    bootstrapWindow.__COZEA_PREVIEW_BRIDGE_BOOTSTRAP__ = {
      scriptUrl,
      injectedAt: Date.now(),
    }

    return { status: 'loaded', scriptUrl }
  } catch (error) {
    return {
      status: 'failed',
      scriptUrl,
      reason: error instanceof Error ? error.message : 'Unknown script injection error',
    }
  }
}

