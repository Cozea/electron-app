// @ts-nocheck
/**
 * Covers the settings-change → provider health re-run behavior that moved out
 * of ProviderRegistryLive into the per-instance driver machinery. Every
 * built-in provider (codex, claude, opencode, cursor) wraps its health checks
 * in makeManagedServerProvider, so this is the seam that guarantees a settings
 * edit re-runs the provider health check without an app restart.
 */
import { it, assert } from "@effect/vitest";
import { Effect, PubSub, Ref, Scope, Stream } from "effect";
import type { ServerProvider } from "@cozea/assistant-contracts";

import { makeManagedServerProvider } from "../../../../electron/assistant-runtime/provider/makeManagedServerProvider.ts";

interface TestSettings {
  readonly binaryPath: string;
  readonly enabled: boolean;
}

function snapshotForCheck(checkCount: number): ServerProvider {
  return {
    provider: "codex",
    status: "ready",
    enabled: true,
    installed: true,
    auth: { status: "authenticated" },
    checkedAt: `2026-03-25T00:00:0${Math.min(checkCount, 9)}.000Z`,
    version: `1.0.${checkCount}`,
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const awaitUntil = (
  condition: Effect.Effect<boolean>,
  attempts = 200,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let i = 0; i < attempts; i++) {
      if (yield* condition) {
        return;
      }
      yield* Effect.sleep("10 millis");
    }
    throw new Error("awaitUntil: condition not met in time");
  });

const initialSnapshot: ServerProvider = {
  provider: "codex",
  status: "initializing",
  enabled: true,
  installed: false,
  auth: { status: "unknown" },
  checkedAt: "2026-03-25T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
};

it.live("reruns the provider health check when settings change", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const settingsRef = yield* Ref.make<TestSettings>({
      binaryPath: "/usr/local/bin/codex",
      enabled: true,
    });
    const settingsPubSub = yield* PubSub.unbounded<TestSettings>();
    const checkCount = yield* Ref.make(0);

    const provider = yield* makeManagedServerProvider({
      getSettings: Ref.get(settingsRef),
      streamSettings: Stream.fromPubSub(settingsPubSub),
      haveSettingsChanged: (previous, next) =>
        previous.binaryPath !== next.binaryPath || previous.enabled !== next.enabled,
      initialSnapshot: () => initialSnapshot,
      checkProvider: Ref.updateAndGet(checkCount, (count) => count + 1).pipe(
        Effect.map(snapshotForCheck),
      ),
    }).pipe(Scope.provide(scope));


    yield* provider.refresh;
    // The constructor also forks its own initial forced refresh; give it time
    // to drain so the baseline below is stable.
    yield* Effect.sleep("150 millis");
    const baseline = yield* Ref.get(checkCount);
    assert.equal(baseline >= 1, true);

    // Unchanged settings: no re-check.
    yield* provider.getSnapshot;
    assert.equal(yield* Ref.get(checkCount), baseline);

    // Changed settings via the settings stream: health check re-runs and the
    // refreshed snapshot is published on streamChanges.
    const publishedRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([]);
    yield* provider.streamChanges.pipe(
      Stream.runForEach((snapshot) =>
        Ref.update(publishedRef, (current) => [...current, snapshot]),
      ),
      Effect.forkIn(scope),
    );
    // Give the subscriber a beat to attach before publishing.
    yield* Effect.sleep("50 millis");

    const changed = { binaryPath: "/opt/homebrew/bin/codex", enabled: true };
    yield* Ref.set(settingsRef, changed);
    yield* PubSub.publish(settingsPubSub, changed);
    yield* awaitUntil(Ref.get(checkCount).pipe(Effect.map((count) => count >= baseline + 1)));
    const afterChange = yield* Ref.get(checkCount);
    assert.equal(afterChange, baseline + 1);
    yield* awaitUntil(
      Ref.get(publishedRef).pipe(Effect.map((published) => published.length >= 1)),
    );

    // Re-publishing identical settings does not re-run the health check.
    yield* PubSub.publish(settingsPubSub, { ...changed });
    yield* Effect.sleep("50 millis");
    assert.equal(yield* Ref.get(checkCount), afterChange);

    yield* Scope.close(scope, undefined as never);
  }),
);

it.live("refresh forces a health re-run even when settings are unchanged", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const settingsRef = yield* Ref.make<TestSettings>({
      binaryPath: "/usr/local/bin/codex",
      enabled: true,
    });
    const checkCount = yield* Ref.make(0);

    const provider = yield* makeManagedServerProvider({
      getSettings: Ref.get(settingsRef),
      streamSettings: Stream.empty,
      haveSettingsChanged: (previous, next) => previous.binaryPath !== next.binaryPath,
      initialSnapshot: () => initialSnapshot,
      checkProvider: Ref.updateAndGet(checkCount, (count) => count + 1).pipe(
        Effect.map(snapshotForCheck),
      ),
    }).pipe(Scope.provide(scope));

    yield* provider.getSnapshot;
    const baseline = yield* Ref.get(checkCount);

    yield* provider.refresh;
    assert.equal(yield* Ref.get(checkCount), baseline + 1);

    yield* Scope.close(scope, undefined as never);
  }),
);
