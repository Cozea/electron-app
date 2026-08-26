// @ts-nocheck
/**
 * ProviderRegistryLive - Aggregates provider instance snapshot services.
 *
 * Provider snapshots now come from ProviderInstanceRegistry entries instead of
 * one singleton provider layer per built-in provider kind.
 *
 * @module ProviderRegistryLive
 */
import {
  defaultInstanceIdForDriver,
  type ProviderInstanceId,
  type ProviderKind,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { Effect, Equal, FileSystem, Layer, Path, PubSub, Ref, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry";
import {
  hydrateCachedProvider,
  orderProviderSnapshots,
  readProviderStatusCache,
  resolveProviderStatusCachePath,
  writeProviderStatusCache,
} from "../providerStatusCache";
import type { ProviderInstance } from "../ProviderDriver.ts";

interface ProviderSnapshotSource {
  readonly instanceId: ProviderInstanceId;
  readonly provider: ProviderKind;
  readonly driverKind: ProviderKind;
  readonly getSnapshot: Effect.Effect<ServerProvider>;
  readonly refresh: Effect.Effect<ServerProvider>;
  readonly streamChanges: Stream.Stream<ServerProvider>;
}

const snapshotInstanceKey = (provider: ServerProvider): ProviderInstanceId =>
  provider.instanceId ?? defaultInstanceIdForDriver(provider.provider);

const correlateSnapshotWithSource = (
  source: ProviderSnapshotSource,
  snapshot: ServerProvider,
): ServerProvider => ({
  ...snapshot,
  instanceId: source.instanceId,
  driver: source.driverKind,
});

const buildSnapshotSource = (instance: ProviderInstance): ProviderSnapshotSource => ({
  instanceId: instance.instanceId,
  provider: instance.adapter.provider,
  driverKind: instance.driverKind,
  getSnapshot: instance.snapshot.getSnapshot,
  refresh: instance.snapshot.refresh,
  streamChanges: instance.snapshot.streamChanges,
});

const loadProviders = (
  providerSources: ReadonlyArray<ProviderSnapshotSource>,
): Effect.Effect<ReadonlyArray<ServerProvider>> =>
  Effect.forEach(
    providerSources,
    (providerSource) =>
      providerSource.getSnapshot.pipe(
        Effect.map((snapshot) => correlateSnapshotWithSource(providerSource, snapshot)),
      ),
    {
      concurrency: "unbounded",
    },
  );

const hasModelCapabilities = (model: ServerProvider["models"][number]): boolean =>
  (model.capabilities?.optionDescriptors?.length ?? 0) > 0 ||
  (model.capabilities?.reasoningEffortLevels.length ?? 0) > 0 ||
  model.capabilities?.supportsFastMode === true ||
  model.capabilities?.supportsThinkingToggle === true ||
  (model.capabilities?.contextWindowOptions.length ?? 0) > 0 ||
  (model.capabilities?.promptInjectedEffortLevels.length ?? 0) > 0;

const TRANSIENT_PROVIDER_ERROR_MARKERS = [
  "timed out",
  "timeout",
  "couldn't reach",
  "failed to connect",
] as const;

const mergeProviderModels = (
  previousModels: ReadonlyArray<ServerProvider["models"][number]>,
  nextModels: ReadonlyArray<ServerProvider["models"][number]>,
): ReadonlyArray<ServerProvider["models"][number]> => {
  if (nextModels.length === 0 && previousModels.length > 0) {
    return previousModels;
  }

  const previousBySlug = new Map(previousModels.map((model) => [model.slug, model] as const));
  const mergedModels = nextModels.map((model) => {
    const previousModel = previousBySlug.get(model.slug);
    if (!previousModel || hasModelCapabilities(model) || !hasModelCapabilities(previousModel)) {
      return model;
    }
    return {
      ...model,
      capabilities: previousModel.capabilities,
    };
  });
  const nextSlugs = new Set(nextModels.map((model) => model.slug));
  return [...mergedModels, ...previousModels.filter((model) => !nextSlugs.has(model.slug))];
};

const shouldRetainPreviousProviderAvailability = (
  previousProvider: ServerProvider,
  nextProvider: ServerProvider,
): boolean => {
  if (nextProvider.status !== "error") {
    return false;
  }
  if (!previousProvider.enabled || !previousProvider.installed || previousProvider.models.length === 0) {
    return false;
  }
  if (!nextProvider.installed || nextProvider.auth.status === "unauthenticated") {
    return false;
  }

  const lowerMessage = nextProvider.message?.toLowerCase() ?? "";
  return TRANSIENT_PROVIDER_ERROR_MARKERS.some((marker) => lowerMessage.includes(marker));
};

export const mergeProviderSnapshot = (
  previousProvider: ServerProvider | undefined,
  nextProvider: ServerProvider,
): ServerProvider =>
  !previousProvider
    ? nextProvider
    : (() => {
        const mergedProvider: ServerProvider = {
          ...nextProvider,
          models: mergeProviderModels(previousProvider.models, nextProvider.models),
        };

        if (!shouldRetainPreviousProviderAvailability(previousProvider, nextProvider)) {
          return mergedProvider;
        }

        return {
          ...mergedProvider,
          status: "warning",
          message: nextProvider.message
            ? `Using last known provider metadata while the latest health check recovers. ${nextProvider.message}`
            : previousProvider.message,
        };
      })();

export const haveProvidersChanged = (
  previousProviders: ReadonlyArray<ServerProvider>,
  nextProviders: ReadonlyArray<ServerProvider>,
): boolean => !Equal.equals(previousProviders, nextProviders);

export const ProviderRegistryLive = Layer.effect(
  ProviderRegistry,
  Effect.gen(function* () {
    const instanceRegistry = yield* ProviderInstanceRegistry;
    const config = yield* ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const changesPubSub = yield* Effect.acquireRelease(
      PubSub.unbounded<ReadonlyArray<ServerProvider>>(),
      PubSub.shutdown,
    );

    const bootInstances = yield* instanceRegistry.listInstances;
    const bootSources = bootInstances.map(buildSnapshotSource);
    const fallbackProviders = yield* loadProviders(bootSources).pipe(
      Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProvider>),
    );
    const fallbackByInstance = new Map(
      fallbackProviders.map((provider) => [snapshotInstanceKey(provider), provider] as const),
    );

    const cachedProviders = yield* Effect.forEach(
      bootSources,
      (source) => {
        const filePath = resolveProviderStatusCachePath({
          cacheDir: config.providerStatusCacheDir,
          instanceId: source.instanceId,
        });
        const fallbackProvider = fallbackByInstance.get(source.instanceId);
        if (!fallbackProvider) {
          return Effect.succeed(undefined);
        }
        return readProviderStatusCache(filePath).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.map((cachedProvider) =>
            cachedProvider === undefined
              ? undefined
              : hydrateCachedProvider({
                  cachedProvider,
                  fallbackProvider,
                }),
          ),
        );
      },
      { concurrency: "unbounded" },
    ).pipe(
      Effect.map((providers) =>
        orderProviderSnapshots(
          providers.filter((provider): provider is ServerProvider => provider !== undefined),
        ),
      ),
    );
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>(cachedProviders);
    const liveSubsRef = yield* Ref.make<ReadonlyMap<ProviderInstanceId, ProviderInstance>>(
      new Map(),
    );
    const syncSemaphore = yield* Semaphore.make(1);

    const getLiveSources = Ref.get(liveSubsRef).pipe(
      Effect.map((map) => Array.from(map.values(), buildSnapshotSource)),
    );

    const persistProvider = (provider: ServerProvider) => {
      const filePath = resolveProviderStatusCachePath({
        cacheDir: config.providerStatusCacheDir,
        instanceId: snapshotInstanceKey(provider),
      });
      return writeProviderStatusCache({
        filePath,
        provider,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.tapError(Effect.logError),
        Effect.ignore,
      );
    };

    const upsertProviders = Effect.fn(function* (
      nextProviders: ReadonlyArray<ServerProvider>,
      options?: {
        readonly publish?: boolean;
        readonly persist?: boolean;
        readonly replace?: boolean;
      },
    ) {
      const [previousProviders, providers, providersToPersist] = yield* Ref.modify(
        providersRef,
        (previousProviders) => {
          const mergedProviders = new Map(
            previousProviders.map((provider) => [snapshotInstanceKey(provider), provider] as const),
          );
          const updatedKeys = new Set<ProviderInstanceId>();

          for (const provider of nextProviders) {
            const key = snapshotInstanceKey(provider);
            updatedKeys.add(key);
            mergedProviders.set(
              key,
              options?.replace === true
                ? provider
                : mergeProviderSnapshot(mergedProviders.get(key), provider),
            );
          }

          const providers = orderProviderSnapshots([...mergedProviders.values()]);
          const providersToPersist = providers.filter((provider) =>
            updatedKeys.has(snapshotInstanceKey(provider)),
          );
          return [[previousProviders, providers, providersToPersist] as const, providers];
        },
      );

      if (haveProvidersChanged(previousProviders, providers)) {
        if (options?.persist !== false) {
          yield* Effect.forEach(providersToPersist, persistProvider, {
            concurrency: "unbounded",
            discard: true,
          });
        }
        if (options?.publish !== false) {
          yield* PubSub.publish(changesPubSub, providers);
        }
      }

      return providers;
    });

    const syncProvider = Effect.fn(function* (
      provider: ServerProvider,
      options?: {
        readonly publish?: boolean;
      },
    ) {
      return yield* upsertProviders([provider], options);
    });

    const refreshOneSource = Effect.fn(function* (providerSource: ProviderSnapshotSource) {
      return yield* providerSource.refresh.pipe(
        Effect.map((snapshot) => correlateSnapshotWithSource(providerSource, snapshot)),
        Effect.flatMap(syncProvider),
      );
    });

    const refresh = Effect.fn(function* (provider?: ProviderKind) {
      const sources = yield* getLiveSources;
      if (provider) {
        const providerSource = sources.find(
          (candidate) => candidate.instanceId === defaultInstanceIdForDriver(provider),
        );
        if (!providerSource) {
          return yield* Ref.get(providersRef);
        }
        return yield* refreshOneSource(providerSource);
      }

      return yield* Effect.forEach(sources, (source) => refreshOneSource(source), {
        concurrency: "unbounded",
        discard: true,
      }).pipe(Effect.andThen(Ref.get(providersRef)));
    });

    const syncLiveSources = syncSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const instances = yield* instanceRegistry.listInstances;
        const unavailableProviders = yield* instanceRegistry.listUnavailable;
        const nextByInstance = new Map<ProviderInstanceId, ProviderInstance>(
          instances.map((instance) => [instance.instanceId, instance] as const),
        );
        const knownInstanceIds = new Set<ProviderInstanceId>(nextByInstance.keys());
        for (const provider of unavailableProviders) {
          knownInstanceIds.add(snapshotInstanceKey(provider));
        }

        const previousSubs = yield* Ref.get(liveSubsRef);
        const carriedOver = new Map<ProviderInstanceId, ProviderInstance>();
        for (const [instanceId, previousInstance] of previousSubs) {
          const nextInstance = nextByInstance.get(instanceId);
          if (nextInstance !== undefined && nextInstance === previousInstance) {
            carriedOver.set(instanceId, previousInstance);
          }
        }

        const newlyAdded: Array<readonly [ProviderInstanceId, ProviderInstance]> = [];
        for (const [instanceId, instance] of nextByInstance) {
          if (!carriedOver.has(instanceId)) {
            newlyAdded.push([instanceId, instance] as const);
          }
        }

        for (const [, instance] of newlyAdded) {
          const source = buildSnapshotSource(instance);
          yield* Stream.runForEach(source.streamChanges, (provider) =>
            syncProvider(correlateSnapshotWithSource(source, provider)),
          ).pipe(Effect.forkScoped);
        }

        yield* Effect.forEach(
          newlyAdded,
          ([, instance]) =>
            refreshOneSource(buildSnapshotSource(instance)).pipe(Effect.ignoreCause({ log: true })),
          { concurrency: "unbounded", discard: true },
        );
        yield* upsertProviders(unavailableProviders, {
          persist: false,
          replace: true,
        });

        const nextSubs = new Map(carriedOver);
        for (const [instanceId, instance] of newlyAdded) {
          nextSubs.set(instanceId, instance);
        }
        yield* Ref.set(liveSubsRef, nextSubs);

        const [previousProviders, providers] = yield* Ref.modify(
          providersRef,
          (previousProviders) => {
            const providers = orderProviderSnapshots(
              previousProviders.filter((provider) =>
                knownInstanceIds.has(snapshotInstanceKey(provider)),
              ),
            );
            return [[previousProviders, providers] as const, providers];
          },
        );
        if (haveProvidersChanged(previousProviders, providers)) {
          yield* PubSub.publish(changesPubSub, providers);
        }
      }),
    );

    yield* upsertProviders(fallbackProviders, { publish: false });
    const instanceChanges = yield* instanceRegistry.subscribeChanges;
    yield* syncLiveSources;
    yield* Stream.runForEach(
      Stream.fromSubscription(instanceChanges),
      () => syncLiveSources.pipe(Effect.ignoreCause({ log: true })),
    ).pipe(Effect.forkScoped);

    return {
      getProviders: Ref.get(providersRef),
      refresh: (provider?: ProviderKind) =>
        refresh(provider).pipe(
          Effect.tapError(Effect.logError),
          Effect.orElseSucceed(() => [] as ReadonlyArray<ServerProvider>),
        ),
      get streamChanges() {
        return Stream.fromPubSub(changesPubSub);
      },
    } satisfies ProviderRegistryShape;
  }),
);
