import * as Sentry from '@sentry/electron/renderer'

import {
  isSentryDsnLike,
  resolveSentryEnvironment,
  scrubSentryEvent,
} from '@shared/sentryCommon'

declare const __COZEA_SENTRY_DSN__: string
declare const __COZEA_SENTRY_RELEASE__: string
declare const __COZEA_SENTRY_ENVIRONMENT__: string

let initialized = false

/**
 * Initializes Sentry in the sandboxed preload context so preload errors are
 * captured (with `contextIsolation: true` the renderer SDK cannot see them).
 * Errors only: tracing/profiling live in the renderer init. No-ops without
 * a configured DSN.
 */
export function initPreloadSentry(): void {
  if (initialized) return
  initialized = true

  const dsn =
    (typeof __COZEA_SENTRY_DSN__ !== 'undefined' && isSentryDsnLike(__COZEA_SENTRY_DSN__) && __COZEA_SENTRY_DSN__) ||
    (typeof process.env.VITE_SENTRY_DSN === 'string' && isSentryDsnLike(process.env.VITE_SENTRY_DSN) && process.env.VITE_SENTRY_DSN) ||
    ''
  if (!dsn) return

  const release =
    (typeof __COZEA_SENTRY_RELEASE__ !== 'undefined' && __COZEA_SENTRY_RELEASE__) ||
    process.env.SENTRY_RELEASE ||
    'cozea-desktop@0.2.3-beta.3'
  const envName =
    typeof __COZEA_SENTRY_ENVIRONMENT__ !== 'undefined' ? __COZEA_SENTRY_ENVIRONMENT__ : process.env.SENTRY_ENVIRONMENT

  Sentry.init({
    dsn,
    release,
    environment: resolveSentryEnvironment(envName, process.env.NODE_ENV !== 'production'),
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  })
}

// Auto-initialize on import: bootstrapPreload imports this module first.
// Idempotent; no-op without a configured DSN.
initPreloadSentry()
