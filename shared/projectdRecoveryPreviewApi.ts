import type { ProjectdRecoveryPreviewResult } from "@cozea/projectd-protocol"
import type { ProjectdCallFailure } from "./electronApiTypes"

/**
 * Renderer bridge extension for frozen, device-local collaboration recovery inspection.
 * Kept separate from the broad ElectronAPI surface so the preview can land without
 * weakening the preload's `satisfies ElectronAPI` excess-property checks.
 */
export interface ProjectdRecoveryPreviewBridge {
  previewRecovery: (
    publicSessionId: string,
    afterCursor?: string,
    limit?: number,
  ) => Promise<{ success: true; preview: ProjectdRecoveryPreviewResult } | ProjectdCallFailure>
}
