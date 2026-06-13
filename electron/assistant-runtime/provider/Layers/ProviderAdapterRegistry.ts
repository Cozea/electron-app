// @ts-nocheck
/**
 * ProviderAdapterRegistryLive - Facade over ProviderInstanceRegistry.
 *
 * Provider instances own the concrete adapter instances; this registry keeps
 * legacy provider-kind lookups working by mapping them to default instance ids.
 *
 * @module ProviderAdapterRegistryLive
 */
import {
  defaultInstanceIdForDriver,
  ProviderInstanceId,
} from "@cozea/assistant-contracts";
import { Effect, Layer } from "effect";

import { ProviderUnsupportedError } from "../Errors.ts";
import {
  ProviderAdapterRegistry,
  type ProviderAdapterRegistryShape,
} from "../Services/ProviderAdapterRegistry.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";

const makeProviderAdapterRegistry = () =>
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;

    const getByInstance: ProviderAdapterRegistryShape["getByInstance"] = (instanceId) =>
      registry.getInstance(instanceId).pipe(
        Effect.flatMap((instance) =>
          instance === undefined
            ? Effect.fail(new ProviderUnsupportedError({ provider: instanceId }))
            : Effect.succeed(instance.adapter),
        ),
      );

    const getByProvider: ProviderAdapterRegistryShape["getByProvider"] = (provider) => {
      const instanceId = defaultInstanceIdForDriver(provider);
      return getByInstance(instanceId);
    };

    const listInstances: ProviderAdapterRegistryShape["listInstances"] = () =>
      registry.listInstances.pipe(
        Effect.map((instances) => instances.map((instance) => instance.instanceId)),
      );

    const listProviders: ProviderAdapterRegistryShape["listProviders"] = () =>
      registry.listInstances.pipe(
        Effect.map((instances) => {
          // Report every registered driver kind, deduplicated. Previously this
          // only counted an instance when it was the driver's default instance,
          // which silently excluded drivers that have only non-default instances.
          const providers = new Set();
          for (const instance of instances) {
            providers.add(instance.driverKind);
          }
          return Array.from(providers);
        }),
      );

    return {
      getByInstance,
      getByProvider,
      listInstances,
      listProviders,
      streamChanges: registry.streamChanges,
      subscribeChanges: registry.subscribeChanges,
    } satisfies ProviderAdapterRegistryShape;
  });

export const ProviderAdapterRegistryLive = Layer.effect(
  ProviderAdapterRegistry,
  makeProviderAdapterRegistry(),
);

export { makeProviderAdapterRegistry, ProviderInstanceId };
