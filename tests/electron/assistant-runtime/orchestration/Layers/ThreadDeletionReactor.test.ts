import { CommandId, EventId, ThreadId, type OrchestrationEvent } from "@cozea/assistant-contracts";
import { Cause, Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "../../../../../electron/assistant-runtime/orchestration/Layers/ThreadDeletionReactor.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../../../../electron/assistant-runtime/orchestration/Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/ThreadDeletionReactor.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../../../../electron/assistant-runtime/provider/Services/ProviderService.ts";
import {
  TerminalManager,
  type TerminalManagerShape,
} from "../../../../../electron/assistant-runtime/terminal/Services/Manager.ts";

describe("logCleanupCauseUnlessInterrupted", () => {
  const threadId = ThreadId.makeUnsafe("thread-deletion-reactor-test");

  it("swallows ordinary cleanup failures", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.fail("cleanup failed"),
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("preserves interrupt causes", async () => {
    const exit = await Effect.runPromiseExit(
      logCleanupCauseUnlessInterrupted({
        effect: Effect.interrupt,
        message: "thread deletion cleanup skipped provider session stop",
        threadId,
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });
});

describe("ThreadDeletionReactor", () => {
  let runtime: ManagedRuntime.ManagedRuntime<
    OrchestrationEngineService | ThreadDeletionReactor,
    never
  > | null = null;
  let scope: Scope.Closeable | null = null;

  afterEach(async () => {
    if (scope) {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    }
    scope = null;
    if (runtime) {
      await runtime.dispose();
    }
    runtime = null;
  });

  it("stops provider sessions and closes terminals on thread.deleted via drain", async () => {
    const threadId = ThreadId.makeUnsafe("thread-delete-1");
    const stopSession = vi.fn((_input: { readonly threadId: ThreadId }) => Effect.void);
    const close = vi.fn((_input: { readonly threadId: string; readonly deleteHistory?: boolean }) =>
      Effect.void,
    );

    const domainEvents = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());

    const orchestrationEngine = {
      streamDomainEvents: Stream.fromPubSub(domainEvents),
    } as unknown as OrchestrationEngineShape;

    const providerService = {
      stopSession,
    } as unknown as ProviderServiceShape;

    const terminalManager = {
      close,
    } as unknown as TerminalManagerShape;

    runtime = ManagedRuntime.make(
      ThreadDeletionReactorLive.pipe(
        Layer.provideMerge(Layer.succeed(OrchestrationEngineService, orchestrationEngine)),
        Layer.provideMerge(Layer.succeed(ProviderService, providerService)),
        Layer.provideMerge(Layer.succeed(TerminalManager, terminalManager)),
      ) as Layer.Layer<OrchestrationEngineService | ThreadDeletionReactor, never, never>,
    );

    const reactor = await runtime.runPromise(Effect.service(ThreadDeletionReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    const deletedAt = new Date().toISOString();
    await Effect.runPromise(
      PubSub.publish(domainEvents, {
        type: "thread.deleted",
        eventId: EventId.makeUnsafe("evt-thread-deleted-1"),
        aggregateKind: "thread",
        aggregateId: threadId,
        sequence: 1,
        occurredAt: deletedAt,
        commandId: CommandId.makeUnsafe("cmd-thread-delete-1"),
        payload: {
          threadId,
          deletedAt,
        },
      } as OrchestrationEvent),
    );

    await Effect.runPromise(reactor.drain);

    expect(stopSession).toHaveBeenCalledWith({ threadId });
    expect(close).toHaveBeenCalledWith({ threadId, deleteHistory: true });
  });

  it("continues cleanup when provider stop fails without interrupting drain", async () => {
    const threadId = ThreadId.makeUnsafe("thread-delete-2");
    const stopSession = vi.fn((_input: { readonly threadId: ThreadId }) =>
      Effect.fail(new Error("provider stop failed")),
    );
    const close = vi.fn((_input: { readonly threadId: string; readonly deleteHistory?: boolean }) =>
      Effect.void,
    );

    const domainEvents = Effect.runSync(PubSub.unbounded<OrchestrationEvent>());

    const orchestrationEngine = {
      streamDomainEvents: Stream.fromPubSub(domainEvents),
    } as unknown as OrchestrationEngineShape;

    runtime = ManagedRuntime.make(
      ThreadDeletionReactorLive.pipe(
        Layer.provideMerge(
          Layer.succeed(OrchestrationEngineService, orchestrationEngine as OrchestrationEngineShape),
        ),
        Layer.provideMerge(
          Layer.succeed(ProviderService, { stopSession } as unknown as ProviderServiceShape),
        ),
        Layer.provideMerge(
          Layer.succeed(TerminalManager, { close } as unknown as TerminalManagerShape),
        ),
      ) as Layer.Layer<OrchestrationEngineService | ThreadDeletionReactor, never, never>,
    );

    const reactor = await runtime.runPromise(Effect.service(ThreadDeletionReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    const deletedAt = new Date().toISOString();
    await Effect.runPromise(
      PubSub.publish(domainEvents, {
        type: "thread.deleted",
        eventId: EventId.makeUnsafe("evt-thread-deleted-2"),
        aggregateKind: "thread",
        aggregateId: threadId,
        sequence: 2,
        occurredAt: deletedAt,
        commandId: CommandId.makeUnsafe("cmd-thread-delete-2"),
        payload: {
          threadId,
          deletedAt,
        },
      } as OrchestrationEvent),
    );

    await Effect.runPromise(reactor.drain);

    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith({ threadId, deleteHistory: true });
  });
});
