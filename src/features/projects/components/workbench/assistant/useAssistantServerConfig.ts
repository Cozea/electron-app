import type { ServerConfig } from "@cozea/assistant-contracts"

import { useAssistantRuntimeMetadata } from "./assistantRuntimeMetadataStore"

export function useAssistantServerConfig(enabled: boolean) {
  const metadata = useAssistantRuntimeMetadata()

  return {
    config: metadata.config as ServerConfig | null,
    error: enabled ? metadata.configError : null,
    isLoading: enabled ? metadata.isConfigLoading : false,
  }
}
