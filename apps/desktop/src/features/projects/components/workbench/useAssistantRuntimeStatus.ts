import type {
  AssistantRuntimeBridgeStatus as AssistantRuntimeStatus,
  AssistantRuntimePhase,
} from "@/lib/desktopBridgeClient"

import { useAssistantRuntimeMetadata } from "@/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore"

export type { AssistantRuntimePhase, AssistantRuntimeStatus }

export function useAssistantRuntimeStatus(): AssistantRuntimeStatus {
  return useAssistantRuntimeMetadata().status
}
