import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DockviewApi, DockviewPanelApi } from "dockview-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CozeaChatSurface } from "@/features/assistant/chat/CozeaChatSurface";
import { ThreadArtifactsView } from "@/features/assistant/artifacts/ThreadArtifactsView";
import { WorkbenchAssistantDiffDialog } from "@/features/workbench/assistant/WorkbenchAssistantDiffDialog";
import { useWorkbenchAssistantTileController } from "@/features/workbench/assistant/useWorkbenchAssistantTileController";
import { WorkbenchTileChrome } from "@/features/workbench/WorkbenchTileChrome";
import { useWorkbenchDockRuntime } from "@/features/workbench/WorkbenchDockRuntimeContext";
import { registerPreviewAnnotationComposerTarget } from "@/features/browser/previewAnnotationComposerRegistry";
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/lib/workbenchStore";
import {
  flushWorkbenchStorage,
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore";
import { cn } from "@/lib/utils";
import { AssistantHistoryButton } from "./assistant/AssistantHistoryButton";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  BubbleChatIcon as __ChatHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  Image01Icon as __ImageHugeIcon,
} from "@hugeicons/core-free-icons";

interface WorkbenchAssistantChatTileProps {
  projectId: string;
  laneId: string;
  workspaceId: string | null;
  projectRootPath: string | null;
  tile: WorkbenchAssistantChatTileRecord;
  panelApi: DockviewPanelApi;
  containerApi: DockviewApi;
  onDuplicate: (tileId: string) => void;
}

export function WorkbenchAssistantChatTile(props: WorkbenchAssistantChatTileProps) {
  // A deliberate history switch resets controller-local UI, never a text wrap.
  // draftId stays stable when the first send binds a runtime thread.
  return <WorkbenchAssistantChatTileContent key={props.tile.draftId ?? props.tile.id} {...props} />;
}

function WorkbenchAssistantChatTileContent(props: WorkbenchAssistantChatTileProps) {
  const runtime = useWorkbenchDockRuntime();
  const {
    chatTitle,
    diffDialog,
    closeDiffDialog,
    handleDeleteThread,
    surfaceProps,
    artifacts,
    artifactMedia,
    attachPreviewAnnotation,
    historyBusy,
    flushDraft,
    onHistoryError,
    stopAgentSession,
  } = useWorkbenchAssistantTileController({
    projectId: props.projectId,
    laneId: props.laneId,
    workspaceId: props.workspaceId,
    projectRootPath: props.projectRootPath,
    tile: props.tile,
  });
  const activeRef = useRef(props.panelApi.isActive && props.panelApi.isVisible);
  const artifactsButtonRef = useRef<HTMLButtonElement>(null);
  const deleteThreadButtonRef = useRef<HTMLButtonElement>(null);
  const deleteThreadWasFocusedRef = useRef(false);
  const [panelVisible, setPanelVisible] = useState(props.panelApi.isVisible);
  useEffect(() => {
    const update = () => {
      activeRef.current = props.panelApi.isActive && props.panelApi.isVisible;
      setPanelVisible(props.panelApi.isVisible);
    };
    const activeSubscription = props.panelApi.onDidActiveChange(update);
    const visibilitySubscription = props.panelApi.onDidVisibilityChange(update);
    update();
    return () => {
      activeSubscription.dispose();
      visibilitySubscription.dispose();
    };
  }, [props.panelApi]);
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
  );
  useLayoutEffect(() => {
    if (props.tile.threadId || !deleteThreadWasFocusedRef.current) return;
    deleteThreadWasFocusedRef.current = false;
    artifactsButtonRef.current?.focus({ preventScroll: true });
  }, [props.tile.threadId]);
  const updateAssistantTile = useProjectWorkbenchStore(
    (state) => state.actions.updateAssistantTile,
  );
  const currentTile = useProjectWorkbenchStore((state) => {
    const wb = selectProjectWorkbench(props.projectId, props.laneId, props.workspaceId)(state);
    return wb?.tiles[props.tile.id] as WorkbenchAssistantChatTileRecord | undefined;
  });
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [localViewMode, setLocalViewMode] = useState<"chat" | "artifacts" | null>(null);
  const viewMode = localViewMode ?? currentTile?.viewMode ?? props.tile.viewMode ?? "chat";

  const setViewMode = useCallback(
    (nextMode: "chat" | "artifacts") => {
      setLocalViewMode(nextMode);
      updateAssistantTile(
        props.projectId,
        props.laneId,
        props.tile.id,
        { viewMode: nextMode },
        props.workspaceId,
      );
      void flushWorkbenchStorage();
    },
    [props.laneId, props.projectId, props.tile.id, props.workspaceId, updateAssistantTile],
  );

  const openArtifact = (artifactId: string) => {
    setSelectedArtifactId(artifactId);
    setViewMode("artifacts");
  };

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
            <AssistantHistoryButton
              context={{
                projectId: props.projectId,
                workspaceId: props.workspaceId ?? "",
                laneId: props.laneId,
                rootPath: props.projectRootPath ?? "",
                branch: surfaceProps.thread?.branch ?? null,
              }}
              threadId={props.tile.threadId ?? null}
              draftId={props.tile.draftId ?? props.tile.id}
              assistantProjectId={props.tile.assistantProjectId ?? null}
              modelSelection={surfaceProps.selectedModelSelection}
              runtimeMode={surfaceProps.selectedRuntimeMode}
              interactionMode={surfaceProps.selectedInteractionMode}
              busy={historyBusy}
              flushDraft={flushDraft}
              onError={onHistoryError}
              onOpen={(entry, busy) =>
                runtime.onOpenAssistantConversation(props.tile.id, entry, busy)
              }
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  ref={artifactsButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "relative h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent",
                    viewMode === "artifacts" && "bg-accent text-foreground",
                  )}
                  aria-label={viewMode === "chat" ? "View artifacts" : "Back to chat"}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setViewMode(viewMode === "chat" ? "artifacts" : "chat");
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

            <div
              aria-hidden={!props.tile.threadId}
              className={cn(
                "shrink-0 overflow-hidden transition-[width,opacity] duration-150 ease-out motion-reduce:transition-none",
                props.tile.threadId ? "w-7 opacity-100" : "pointer-events-none w-0 opacity-0",
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    ref={deleteThreadButtonRef}
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent"
                    aria-label="Delete thread"
                    disabled={!props.tile.threadId}
                    tabIndex={props.tile.threadId ? 0 : -1}
                    onFocus={() => {
                      deleteThreadWasFocusedRef.current = true;
                    }}
                    onBlur={(event) => {
                      if (event.relatedTarget !== null) {
                        deleteThreadWasFocusedRef.current = false;
                      }
                    }}
                    onClick={() => {
                      if (!props.tile.threadId) return;
                      void handleDeleteThread().then((deleted) => {
                        if (deleted) {
                          // Close the tile without freezing navigation — panel close is local.
                          props.panelApi.close();
                        }
                      });
                    }}
                  >
                    <HugeiconsIcon icon={__DeleteHugeIcon} className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete thread</TooltipContent>
              </Tooltip>
            </div>
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
              onRestartAgent={stopAgentSession}
              isChatVisible={panelVisible && viewMode === "chat"}
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
            closeDiffDialog();
          }
        }}
      />
    </>
  );
}
