import { useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CozeaChatSurface } from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { ThreadArtifactsView } from "@/features/projects/components/assistant/artifacts/ThreadArtifactsView"
import { WorkbenchAssistantDiffDialog } from "@/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog"
import { useWorkbenchAssistantTileController } from "@/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"
import { flushWorkbenchStorage, useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeftRightIcon as __ChatHugeIcon, Delete02Icon as __DeleteHugeIcon, Image01Icon as __ImageHugeIcon } from "@hugeicons/core-free-icons"

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

function AssistantTileHeaderViewTabs(props: {
  viewMode: "chat" | "artifacts"
  artifactCount: number
  onChange: (viewMode: "chat" | "artifacts") => void
}) {
  return (
    <div
      className="inline-flex h-7 items-center gap-0.5 rounded-md bg-secondary px-0.5 shadow-none"
      role="tablist"
      aria-label="Agent tile view"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="tab"
            aria-selected={props.viewMode === "chat"}
            aria-label="Chat"
            className={cn(
              "flex size-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring",
              props.viewMode === "chat" && "bg-background text-foreground shadow-xs",
            )}
            onClick={() => props.onChange("chat")}
          >
            <HugeiconsIcon icon={__ChatHugeIcon} className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Chat</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            role="tab"
            aria-selected={props.viewMode === "artifacts"}
            aria-label="Artifacts"
            className={cn(
              "relative flex size-6 items-center justify-center rounded-[5px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-ring",
              props.viewMode === "artifacts" && "bg-background text-foreground shadow-xs",
            )}
            onClick={() => props.onChange("artifacts")}
          >
            <HugeiconsIcon icon={__ImageHugeIcon} className="size-3.5" />
            {props.artifactCount > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 flex size-2 rounded-full bg-primary" />
            ) : null}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Artifacts{props.artifactCount > 0 ? ` (${props.artifactCount})` : ""}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function WorkbenchAssistantChatTile(props: WorkbenchAssistantChatTileProps) {
  const { chatTitle, diffDialog, closeDiffDialog, handleDeleteThread, surfaceProps, artifacts, artifactMedia } =
    useWorkbenchAssistantTileController({
      projectId: props.projectId,
      laneId: props.laneId,
      workspaceId: props.workspaceId,
      projectRootPath: props.projectRootPath,
      tile: props.tile,
    })
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const viewMode = props.tile.viewMode === "artifacts" ? "artifacts" : "chat"

  const setViewMode = (nextMode: "chat" | "artifacts") => {
    updateAssistantTile(
      props.projectId,
      props.laneId,
      props.tile.id,
      { viewMode: nextMode },
      props.workspaceId,
    )
    void flushWorkbenchStorage()
  }

  const openArtifact = (artifactId: string) => {
    setSelectedArtifactId(artifactId)
    setViewMode("artifacts")
  }

  return (
    <>
      <WorkbenchTileChrome
        title={chatTitle}
        panelApi={props.panelApi}
        containerApi={props.containerApi}
        chromeVariant="pill"
        contentClassName="overflow-hidden"
        tileType="assistantChat"
        assistantProvider={props.tile.provider}
        controls={
          <AssistantTileHeaderViewTabs
            viewMode={viewMode}
            artifactCount={artifacts.length}
            onChange={setViewMode}
          />
        }
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
        <div className="relative h-full min-h-0 flex-1 overflow-hidden">
          <div
            className={cn("absolute inset-0", viewMode !== "chat" && "hidden")}
            aria-hidden={viewMode !== "chat"}
          >
            <CozeaChatSurface {...surfaceProps} artifactUrlsById={artifactMedia.urlsById} onOpenArtifact={openArtifact} />
          </div>
          <div
            className={cn("absolute inset-0", viewMode !== "artifacts" && "hidden")}
            aria-hidden={viewMode !== "artifacts"}
          >
            <ThreadArtifactsView
              artifacts={artifacts}
              media={artifactMedia}
              selectedArtifactId={selectedArtifactId}
              onSelectedArtifactChange={setSelectedArtifactId}
            />
          </div>
        </div>
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
