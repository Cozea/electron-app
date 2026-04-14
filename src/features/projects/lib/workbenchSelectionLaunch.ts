import type { ProviderKind } from "@cozea/assistant-contracts"

import type { WorkbenchTileType } from "@/stores/useProjectWorkbenchStore"

export interface WorkbenchSelectionLaunchRequest {
  type: Extract<
    WorkbenchTileType,
    "assistantChat" | "browser" | "devServer" | "mobileSimulator" | "terminal"
  >
  provider?: ProviderKind
}
