import '../profileOverride'

import * as Sentry from '@sentry/electron/main'

import {
  isSentryDsnLike,
  resolveSampleRate,
  resolveSentryEnvironment,
  scrubSentryEvent,
} from '@shared/sentryCommon'

declare const __COZEA_SENTRY_DSN__: string
declare const __COZEA_SENTRY_RELEASE__: string
declare const __COZEA_SENTRY_ENVIRONMENT__: string

let initialized = false

/**
 * Initializes Sentry in the main process: error monitoring, native crash
 * reporting (GPU/renderer minidumps), startup tracing, and the
 * `Document-Policy: js-profiling` injection the renderer's continuous
 * profiler requires.
 *
 * Must run before any `BrowserWindow` is created (so the profiling header is
 * injected from the first navigation) and after the userData override (the
 * SDK caches scope/events under userData). Importing `profileOverride` above
 * guarantees the latter however this module is reached. No-ops without a
 * configured DSN.
 */
export function initMainSentry(): void {
  if (initialized) return
  initialized = true

  const dsn =
    (typeof __COZEA_SENTRY_DSN__ !== 'undefined' && isSentryDsnLike(__COZEA_SENTRY_DSN__) && __COZEA_SENTRY_DSN__) ||
    (typeof process.env.VITE_SENTRY_DSN === 'string' && isSentryDsnLike(process.env.VITE_SENTRY_DSN) && process.env.VITE_SENTRY_DSN) ||
    ''
  if (!dsn) return

  const isDev = process.env.NODE_ENV !== 'production'
  const release =
    (typeof __COZEA_SENTRY_RELEASE__ !== 'undefined' && __COZEA_SENTRY_RELEASE__) ||
    process.env.SENTRY_RELEASE ||
    'cozea-desktop@0.2.3-beta.3'
  const envName =
    typeof __COZEA_SENTRY_ENVIRONMENT__ !== 'undefined' ? __COZEA_SENTRY_ENVIRONMENT__ : process.env.SENTRY_ENVIRONMENT

  Sentry.init({
    dsn,
    release,
    environment: resolveSentryEnvironment(envName, isDev),
    // Renderer events route through main; keep trace propagation to loopback
    // until Convex/AI backends are verified to tolerate the extra headers.
    tracePropagationTargets: ['localhost'],
    tracesSampleRate: resolveSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, isDev, 1, 0.1),
    integrations: [Sentry.startupTracingIntegration()],
    enableRendererProfiling: true,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  })
}

// Auto-initialize on import (same side-effect pattern as profileOverride):
// mainEntry imports this module first so capture starts before any app
// module evaluates. Safe to import anywhere: idempotent, and a no-op
// without a configured DSN.
initMainSentry()
