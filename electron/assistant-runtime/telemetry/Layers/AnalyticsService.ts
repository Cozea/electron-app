/**
 * AnalyticsServiceLayerLive - No-op telemetry layer.
 *
 * The desktop assistant runtime no longer ships PostHog transport or
 * identifier plumbing. The service boundary remains so the runtime can keep
 * its orchestration hooks without reintroducing external telemetry.
 */
import { Effect, Layer } from "effect";

import { AnalyticsService } from "../Services/AnalyticsService.ts";

const makeAnalyticsService = Effect.succeed({
  record: () => Effect.void,
  flush: Effect.void,
});

export const AnalyticsServiceLayerLive = Layer.effect(AnalyticsService, makeAnalyticsService);
