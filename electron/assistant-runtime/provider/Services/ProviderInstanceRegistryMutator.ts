import type { ProviderInstanceConfigMap } from "@cozea/assistant-contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

export interface ProviderInstanceRegistryMutatorShape {
  readonly reconcile: (configMap: ProviderInstanceConfigMap) => Effect.Effect<void>;
}

export class ProviderInstanceRegistryMutator extends ServiceMap.Service<
  ProviderInstanceRegistryMutator,
  ProviderInstanceRegistryMutatorShape
>()("cozea/assistant-runtime/provider/Services/ProviderInstanceRegistryMutator") {}
