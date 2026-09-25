import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DockviewApi, DockviewPanelApi } from "dockview-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { appToast } from "@/lib/appToast";
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
    applyThreadWorktree,
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
  const [isApplying, setIsApplying] = useState(false);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      const res = await applyThreadWorktree();
      if (res.success) {
        appToast.success({
          title: "Applied to Session",
          description: `${res.appliedFiles.length} file(s) imported into the Session Workspace.`,
        });
      } else {
        appToast.error({
          title: "Could not apply to Session",
          description: res.error ?? "Failed to apply worktree changes",
        });
      }
    } catch (err) {
      appToast.error({
        title: "Could not apply to Session",
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsApplying(false);
    }
  };
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
            {props.tile.laneBinding === "threadWorktree" && surfaceProps.thread?.worktreePath ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs font-medium text-warning border-warning/40 hover:bg-warning/10"
                disabled={isApplying}
                onClick={handleApply}
                title="Apply private thread worktree changes into the collaborative Session Workspace"
              >
                {isApplying ? <Spinner size="xs" className="mr-1" /> : null}
                Apply to Session
              </Button>
            ) : null}
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
                    "relative h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent transition-[background-color,color,transform] duration-150 active:scale-[0.92]",
                    viewMode === "artifacts" && "bg-accent text-foreground",
                  )}
                  aria-label={viewMode === "chat" ? "View artifacts" : "Back to chat"}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setViewMode(viewMode === "chat" ? "artifacts" : "chat");
                  }}
                >
                  <span className="t-icon-swap size-3.5 shrink-0" data-state={viewMode}>
                    <span className="t-icon flex items-center justify-center" data-icon="chat">
                      <HugeiconsIcon icon={__ImageHugeIcon} className="size-3.5" />
                    </span>
                    <span className="t-icon flex items-center justify-center" data-icon="artifacts">
                      <HugeiconsIcon icon={__ChatHugeIcon} className="size-3.5" />
                    </span>
                  </span>
                  {viewMode === "chat" && artifacts.length > 0 ? (
                    <span className="absolute right-1 top-1 flex size-1.5 rounded-full bg-primary pointer-events-none" />
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
        <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {props.tile.laneBinding === "threadWorktree" && surfaceProps.thread?.worktreePath && viewMode === "chat" ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-warning/10 px-3 py-1.5 text-xs text-warning">
              <span className="truncate font-medium">
                Private thread worktree active. Changes remain isolated until applied.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 shrink-0 px-2 text-caption font-medium border-warning/40 text-warning hover:bg-warning/20"
                disabled={isApplying}
                onClick={handleApply}
              >
                {isApplying ? <Spinner size="xs" className="mr-1" /> : null}
                Apply to Session
              </Button>
            </div>
          ) : null}
          <div className="relative flex-1 overflow-hidden">
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
