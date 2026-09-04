import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon } from "@hugeicons/core-free-icons";
import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@cozea/assistant-contracts";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/features/assistant/model/assistantStore";
import {
  assistantDrafts,
  unboundDraftKey,
} from "@/features/assistant/history/assistantDraftRepository";
import {
  backfillAssistantHistory,
  useAssistantHistoryStore,
  type AssistantConversationContext,
} from "@/features/assistant/history/assistantHistoryStore";
import {
  buildAssistantHistoryMenu,
  selectAssistantHistory,
  type AssistantHistoryEntry,
} from "@/features/assistant/history/assistantHistory";
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient";
import { ensureNativeApi } from "@/lib/nativeApi";
import { useProjectWorkbenchStore } from "@/lib/workbenchStore";
import { useAssistantRuntimeMetadata } from "@/features/assistant/model/assistantRuntimeMetadataStore";

interface AssistantHistoryButtonProps {
  context: AssistantConversationContext;
  threadId: string | null;
  draftId: string;
  assistantProjectId: string | null;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  busy: boolean;
  flushDraft: () => Promise<void>;
  onOpen: (entry: AssistantHistoryEntry, busy: boolean) => void;
  onError: (message: string) => void;
}

export function AssistantHistoryButton(props: AssistantHistoryButtonProps) {
  const metadata = useAssistantRuntimeMetadata();
  const providers = useRef(metadata.config?.providers);
  providers.current = metadata.config?.providers;
  const latest = useRef(props);
  latest.current = props;
  const opening = useRef(false);
  const [loading, setLoading] = useState(false);
  const entries = () =>
    selectAssistantHistory({
      projectId: latest.current.context.projectId,
      provider: latest.current.modelSelection.provider,
      state: useStore.getState(),
      ...useAssistantHistoryStore.getState(),
      drafts: assistantDrafts.store.getState().drafts,
      providers: providers.current,
    });
  const refresh = async () => {
    const workspaceApi = window.electronAPI.workspace;
    if (!workspaceApi) throw new Error("Workspace catalog is unavailable.");
    const [snapshot, catalog, workspaces] = await Promise.all([
      ensureNativeApi().orchestration.getSnapshot(),
      workspaceApi.getCatalogSnapshot(),
      workspaceApi.listForProject(latest.current.context.projectId),
      assistantDrafts.load(),
    ]);
    useStore.getState().syncServerReadModel(snapshot);
    const contexts: AssistantConversationContext[] = Object.values(catalog.entries).map(
      (entry) => ({
        projectId: entry.projectId,
        workspaceId: entry.workspace.workspaceId,
        laneId: entry.lane?.laneId ?? "collab",
        rootPath: entry.workspace.projectRootPath,
        branch: entry.lane?.branch ?? null,
      }),
    );
    for (const workspace of workspaces)
      contexts.push({
        projectId: workspace.projectId,
        workspaceId: workspace.workspaceId,
        laneId:
          Object.values(useProjectWorkbenchStore.getState().workbenches).find(
            (bench) =>
              bench.projectId === workspace.projectId &&
              bench.workspaceId === workspace.workspaceId,
          )?.laneId ?? "",
        rootPath: workspace.projectRootPath,
        branch: null,
      });
    contexts.push(latest.current.context);
    backfillAssistantHistory(
      useStore.getState(),
      contexts,
      useProjectWorkbenchStore.getState().workbenches,
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-md border-0 shadow-none hover:bg-accent"
          aria-label="Chat history"
          aria-haspopup="menu"
          aria-busy={loading}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (opening.current) return;
            opening.current = true;
            const button = event.currentTarget;
            const rect = button.getBoundingClientRect();
            const anchor = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) };
            const source = latest.current;
            const isCurrent = () =>
              button.isConnected &&
              latest.current.context.projectId === source.context.projectId &&
              latest.current.threadId === source.threadId &&
              latest.current.draftId === source.draftId;
            let page = 0;
            let loadError = false;
            try {
              setLoading(true);
              try {
                await refresh();
              } catch {
                loadError = true;
              }
              setLoading(false);
              while (button.isConnected) {
                const current = latest.current;
                if (
                  current.context.projectId !== source.context.projectId ||
                  current.threadId !== source.threadId ||
                  current.draftId !== source.draftId
                )
                  return;
                const list = entries();
                const items = buildAssistantHistoryMenu(
                  list,
                  page,
                  current.threadId
                    ? `thread:${current.threadId}`
                    : unboundDraftKey(current.draftId),
                  current.context.rootPath,
                );
                if (loadError) {
                  const empty = items.findIndex((item) => item.id === "empty");
                  if (empty !== -1) items.splice(empty, 1);
                  items.push(
                    { id: "unavailable", label: "History could not be refreshed", enabled: false },
                    { id: "retry", label: "Retry" },
                  );
                }
                const action = await showDesktopContextMenu(items, anchor);
                if (!isCurrent()) return;
                if (!action) {
                  button.focus();
                  return;
                }
                if (action === "older") {
                  page++;
                  continue;
                }
                if (action === "newer") {
                  page = Math.max(0, page - 1);
                  continue;
                }
                if (action === "retry") {
                  try {
                    await refresh();
                    loadError = false;
                  } catch {
                    loadError = true;
                  }
                  continue;
                }
                await latest.current.flushDraft();
                if (!isCurrent()) return;
                if (action === "new") {
                  const draftId = crypto.randomUUID();
                  latest.current.onOpen(
                    {
                      id: unboundDraftKey(draftId),
                      draftId,
                      threadId: null,
                      assistantProjectId: current.assistantProjectId,
                      title: "AI Agent",
                      updatedAt: new Date().toISOString(),
                      status: "Draft",
                      context: current.context,
                      modelSelection: current.modelSelection,
                      runtimeMode: current.runtimeMode,
                      interactionMode: current.interactionMode,
                    },
                    latest.current.busy,
                  );
                  return;
                }
                // Refresh/re-resolve after selection: native menus are snapshots.
                if (action.startsWith("thread:")) await refresh();
                if (!isCurrent()) return;
                const target = entries().find((entry) => entry.id === action);
                if (!target)
                  throw new Error(
                    "This conversation is no longer available in this project's history.",
                  );
                latest.current.onOpen(target, latest.current.busy);
                return;
              }
            } catch (error) {
              latest.current.onError(
                error instanceof Error ? error.message : "Could not open chat history.",
              );
              if (button.isConnected) button.focus();
            } finally {
              opening.current = false;
              setLoading(false);
            }
          }}
        >
          <HugeiconsIcon icon={Clock01Icon} className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{loading ? "Loading chat history…" : "Chat history"}</TooltipContent>
    </Tooltip>
  );
}
