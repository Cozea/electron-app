// @ts-nocheck
import type { ProviderKind } from "@cozea/assistant-contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, PubSub, Stream } from "effect";

import type { ClaudeAdapterShape } from "../../../../../electron/assistant-runtime/provider/Services/ClaudeAdapter.ts";
import type { CodexAdapterShape } from "../../../../../electron/assistant-runtime/provider/Services/CodexAdapter.ts";
import type { CursorAdapterShape } from "../../../../../electron/assistant-runtime/provider/Services/CursorAdapter.ts";
import type { OpenCodeAdapterShape } from "../../../../../electron/assistant-runtime/provider/Services/OpenCodeAdapter.ts";
import { ProviderAdapterRegistry } from "../../../../../electron/assistant-runtime/provider/Services/ProviderAdapterRegistry.ts";
import { ProviderAdapterRegistryLive } from "../../../../../electron/assistant-runtime/provider/Layers/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../../../../../electron/assistant-runtime/provider/Services/ProviderInstanceRegistry.ts";
import { ProviderUnsupportedError } from "../../../../../electron/assistant-runtime/provider/Errors.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const fakeCodexAdapter: CodexAdapterShape = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ClaudeAdapterShape = {
  provider: "claudeAgent",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: "opencode",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: CursorAdapterShape = {
  provider: "cursor",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

// ProviderAdapterRegistryLive is now a facade over ProviderInstanceRegistry:
// instances own the adapters, and provider-kind lookups map to default
// instance ids. Tests fake the instance registry instead of adapter services.
function makeFakeInstanceRegistry(adapters: Array<{ provider: string; adapter: unknown }>) {
  const instances = adapters.map(({ provider, adapter }) => ({
    instanceId: provider,
    driverKind: provider,
    displayName: provider,
    enabled: true,
    config: {},
    snapshot: {},
    adapter,
    textGeneration: {},
  }));
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance]));
  return {
    getInstance: (instanceId: string) => Effect.succeed(byId.get(instanceId)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.flatMap(PubSub.unbounded(), (pubsub) => PubSub.subscribe(pubsub)),
  };
}

const layer = it.layer(
  Layer.mergeAll(
    Layer.provide(
      ProviderAdapterRegistryLive,
      Layer.succeed(
        ProviderInstanceRegistry,
        makeFakeInstanceRegistry([
          { provider: "codex", adapter: fakeCodexAdapter },
          { provider: "claudeAgent", adapter: fakeClaudeAdapter },
          { provider: "opencode", adapter: fakeOpenCodeAdapter },
        ]),
      ),
    ),
    NodeServices.layer,
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByProvider("codex");
      const claude = yield* registry.getByProvider("claudeAgent");
      const opencode = yield* registry.getByProvider("opencode");
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(opencode, fakeOpenCodeAdapter);

      const providers = yield* registry.listProviders();
      assert.deepEqual(providers, ["codex", "claudeAgent", "opencode"]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry.getByProvider("unknown" as ProviderKind).pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

it.effect("ProviderAdapterRegistryLive registers Cursor only when the adapter service is available", () =>
  Effect.gen(function* () {
    const registry = yield* ProviderAdapterRegistry;
    const cursor = yield* registry.getByProvider("cursor");
    assert.equal(cursor, fakeCursorAdapter);
    const providers = yield* registry.listProviders();
    assert.deepEqual(providers, ["codex", "claudeAgent", "opencode", "cursor"]);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.provide(
          ProviderAdapterRegistryLive,
          Layer.succeed(
            ProviderInstanceRegistry,
            makeFakeInstanceRegistry([
              { provider: "codex", adapter: fakeCodexAdapter },
              { provider: "claudeAgent", adapter: fakeClaudeAdapter },
              { provider: "opencode", adapter: fakeOpenCodeAdapter },
              { provider: "cursor", adapter: fakeCursorAdapter },
            ]),
          ),
        ),
        NodeServices.layer,
      ),
    ),
  ),
);
