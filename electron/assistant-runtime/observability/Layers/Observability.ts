/**
 * ObservabilityLive — NDJSON (+ optional OTLP) layer behind `cozea.obs.ndjson`.
 */
import { Effect, Exit, Layer } from "effect";

import { ServerConfig } from "../../config.ts";
import { createOtlpExporter } from "../OtlpExport.ts";
import {
  createNdjsonSpanWriter,
  createNoopNdjsonSpanWriter,
  type SpanExit,
} from "../NdjsonSpanWriter.ts";
import { readObservabilityFlags } from "../flags.ts";
import { ObservabilityService } from "../Services/Observability.ts";

const makeObservability = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const flags = readObservabilityFlags();

  if (!flags.ndjsonEnabled) {
    const noop = createNoopNdjsonSpanWriter();
    yield* Effect.addFinalizer(() => Effect.sync(() => noop.close()));
    return {
      enabled: false,
      traceFilePath: undefined,
      withSpan: <A, E, R>(_name: string, _attributes: Readonly<Record<string, unknown>> | undefined, effect: Effect.Effect<A, E, R>) =>
        effect,
      recordSpan: () => Effect.succeed(undefined),
      startSpan: () => Effect.succeed(undefined),
      flush: Effect.void,
    };
  }

  const otlp =
    flags.otlpTracesUrl !== undefined
      ? createOtlpExporter({
          url: flags.otlpTracesUrl,
          serviceName: flags.otlpServiceName,
          exportIntervalMs: flags.otlpExportIntervalMs,
        })
      : undefined;

  const writer = createNdjsonSpanWriter({
    filePath: config.serverTracePath,
    onRecord: (record) => {
      otlp?.push(record);
    },
  });

  yield* Effect.logInfo("observability NDJSON enabled", {
    flag: "cozea.obs.ndjson",
    traceFilePath: writer.filePath,
    otlpConfigured: flags.otlpTracesUrl !== undefined,
  });

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      writer.close();
      if (otlp) {
        yield* Effect.promise(() => otlp.close()).pipe(Effect.ignore);
      }
    }),
  );

  const toSpanExit = (exit: Exit.Exit<unknown, unknown>): SpanExit => {
    if (Exit.isSuccess(exit)) {
      return { _tag: "Success" };
    }
    return { _tag: "Failure", cause: String(exit.cause) };
  };

  return {
    enabled: true,
    traceFilePath: writer.filePath,
    withSpan: <A, E, R>(
      name: string,
      attributes: Readonly<Record<string, unknown>> | undefined,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const span = writer.startSpan(name, attributes);
        const exit = yield* Effect.exit(effect);
        span.end(toSpanExit(exit));
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        return yield* Effect.failCause(exit.cause);
      }) as Effect.Effect<A, E, R>,
    recordSpan: (
      name: string,
      attributes?: Readonly<Record<string, unknown>>,
      exit?: SpanExit,
    ) =>
      Effect.sync(() => {
        const span = writer.startSpan(name, attributes);
        return span.end(exit ?? { _tag: "Success" });
      }),
    startSpan: (name: string, attributes?: Readonly<Record<string, unknown>>) =>
      Effect.sync(() => writer.startSpan(name, attributes)),
    flush: Effect.sync(() => {
      writer.flush();
    }),
  };
});

export const ObservabilityLive = Layer.effect(ObservabilityService, makeObservability);
