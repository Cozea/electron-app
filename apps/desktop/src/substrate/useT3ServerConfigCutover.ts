import {
  useAssistantRuntimeMetadata,
} from "@/features/assistant/model/assistantRuntimeMetadataStore";
import { readAvailableNativeApi } from "@/lib/nativeApi";
import { useT3CutoverActive } from "./t3CutoverStore";

export interface T3ServerConfigCutoverState {
  readonly active: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refreshProviders: (() => Promise<void>) | null;
}

/**
 * Compatibility consumer retained for older surfaces. Full T3/config lifecycle
 * is app-owned now; this hook must never create its own RPC session or bridge.
 */
export function useT3ServerConfigCutover(input: {
  readonly substrateActive: boolean;
  readonly shadowBaseUrl: string | null;
}): T3ServerConfigCutoverState {
  const metadata = useAssistantRuntimeMetadata();
  const cutoverActive = useT3CutoverActive();
  const active = input.substrateActive && cutoverActive;

  return {
    active,
    loading: input.substrateActive ? !active || metadata.isConfigLoading : false,
    error: input.substrateActive ? metadata.configError : null,
    refreshProviders: active
      ? async () => {
          const api = readAvailableNativeApi();
          if (!api) throw new Error("Local agent runtime is unavailable.");
          await api.server.refreshProviders();
        }
      : null,
  };
}
