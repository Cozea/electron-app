import type { ServerConfig } from "@cozea/assistant-contracts"

import { useAssistantRuntimeMetadata } from "./assistantRuntimeMetadataStore"
import { useSubstrateChatTransport } from "@/substrate/useSubstrateChatTransport"
import { useT3ServerConfigCutover } from "@/substrate/useT3ServerConfigCutover"

export function useAssistantServerConfig(enabled: boolean) {
  const substrateTransport = useSubstrateChatTransport()
  useT3ServerConfigCutover({
    substrateActive: substrateTransport.active,
    shadowBaseUrl: substrateTransport.shadowBaseUrl,
  })
  const metadata = useAssistantRuntimeMetadata()

  return {
    config: metadata.config as ServerConfig | null,
    error: enabled ? metadata.configError : null,
    isLoading: enabled ? metadata.isConfigLoading : false,
  }
}
