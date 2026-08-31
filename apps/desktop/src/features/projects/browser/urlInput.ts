export function normalizeUrlInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ""

  // host:port before the scheme check: `localhost:3000` parses as a URI with
  // scheme `localhost:`, which loadURL can't handle. Digits right after the
  // colon can only be a port — scheme separators are followed by a non-digit.
  if (/^localhost(:|\/|$)/i.test(trimmed) || /^[\w.-]+:\d+/.test(trimmed)) {
    return `http://${trimmed}`
  }

  // If it's explicitly a URL scheme (e.g., http://, https://, file://)
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return trimmed
  }

  // If it contains spaces, it's definitely a search query
  if (trimmed.includes(" ")) {
    return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
  }

  // If it looks like a domain name or IP address (has a dot)
  if (trimmed.includes(".")) {
    return `https://${trimmed}`
  }

  // Otherwise, treat it as a search query
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`
}

export function isExternallyOpenableBrowserUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

/** Tile-local request to focus the address bar (Cmd+L from the tile body). */
export const BROWSER_FOCUS_URL_EVENT = "cozea:browser-focus-url"

export function dispatchBrowserFocusUrl(tileId: string): void {
  window.dispatchEvent(new CustomEvent(BROWSER_FOCUS_URL_EVENT, { detail: { tileId } }))
}
