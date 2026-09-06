import type { ServerConfig } from "@cozea/assistant-contracts"

import { useAssistantRuntimeMetadata } from "@/features/assistant/model/assistantRuntimeMetadataStore"

/** Read app-owned agent runtime metadata without creating another T3 session. */
export function useAssistantServerConfig(enabled: boolean) {
  const metadata = useAssistantRuntimeMetadata()

  return {
    config: metadata.config as ServerConfig | null,
    error: enabled ? metadata.configError : null,
    isLoading: enabled ? metadata.isConfigLoading : false,
  }
}
