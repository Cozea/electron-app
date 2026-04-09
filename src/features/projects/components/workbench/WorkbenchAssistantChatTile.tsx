import type { DockviewApi, DockviewPanelApi } from "dockview"
import { ArrowPathIcon as Loader2 } from "@heroicons/react/24/outline"

import { CozeaChatSurface } from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { WorkbenchAssistantDiffDialog } from "@/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog"
import { useWorkbenchAssistantTileController } from "@/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"

interface WorkbenchAssistantChatTileProps {
  projectId: string
  laneId: string
  projectPath: string | null
  tile: WorkbenchAssistantChatTileRecord
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  onDuplicate: (tileId: string) => void
}

export function WorkbenchAssistantChatTile(props: WorkbenchAssistantChatTileProps) {
  const { chatTitle, showTitleSpinner, diffDialog, closeDiffDialog, surfaceProps } =
    useWorkbenchAssistantTileController({
      projectId: props.projectId,
      laneId: props.laneId,
      projectPath: props.projectPath,
      tile: props.tile,
    })

  return (
    <>
      <WorkbenchTileChrome
        title={chatTitle}
        panelApi={props.panelApi}
        containerApi={props.containerApi}
        controls={
          <div className="flex min-w-0 items-center gap-2">
            {showTitleSpinner ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            <span className="truncate text-xs text-foreground" title={chatTitle}>
              {chatTitle}
            </span>
          </div>
        }
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
