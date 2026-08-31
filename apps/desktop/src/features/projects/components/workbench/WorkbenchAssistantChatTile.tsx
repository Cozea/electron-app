import { useCallback, useEffect, useRef, useState } from "react"
import type { DockviewApi, DockviewPanelApi } from "dockview-react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { CozeaChatSurface } from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { ThreadArtifactsView } from "@/features/projects/components/assistant/artifacts/ThreadArtifactsView"
import { WorkbenchAssistantDiffDialog } from "@/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog"
import { useWorkbenchAssistantTileController } from "@/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import { useWorkbenchDockRuntime } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import { registerPreviewAnnotationComposerTarget } from "@/features/projects/browser/previewAnnotationComposerRegistry"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"
import {
  flushWorkbenchStorage,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { cn } from "@/lib/utils"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  BubbleChatIcon as __ChatHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  Image01Icon as __ImageHugeIcon,
} from "@hugeicons/core-free-icons"

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
  const runtime = useWorkbenchDockRuntime()
  const {
    chatTitle,
    diffDialog,
    closeDiffDialog,
    handleDeleteThread,
    surfaceProps,
    artifacts,
    artifactMedia,
    attachPreviewAnnotation,
  } = useWorkbenchAssistantTileController({
    projectId: props.projectId,
    laneId: props.laneId,
    workspaceId: props.workspaceId,
    projectRootPath: props.projectRootPath,
    tile: props.tile,
  })
  const activeRef = useRef(props.panelApi.isActive && props.panelApi.isVisible)
  useEffect(() => {
    const update = () => {
      activeRef.current = props.panelApi.isActive && props.panelApi.isVisible
    }
    const activeSubscription = props.panelApi.onDidActiveChange(update)
    const visibilitySubscription = props.panelApi.onDidVisibilityChange(update)
    update()
    return () => {
      activeSubscription.dispose()
      visibilitySubscription.dispose()
    }
  }, [props.panelApi])
  useEffect(
    () =>
      registerPreviewAnnotationComposerTarget({
        id: props.tile.id,
        workbenchSessionKey: runtime.workbenchSessionKey ?? `${props.projectId}:${props.laneId}`,
        active: () => activeRef.current,
        attach: attachPreviewAnnotation,
      }),
    [
      attachPreviewAnnotation,
      props.laneId,
      props.projectId,
      props.tile.id,
      runtime.workbenchSessionKey,
    ],
  )
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const currentTile = useProjectWorkbenchStore((state) => {
    const wb = selectProjectWorkbench(props.projectId, props.laneId, props.workspaceId)(state)
    return wb?.tiles[props.tile.id] as WorkbenchAssistantChatTileRecord | undefined
  })
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [localViewMode, setLocalViewMode] = useState<"chat" | "artifacts" | null>(null)
  const viewMode = localViewMode ?? currentTile?.viewMode ?? props.tile.viewMode ?? "chat"

  const setViewMode = useCallback(
    (nextMode: "chat" | "artifacts") => {
      setLocalViewMode(nextMode)
      updateAssistantTile(
        props.projectId,
        props.laneId,
        props.tile.id,
        { viewMode: nextMode },
        props.workspaceId,
      )
      void flushWorkbenchStorage()
    },
    [props.laneId, props.projectId, props.tile.id, props.workspaceId, updateAssistantTile],
  )

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
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent",
                    viewMode === "artifacts" && "bg-accent text-foreground",
                  )}
                  aria-label={viewMode === "chat" ? "View artifacts" : "Back to chat"}
                  onClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setViewMode(viewMode === "chat" ? "artifacts" : "chat")
                  }}
                >
                  <HugeiconsIcon
                    icon={viewMode === "chat" ? __ImageHugeIcon : __ChatHugeIcon}
                    className="size-3.5"
                  />
                  {viewMode === "chat" && artifacts.length > 0 ? (
                    <span className="absolute right-1 top-1 flex size-1.5 rounded-full bg-primary" />
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {viewMode === "chat"
                  ? `Artifacts${artifacts.length > 0 ? ` (${artifacts.length})` : ""}`
                  : "Back to chat"}
              </TooltipContent>
            </Tooltip>

            {props.tile.threadId ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent"
                    aria-label="Delete thread"
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
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete thread</TooltipContent>
              </Tooltip>
            ) : null}
          </>
        }
      >
        <div className="relative h-full min-h-0 flex-1 overflow-hidden">
          <div
            className={cn("absolute inset-0", viewMode !== "chat" && "hidden")}
            aria-hidden={viewMode !== "chat"}
          >
            <CozeaChatSurface
              {...surfaceProps}
              artifactUrlsById={artifactMedia.urlsById}
              onOpenArtifact={openArtifact}
            />
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
              onBackToChat={() => setViewMode("chat")}
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
