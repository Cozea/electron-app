import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { CozeaChatSurface } from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { WorkbenchAssistantDiffDialog } from "@/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog"
import { useWorkbenchAssistantTileController } from "@/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchAssistantChatTileProps {
  projectId: string
  laneId: string
  workspaceId: string | null
  projectRootPath: string | null
  tile: WorkbenchAssistantChatTileRecord
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  onDuplicate: (tileId: string) => void
}

export function WorkbenchAssistantChatTile(props: WorkbenchAssistantChatTileProps) {
  const { chatTitle, diffDialog, closeDiffDialog, surfaceProps } =
    useWorkbenchAssistantTileController({
      projectId: props.projectId,
      laneId: props.laneId,
      workspaceId: props.workspaceId,
      projectRootPath: props.projectRootPath,
      tile: props.tile,
    })

  return (
    <>
      <WorkbenchTileChrome
        title={chatTitle}
        panelApi={props.panelApi}
        containerApi={props.containerApi}
        chromeVariant="pill"
        tileType="assistantChat"
        assistantProvider={props.tile.provider}
      >
        <CozeaChatSurface {...surfaceProps} />
      </WorkbenchTileChrome>

      <WorkbenchAssistantDiffDialog
        state={diffDialog}
        onOpenChange={(open) => {
          if (!open) {
            closeDiffDialog()
          }
        }}
      />
    </>
  )
}
