import type { ServerConfig } from "@cozea/assistant-contracts"

import { useAssistantRuntimeMetadata } from "./assistantRuntimeMetadataStore"
import { useSubstrateChatTransport } from "@/substrate/useSubstrateChatTransport"
import { useT3Cutover } from "@/substrate/useT3Cutover"

export function useAssistantServerConfig(enabled: boolean) {
  const substrateTransport = useSubstrateChatTransport()
  useT3Cutover({
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
