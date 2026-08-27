import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
import { CozeaChatSurface } from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { WorkbenchAssistantDiffDialog } from "@/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog"
import { useWorkbenchAssistantTileController } from "@/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"

import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon as __DeleteHugeIcon } from "@hugeicons/core-free-icons"

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
  const { chatTitle, diffDialog, closeDiffDialog, handleDeleteThread, surfaceProps } =
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
        actions={
          props.tile.threadId ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent"
              aria-label="Delete thread"
              title="Delete thread"
              onClick={() => {
                void handleDeleteThread().then((deleted) => {
                  if (deleted) {
                    // Close the tile without freezing navigation — panel close is local.
                    props.panelApi.close()
                  }
                })
              }}
            >
              <HugeiconsIcon icon={__DeleteHugeIcon} className="h-3.5 w-3.5" />
            </Button>
          ) : null
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
