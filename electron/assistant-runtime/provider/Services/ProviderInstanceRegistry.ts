// @ts-nocheck
import type { ProviderInstanceId, ServerProvider } from "@cozea/assistant-contracts";
import { ServiceMap } from "effect";
import type { Effect, PubSub, Scope, Stream } from "effect";

import type { ProviderInstance } from "../ProviderDriver.ts";

export interface ProviderInstanceRegistryShape {
  readonly getInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderInstance | undefined>;
  readonly listInstances: Effect.Effect<ReadonlyArray<ProviderInstance>>;
  readonly listUnavailable: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly streamChanges: Stream.Stream<void>;
  readonly subscribeChanges: Effect.Effect<PubSub.Subscription<void>, never, Scope.Scope>;
}

export class ProviderInstanceRegistry extends ServiceMap.Service<
  ProviderInstanceRegistry,
  ProviderInstanceRegistryShape
>()("cozea/assistant-runtime/provider/Services/ProviderInstanceRegistry") {}
