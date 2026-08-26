// @ts-nocheck
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProjectId,
  ThreadId,
} from "@cozea/assistant-contracts";
import { Cause, Deferred, Effect, Exit, Layer, ManagedRuntime, Scope } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  logCleanupCauseUnlessInterrupted,
  ThreadDeletionReactorLive,
} from "../../../../../electron/assistant-runtime/orchestration/Layers/ThreadDeletionReactor.ts";
import { OrchestrationEngineLive } from "../../../../../electron/assistant-runtime/orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../../../../../electron/assistant-runtime/orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationEventStoreLive } from "../../../../../electron/assistant-runtime/persistence/Layers/OrchestrationEventStore.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../../../../electron/assistant-runtime/persistence/Layers/OrchestrationCommandReceipts.ts";
import { SqlitePersistenceMemory } from "../../../../../electron/assistant-runtime/persistence/Layers/Sqlite.ts";
import { OrchestrationEngineService } from "../../../../../electron/assistant-runtime/orchestration/Services/OrchestrationEngine.ts";
import { ThreadDeletionReactor } from "../../../../../electron/assistant-runtime/orchestration/Services/ThreadDeletionReactor.ts";
import {
  ProviderService,
  type ProviderServiceShape,
} from "../../../../../electron/assistant-runtime/provider/Services/ProviderService.ts";
import {
  TerminalManager,
  type TerminalManagerShape,
} from "../../../../../electron/assistant-runtime/terminal/Services/Manager.ts";
import { ServerConfig } from "../../../../../electron/assistant-runtime/config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value);

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
    unknown
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

  async function createHarness(options?: {
    readonly stopSessionEffect?: Effect.Effect<void, Error>;
  }) {
    const cleanupFinished = Effect.runSync(Deferred.make<void>());
    const stopSession = vi.fn((_input: { readonly threadId: ThreadId }) =>
      (options?.stopSessionEffect ?? Effect.void).pipe(
        Effect.ensuring(Deferred.succeed(cleanupFinished, undefined).pipe(Effect.orDie)),
      ),
    );
    const close = vi.fn((_input: { readonly threadId: string; readonly deleteHistory?: boolean }) =>
      Effect.void,
    );

    const orchestrationLayer = OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionPipelineLive),
      Layer.provide(OrchestrationEventStoreLive),
      Layer.provide(OrchestrationCommandReceiptRepositoryLive),
      Layer.provide(SqlitePersistenceMemory),
    );

    const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
      prefix: "cozea-thread-deletion-reactor-test-",
    });

    const layer = ThreadDeletionReactorLive.pipe(
      Layer.provideMerge(orchestrationLayer),
      Layer.provideMerge(
        Layer.succeed(ProviderService, { stopSession } as unknown as ProviderServiceShape),
      ),
      Layer.provideMerge(
        Layer.succeed(TerminalManager, { close } as unknown as TerminalManagerShape),
      ),
      Layer.provideMerge(ServerConfigLayer),
      Layer.provideMerge(NodeServices.layer),
    );

    runtime = ManagedRuntime.make(layer);
    const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService));
    const reactor = await runtime.runPromise(Effect.service(ThreadDeletionReactor));
    scope = await Effect.runPromise(Scope.make("sequential"));
    await Effect.runPromise(reactor.start.pipe(Scope.provide(scope)));

    const createdAt = new Date().toISOString();
    await Effect.runPromise(
      engine.dispatch({
        type: "project.create",
        commandId: CommandId.makeUnsafe("cmd-project-create"),
        projectId: asProjectId("project-1"),
        title: "Delete Project",
        workspaceRoot: "/tmp/thread-deletion-project",
        defaultModelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        createdAt,
      }),
    );
    await Effect.runPromise(
      engine.dispatch({
        type: "thread.create",
        commandId: CommandId.makeUnsafe("cmd-thread-create"),
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: asProjectId("project-1"),
        title: "Thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5-codex",
        },
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        runtimeMode: "approval-required",
        branch: null,
        worktreePath: "/tmp/thread-deletion-project/worktrees/feature-a",
        createdAt,
      }),
    );

    return {
      engine,
      reactor,
      stopSession,
      close,
      cleanupFinished,
      drain: () => Effect.runPromise(reactor.drain),
    };
  }

  it("stops provider sessions and closes terminals on thread.deleted via drain", async () => {
    const harness = await createHarness();
    const threadId = ThreadId.makeUnsafe("thread-1");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-thread-delete"),
        threadId,
      }),
    );

    await Effect.runPromise(Deferred.await(harness.cleanupFinished));
    await harness.drain();

    expect(harness.stopSession).toHaveBeenCalledWith({ threadId });
    expect(harness.close).toHaveBeenCalledWith({ threadId, deleteHistory: true });
  });

  it("continues cleanup when provider stop fails without interrupting drain", async () => {
    const harness = await createHarness({
      stopSessionEffect: Effect.fail(new Error("provider stop failed")),
    });
    const threadId = ThreadId.makeUnsafe("thread-1");

    await Effect.runPromise(
      harness.engine.dispatch({
        type: "thread.delete",
        commandId: CommandId.makeUnsafe("cmd-thread-delete-fail"),
        threadId,
      }),
    );

    await Effect.runPromise(Deferred.await(harness.cleanupFinished));
    await harness.drain();

    expect(harness.stopSession).toHaveBeenCalledTimes(1);
    expect(harness.close).toHaveBeenCalledWith({ threadId, deleteHistory: true });
  });
});
