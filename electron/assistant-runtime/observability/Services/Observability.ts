/**
 * ObservabilityService — best-effort span API for assistant-runtime.
 */
import { Effect, Layer, ServiceMap } from "effect";

import type { ActiveSpan, NdjsonSpanRecord, SpanExit } from "../NdjsonSpanWriter.ts";

export interface ObservabilityServiceShape {
  readonly enabled: boolean;
  readonly traceFilePath: string | undefined;
  readonly withSpan: <A, E, R>(
    name: string,
    attributes: Readonly<Record<string, unknown>> | undefined,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly recordSpan: (
    name: string,
    attributes?: Readonly<Record<string, unknown>>,
    exit?: SpanExit,
  ) => Effect.Effect<NdjsonSpanRecord | undefined>;
  readonly startSpan: (
    name: string,
    attributes?: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<ActiveSpan | undefined>;
  readonly flush: Effect.Effect<void>;
}

export class ObservabilityService extends ServiceMap.Service<
  ObservabilityService,
  ObservabilityServiceShape
>()("cozea/assistant-runtime/observability/ObservabilityService") {
  static readonly layerTest = Layer.succeed(ObservabilityService, {
    enabled: false,
    traceFilePath: undefined,
    withSpan: (_name, _attributes, effect) => effect,
    recordSpan: () => Effect.succeed(undefined),
    startSpan: () => Effect.succeed(undefined),
    flush: Effect.void,
  });
}
