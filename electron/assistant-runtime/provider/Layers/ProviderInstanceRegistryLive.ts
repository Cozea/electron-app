import {
  ProviderInstanceId,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
  type ProviderKind,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { Cause, Effect, Equal, Exit, Layer, PubSub, Ref, Schema, Scope, ServiceMap, Stream } from "effect";

import type { AnyProviderDriver, ProviderInstance } from "../ProviderDriver.ts";
import { asBuiltInProviderKind } from "../ProviderInstanceScopedSettings.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderInstanceRegistryMutator,
  type ProviderInstanceRegistryMutatorShape,
} from "../Services/ProviderInstanceRegistryMutator.ts";

interface LiveEntry {
  readonly instance: ProviderInstance;
  readonly scope: Scope.Closeable;
  readonly entry: ProviderInstanceConfig;
}

interface RegistryState {
  readonly entries: Ref.Ref<ReadonlyMap<ProviderInstanceId, LiveEntry>>;
  readonly unavailable: Ref.Ref<ReadonlyMap<ProviderInstanceId, ServerProvider>>;
  readonly changes: PubSub.PubSub<void>;
}

const entryEqual = (a: ProviderInstanceConfig, b: ProviderInstanceConfig): boolean =>
  Equal.equals(a, b);

const decodedConfigEnabled = (config: unknown): boolean | undefined => {
  if (!config || typeof config !== "object" || globalThis.Array.isArray(config)) {
    return undefined;
  }
  const enabled = (config as { readonly enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? enabled : undefined;
};

function buildUnavailableProviderSnapshot(input: {
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName?: string | undefined;
  readonly accentColor?: string | undefined;
  readonly reason: string;
}): ServerProvider {
  const provider = asBuiltInProviderKind(input.driverKind) ?? ("codex" as ProviderKind);
  return {
    provider,
    instanceId: input.instanceId,
    driver: input.driverKind,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    availability: "unavailable",
    unavailableReason: input.reason,
    enabled: false,
    installed: false,
    version: null,
    status: "error",
    auth: { status: "unknown" },
    checkedAt: new Date().toISOString(),
    message: input.reason,
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const buildEntry = <R>(input: {
  readonly driversById: ReadonlyMap<ProviderDriverKind, AnyProviderDriver<R>>;
  readonly parentScope: Scope.Scope;
  readonly instanceId: ProviderInstanceId;
  readonly rawInstanceId: string;
  readonly entry: ProviderInstanceConfig;
}): Effect.Effect<
  | { readonly kind: "live"; readonly live: LiveEntry }
  | { readonly kind: "unavailable"; readonly snapshot: ServerProvider },
  never,
  R
> =>
  Effect.gen(function* () {
    const { driversById, parentScope, instanceId, rawInstanceId, entry } = input;
    const driver = driversById.get(entry.driver);
    if (!driver) {
      return {
        kind: "unavailable" as const,
        snapshot: buildUnavailableProviderSnapshot({
          driverKind: entry.driver,
          instanceId,
          displayName: entry.displayName,
          accentColor: entry.accentColor,
          reason: `Driver '${entry.driver}' is not registered in this Cozea build.`,
        }),
      };
    }

    const decoder = Schema.decodeUnknownEffect(driver.configSchema);
    const decodeExit = yield* Effect.exit(decoder(entry.config ?? driver.defaultConfig()));
    if (decodeExit._tag === "Failure") {
      const detail = Cause.pretty(decodeExit.cause);
      yield* Effect.logError("Failed to decode provider instance config", {
        instanceId: rawInstanceId,
        driver: entry.driver,
        detail,
      });
      return {
        kind: "unavailable" as const,
        snapshot: buildUnavailableProviderSnapshot({
          driverKind: entry.driver,
          instanceId,
          displayName: entry.displayName,
          accentColor: entry.accentColor,
          reason: `Invalid config for instance '${rawInstanceId}': ${detail}`,
        }),
      };
    }

    // Use Scope.fork (not Scope.make + addFinalizer) so the parent-scope finalizer
    // registered for this child is removed when the child scope is closed directly
    // on reconcile (remove/replace). With Scope.make the parent finalizer would
    // never be detached, growing the parent's finalizer list unbounded across
    // reconciles. Scope.fork links the child to the parent and self-cleans on close.
    const childScope = yield* Scope.fork(parentScope);
    const typedConfig = decodeExit.value;
    const createExit = yield* Effect.exit(
      driver
        .create({
          instanceId,
          displayName: entry.displayName,
          accentColor: entry.accentColor,
          environment: entry.environment ?? [],
          enabled: entry.enabled ?? decodedConfigEnabled(typedConfig) ?? true,
          config: typedConfig,
          rawConfig: entry,
        })
        .pipe(Effect.provideService(Scope.Scope, childScope)),
    );
    if (createExit._tag === "Failure") {
      const detail = Cause.pretty(createExit.cause);
      yield* Scope.close(childScope, Exit.void).pipe(Effect.ignore);
      yield* Effect.logError("Failed to create provider instance", {
        instanceId: rawInstanceId,
        driver: entry.driver,
        detail,
      });
      return {
        kind: "unavailable" as const,
        snapshot: buildUnavailableProviderSnapshot({
          driverKind: entry.driver,
          instanceId,
          displayName: entry.displayName,
          accentColor: entry.accentColor,
          reason: `Driver '${entry.driver}' failed to create instance: ${detail}`,
        }),
      };
    }

    return {
      kind: "live" as const,
      live: {
        instance: createExit.value,
        scope: childScope,
        entry,
      },
    };
  });

const makeReconcile = <R>(input: {
  readonly state: RegistryState;
  readonly driversById: ReadonlyMap<ProviderDriverKind, AnyProviderDriver<R>>;
  readonly parentScope: Scope.Scope;
}) => {
  const { state, driversById, parentScope } = input;
  return (configMap: ProviderInstanceConfigMap) =>
    Effect.gen(function* () {
      const previousEntries = yield* Ref.get(state.entries);
      const previousUnavailable = yield* Ref.get(state.unavailable);
      const nextRaw = Object.entries(configMap);
      const nextKeys = new Set<ProviderInstanceId>(
        nextRaw.map(([raw]) => ProviderInstanceId.make(raw)),
      );

      const removedIds: Array<ProviderInstanceId> = [];
      const replacedIds = new Set<ProviderInstanceId>();
      for (const [instanceId, live] of previousEntries) {
        if (!nextKeys.has(instanceId)) {
          removedIds.push(instanceId);
          continue;
        }
        const nextEntry = configMap[instanceId];
        if (nextEntry !== undefined && !entryEqual(live.entry, nextEntry)) {
          replacedIds.add(instanceId);
        }
      }
      for (const id of [...removedIds, ...replacedIds]) {
        const live = previousEntries.get(id);
        if (live) {
          yield* Scope.close(live.scope, Exit.void).pipe(Effect.ignore);
        }
      }

      const builtEntries = new Map<ProviderInstanceId, LiveEntry>();
      const builtUnavailable = new Map<ProviderInstanceId, ServerProvider>();
      const previousOrder = [...previousEntries.keys()];
      const nextOrder: Array<ProviderInstanceId> = [];

      for (const [rawInstanceId, entry] of nextRaw) {
        const instanceId = ProviderInstanceId.make(rawInstanceId);
        nextOrder.push(instanceId);
        const existing = previousEntries.get(instanceId);
        if (existing !== undefined && !replacedIds.has(instanceId)) {
          builtEntries.set(instanceId, existing);
          continue;
        }
        const result = yield* buildEntry({
          driversById,
          parentScope,
          instanceId,
          rawInstanceId,
          entry,
        });
        if (result.kind === "live") {
          builtEntries.set(instanceId, result.live);
        } else {
          builtUnavailable.set(instanceId, result.snapshot);
        }
      }

      const orderChanged =
        previousOrder.length !== nextOrder.length ||
        previousOrder.some((id, index) => id !== nextOrder[index]);
      const entriesChanged =
        orderChanged ||
        removedIds.length > 0 ||
        replacedIds.size > 0 ||
        builtEntries.size !== previousEntries.size;
      const unavailableChanged =
        builtUnavailable.size !== previousUnavailable.size ||
        [...builtUnavailable].some(([id, snapshot]) => {
          const prev = previousUnavailable.get(id);
          return prev === undefined || !Equal.equals(prev, snapshot);
        }) ||
        [...previousUnavailable].some(([id]) => !builtUnavailable.has(id));

      yield* Ref.set(state.entries, builtEntries);
      yield* Ref.set(state.unavailable, builtUnavailable);
      if (entriesChanged || unavailableChanged) {
        yield* PubSub.publish(state.changes, undefined);
      }
    });
};

export const makeProviderInstanceRegistry = <R>(input: {
  readonly drivers: ReadonlyArray<AnyProviderDriver<R>>;
  readonly configMap: ProviderInstanceConfigMap;
}): Effect.Effect<
  {
    readonly registry: ProviderInstanceRegistryShape;
    readonly mutator: ProviderInstanceRegistryMutatorShape;
  },
  never,
  R | Scope.Scope
> =>
  Effect.gen(function* () {
    const driversById = new Map<ProviderDriverKind, AnyProviderDriver<R>>(
      input.drivers.map((driver) => [driver.driverKind, driver]),
    );
    const parentScope = yield* Scope.Scope;
    const driverContext = yield* Effect.services<R>();
    const entries = yield* Ref.make<ReadonlyMap<ProviderInstanceId, LiveEntry>>(new Map());
    const unavailable = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ServerProvider>>(new Map());
    const changes = yield* PubSub.unbounded<void>();
    yield* Effect.addFinalizer(() => PubSub.shutdown(changes));

    const state: RegistryState = { entries, unavailable, changes };
    const reconcileWithR = makeReconcile({ state, driversById, parentScope });
    const reconcile: ProviderInstanceRegistryMutatorShape["reconcile"] = (configMap) =>
      reconcileWithR(configMap).pipe(Effect.provideServices(driverContext));
    yield* reconcile(input.configMap);

    const registry: ProviderInstanceRegistryShape = {
      getInstance: (id) => Ref.get(entries).pipe(Effect.map((map) => map.get(id)?.instance)),
      listInstances: Ref.get(entries).pipe(
        Effect.map((map) => Array.from(map.values(), (live) => live.instance)),
      ),
      listUnavailable: Ref.get(unavailable).pipe(
        Effect.map((map) => Array.from(map.values())),
      ),
      get streamChanges() {
        return Stream.fromPubSub(changes);
      },
      get subscribeChanges() {
        return PubSub.subscribe(changes);
      },
    };

    return { registry, mutator: { reconcile } };
  });

export const ProviderInstanceRegistryMutableLayer = <R>(input: {
  readonly drivers: ReadonlyArray<AnyProviderDriver<R>>;
  readonly configMap: ProviderInstanceConfigMap;
}) =>
  Layer.effectServices(
    makeProviderInstanceRegistry(input).pipe(
      Effect.map(({ registry, mutator }) =>
        ServiceMap.make(ProviderInstanceRegistry, registry).pipe(
          ServiceMap.add(ProviderInstanceRegistryMutator, mutator),
        ),
      ),
    ),
  );
