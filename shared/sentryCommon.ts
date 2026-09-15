/**
 * Pure Sentry configuration helpers shared by the Electron main process,
 * preload scripts, the renderer, and unit tests.
 *
 * This module must never import the Sentry SDK (or any process-specific API):
 * it is bundled into every process, including the sandboxed preload.
 */

/** Release identifier baked at build time: `cozea-desktop@<version>`. */
export const SENTRY_RELEASE_NAME = 'cozea-desktop'

/** Query-string / fragment keys whose values are never sent to Sentry. */
const SENSITIVE_URL_KEYS = new Set([
  'token',
  'access_token',
  'accesstoken',
  'id_token',
  'refresh_token',
  'auth',
  'authcode',
  'authorization',
  'api_key',
  'apikey',
  'key',
  'secret',
  'client_secret',
  'password',
  'signature',
  'code',
  'state',
])

const HOME_DIR_PATTERN = /(^|[ "'(=])(?:\/Users\/[^/"'\s)]+|C:[\\/]Users[\\/][^"'\\\s)]+|[A-Z]:[\\/][^"'\\\s)]*?\\Users\\[^"'\\\s)]+)/g
const KEY_VALUE_PAIR = /(^|[\s?&#;,])([^?&#=\s;,]+)=([^?&#\s;,]*)/g

/** Splits a parameter name into segments (`api_key` → api+key, `clientCode` → client+code). */
function paramNameSegments(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_. -]+/)
    .filter(Boolean)
}

function isSensitiveParamName(name: string): boolean {
  return paramNameSegments(name).some((segment) => SENSITIVE_URL_KEYS.has(segment))
}

function redactSensitivePairs(value: string): string {
  return value.replace(KEY_VALUE_PAIR, (match, prefix: string, name: string) =>
    isSensitiveParamName(name) ? `${prefix}${name}=[redacted]` : match,
  )
}

/**
 * Redacts filesystem paths and credential-like pairs from free text (error
 * messages, breadcrumb bodies, stack-adjacent labels). Home directories
 * collapse to `~`; sensitive `name=value` pairs collapse to `[redacted]`.
 * Matching is segment-based, so `monkey=business` survives while
 * `api_key=…` does not.
 */
export function scrubSentryText(value: string): string {
  if (!value) return value
  return redactSensitivePairs(value.replace(HOME_DIR_PATTERN, '$1~'))
}

/**
 * Redacts a URL for transport: sensitive query values collapse, and a hash
 * fragment carrying credential-like pairs is dropped (plain `#/route` hashes
 * are kept so file-URL route errors stay readable).
 */
export function scrubSentryUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl
  const hashIndex = rawUrl.indexOf('#')
  const withoutFragment = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl
  const fragment = hashIndex >= 0 ? rawUrl.slice(hashIndex + 1) : ''
  const scrubbedBase = scrubSentryText(withoutFragment)
  if (!fragment) return scrubbedBase
  const redactedFragment = redactSensitivePairs(fragment.startsWith('?') ? fragment : `?${fragment}`)
  if (redactedFragment.includes('[redacted]')) return `${scrubbedBase}#[redacted]`
  return `${scrubbedBase}#${scrubSentryText(fragment)}`
}

interface ScrubbableFrame {
  filename?: unknown
}

interface ScrubbableExceptionValue {
  value?: unknown
  stacktrace?: { frames?: unknown }
}

interface ScrubbableBreadcrumb {
  message?: unknown
  data?: unknown
}

/** Minimal structural shape of a Sentry event for scrubbing (no SDK types). */
export interface ScrubbableSentryEvent {
  message?: unknown
  exception?: { values?: unknown }
  request?: { url?: unknown }
  breadcrumbs?: unknown
}

/**
 * Scrubs the PII-bearing fields of a Sentry event in place and returns it.
 * Safe to use as a `beforeSend` hook in every process.
 */
export function scrubSentryEvent<T extends ScrubbableSentryEvent>(event: T): T {
  if (typeof event.message === 'string') {
    event.message = scrubSentryText(event.message)
  }
  const values = (event.exception as { values?: unknown } | undefined)?.values
  if (Array.isArray(values)) {
    for (const item of values) {
      const entry = item as ScrubbableExceptionValue
      if (entry && typeof entry === 'object') {
        if (typeof entry.value === 'string') entry.value = scrubSentryText(entry.value)
        const frames = (entry.stacktrace as { frames?: unknown } | undefined)?.frames
        if (Array.isArray(frames)) {
          for (const frame of frames) {
            const candidate = frame as ScrubbableFrame
            if (candidate && typeof candidate === 'object' && typeof candidate.filename === 'string') {
              candidate.filename = scrubSentryText(candidate.filename)
            }
          }
        }
      }
    }
  }
  const request = event.request as { url?: unknown } | undefined
  if (request && typeof request === 'object' && typeof request.url === 'string') {
    request.url = scrubSentryUrl(request.url)
  }
  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      const entry = crumb as ScrubbableBreadcrumb
      if (entry && typeof entry === 'object') {
        if (typeof entry.message === 'string') entry.message = scrubSentryText(entry.message)
        const data = entry.data as { url?: unknown } | undefined
        if (data && typeof data === 'object' && typeof data.url === 'string') {
          data.url = scrubSentryUrl(data.url)
        }
      }
    }
  }
  return event
}

/** Minimal DSN sanity check: `https://<key>@<host>/<id>`. */
export function isSentryDsnLike(value: string | undefined): value is string {
  if (!value) return false
  return /^https:\/\/[^@/\s]+@[^/\s]+\/\S+$/.test(value.trim())
}

/** Clamps a sample-rate env value into [0, 1] with dev/prod defaults. */
export function resolveSampleRate(
  raw: string | undefined,
  isDev: boolean,
  devDefault: number,
  prodDefault: number,
): number {
  const fallback = isDev ? devDefault : prodDefault
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(1, Math.max(0, parsed))
}

/** Sentry environment label: explicit override wins, else dev/prod split. */
export function resolveSentryEnvironment(raw: string | undefined, isDev: boolean): string {
  const trimmed = raw?.trim()
  if (trimmed) return trimmed
  return isDev ? 'development' : 'production'
}
