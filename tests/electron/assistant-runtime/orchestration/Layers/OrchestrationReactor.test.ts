// @ts-nocheck
import { Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/CheckpointReactor.ts";
import { ProviderCommandReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/ProviderCommandReactor.ts";
import { ProviderRuntimeIngestionService } from "../../../../../electron/assistant-runtime/orchestration/Services/ProviderRuntimeIngestion.ts";
import { ThreadDeletionReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/ThreadDeletionReactor.ts";
import { OrchestrationReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/OrchestrationReactor.ts";
import { makeOrchestrationReactor } from "../../../../../electron/assistant-runtime/orchestration/Layers/OrchestrationReactor.ts";

describe("OrchestrationReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<OrchestrationReactor, never> | null = null;

  afterEach(async () => {
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("starts provider ingestion, provider command, checkpoint, and thread deletion reactors", async () => {
    const started: string[] = [];

    runtime = ManagedRuntime.make(
      Layer.effect(OrchestrationReactor, makeOrchestrationReactor).pipe(
        Layer.provideMerge(
          Layer.succeed(ProviderRuntimeIngestionService, {
            start: Effect.sync(() => {
              started.push("provider-runtime-ingestion");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderCommandReactor, {
            start: Effect.sync(() => {
              started.push("provider-command-reactor");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(CheckpointReactor, {
            start: Effect.sync(() => {
              started.push("checkpoint-reactor");
            }),
            drain: Effect.void,
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(ThreadDeletionReactor, {
            start: Effect.sync(() => {
              started.push("thread-deletion-reactor");
            }),
            drain: Effect.void,
          }),
        ),
      ),
    );

    const reactor = await runtime.runPromise(Effect.service(OrchestrationReactor));
    const scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    expect(started).toEqual([
      "provider-runtime-ingestion",
      "provider-command-reactor",
      "checkpoint-reactor",
      "thread-deletion-reactor",
    ]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
  });
});
