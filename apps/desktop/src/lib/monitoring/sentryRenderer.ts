import * as Sentry from '@sentry/electron/renderer'

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
 * Initializes Sentry in the renderer: error monitoring, automatic tracing
 * (pageloads, navigations, fetch/XHR, INP interactions, long tasks),
 * continuous JS profiling, and error-sampled Session Replay.
 *
 * Privacy defaults for a dev tool that displays user code: no PII, replay
 * text masked and media blocked, trace propagation loopback-only. No-ops
 * without `VITE_SENTRY_DSN`.
 */
export function initRendererSentry(): void {
  if (initialized) return
  initialized = true

  const env = import.meta.env
  const dsn =
    (typeof env.VITE_SENTRY_DSN === 'string' && env.VITE_SENTRY_DSN) ||
    (typeof __COZEA_SENTRY_DSN__ !== 'undefined' && __COZEA_SENTRY_DSN__) ||
    ''
  if (!isSentryDsnLike(dsn)) return

  const isDev = env.DEV === true
  // Dev defaults are off: tracing, the continuous profiler and the replay
  // buffer cost 20-35ms on every navigation in a development build, which made
  // `bun run dev` feel slower than the release. Opt in per variable below.
  const sample = (raw: unknown, devDefault: number, prodDefault: number): number =>
    resolveSampleRate(typeof raw === 'string' ? raw : undefined, isDev, devDefault, prodDefault)

  const release =
    (typeof __COZEA_SENTRY_RELEASE__ !== 'undefined' && __COZEA_SENTRY_RELEASE__) ||
    (typeof env.VITE_SENTRY_RELEASE === 'string' && env.VITE_SENTRY_RELEASE) ||
    'cozea-desktop@0.2.3-beta.3'

  const envName =
    (typeof env.VITE_SENTRY_ENVIRONMENT === 'string' && env.VITE_SENTRY_ENVIRONMENT) ||
    (typeof __COZEA_SENTRY_ENVIRONMENT__ !== 'undefined' ? __COZEA_SENTRY_ENVIRONMENT__ : undefined)

  Sentry.init({
    dsn,
    release,
    environment: resolveSentryEnvironment(envName, isDev),
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.browserProfilingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    tracePropagationTargets: ['localhost'],
    tracesSampleRate: sample(env.VITE_SENTRY_TRACES_SAMPLE_RATE, 0, 0.1),
    profileSessionSampleRate: sample(env.VITE_SENTRY_PROFILE_SESSION_SAMPLE_RATE, 0, 0.05),
    replaysSessionSampleRate: sample(env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE, 0, 0),
    replaysOnErrorSampleRate: sample(env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE, 0, 0.1),
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event),
  })
}

// Auto-initialize on import: main.tsx imports this module first.
// Idempotent; no-op without VITE_SENTRY_DSN.
initRendererSentry()
