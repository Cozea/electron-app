import { useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
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

function AssistantTileViewTabs(props: {
  viewMode: "chat" | "artifacts"
  artifactCount: number
  onChange: (viewMode: "chat" | "artifacts") => void
}) {
  return (
    <div
      className="inline-flex h-7 items-center rounded-md bg-secondary/70 p-0.5"
      role="tablist"
      aria-label="Agent tile view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.viewMode === "chat"}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[10px] text-muted-foreground transition-colors",
          props.viewMode === "chat" && "bg-background text-foreground shadow-sm",
        )}
        onClick={() => props.onChange("chat")}
      >
        <HugeiconsIcon icon={__ChatHugeIcon} className="size-3" />
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={props.viewMode === "artifacts"}
        className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[10px] text-muted-foreground transition-colors",
          props.viewMode === "artifacts" && "bg-background text-foreground shadow-sm",
        )}
        onClick={() => props.onChange("artifacts")}
      >
        <HugeiconsIcon icon={__ImageHugeIcon} className="size-3" />
        Artifacts
        {props.artifactCount > 0 ? (
          <span className="tabular-nums text-[9px] text-muted-foreground">{props.artifactCount}</span>
        ) : null}
      </button>
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
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-9 shrink-0 items-center border-b border-border/50 px-3">
            <AssistantTileViewTabs
              viewMode={viewMode}
              artifactCount={artifacts.length}
              onChange={setViewMode}
            />
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
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
