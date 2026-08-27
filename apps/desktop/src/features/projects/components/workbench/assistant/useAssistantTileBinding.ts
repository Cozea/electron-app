import { useCallback, useEffect, useRef, useState } from "react"
import type { ServerConfig } from "@cozea/assistant-contracts"

import {
  newCommandId,
  newProjectId,
  newThreadId,
} from "@/features/projects/components/assistant/lib/utils"
import { refreshAssistantRuntimeSnapshot } from "@/features/projects/components/workbench/useAssistantRuntimeSync"
import { ensureNativeApi } from "@/lib/nativeApi"
import {
  selectAssistantProjectByCwd,
  selectAssistantProjectById,
  selectAssistantThreadById,
  useStore,
} from "@/stores/assistant-store"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"

import {
  basenameFromPath,
  getLiveAssistantTile,
  resolveInteractionMode,
  resolvePreferredModelSelection,
  resolveRuntimeMode,
  toErrorMessage,
  withWorkspaceBindingLock,
} from "./workbenchAssistantShared"

interface UseAssistantTileBindingInput {
  projectId: string
  laneId: string
  workspaceId: string | null
  projectRootPath: string | null
  tile: WorkbenchAssistantChatTileRecord
  config: ServerConfig | null
  isRuntimeReady: boolean
  hasBoundThread: boolean
  updateAssistantTile: (
    projectId: string,
    laneId: string,
    tileId: string,
    patch: Partial<WorkbenchAssistantChatTileRecord>,
    workspaceId?: string | null,
  ) => void
}

export function useAssistantTileBinding({
  projectId,
  laneId,
  workspaceId,
  projectRootPath,
  tile,
  config,
  isRuntimeReady,
  hasBoundThread,
  updateAssistantTile,
}: UseAssistantTileBindingInput) {
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [isBinding, setIsBinding] = useState(false)
  const [bindingRevision, setBindingRevision] = useState(0)
  const bindingInFlightRef = useRef(false)

  useEffect(() => {
    if (isRuntimeReady) {
      return
    }

    bindingInFlightRef.current = false
    setIsBinding(false)
  }, [isRuntimeReady])

  useEffect(() => {
    if (!isRuntimeReady || !workspaceId || !projectRootPath) {
      return
    }
    if (bindingInFlightRef.current) {
      return
    }
    if (hasBoundThread) {
      setBindingError(null)
      setIsBinding(false)
      return
    }

    // --- Fix 6: Skip thread creation for fresh tiles (no threadId) ---
    // If the tile has no threadId, this is a fresh tile. We resolve/create the
    // project only and defer thread creation to the first send. This prevents
    // empty thread accumulation when users open tiles and close them without
    // typing.
    const isResumingExistingThread = Boolean(tile.threadId)

    let cancelled = false
    bindingInFlightRef.current = true
    setIsBinding(true)

    const ensureBinding = async () => {
      try {
        const workspaceRoot = projectRootPath
        if (cancelled) return

        await withWorkspaceBindingLock(workspaceRoot, async () => {
          const api = ensureNativeApi()
          const liveTile = () =>
            getLiveAssistantTile(projectId, laneId, tile.id, workspaceId) ?? tile
          const liveConfig = config ?? (await api.server.getConfig().catch(() => null))

          await refreshAssistantRuntimeSnapshot()

          const currentTile = liveTile()
          const currentAssistantState = useStore.getState()
          let nextProject =
            (currentTile.assistantProjectId
              ? selectAssistantProjectById(currentAssistantState, currentTile.assistantProjectId)
              : null) ??
            selectAssistantProjectByCwd(currentAssistantState, workspaceRoot) ??
            null

          let nextProjectId: string

          if (!nextProject) {
            const assistantProjectId = newProjectId()
            nextProjectId = assistantProjectId
            const defaultModelSelection = resolvePreferredModelSelection({
              config: liveConfig,
              tile: currentTile,
              projectModelSelection: null,
            })
            try {
              await api.orchestration.dispatchCommand({
                type: "project.create",
                commandId: newCommandId(),
                projectId: assistantProjectId,
                title: basenameFromPath(workspaceRoot),
                workspaceRoot,
                defaultModelSelection,
                createdAt: new Date().toISOString(),
              })
            } catch (createError: unknown) {
              const errMsg = createError instanceof Error ? `${createError.message} ${createError.stack ?? ""}` : JSON.stringify(createError);
              const match = errMsg.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/);
              if (match && match[1]) {
                const existingId = match[1];
                nextProjectId = existingId;
                const currentReadModel = useStore.getState().orchestrationReadModel;
                useStore.getState().syncServerReadModel({
                  snapshotSequence: currentReadModel?.snapshotSequence ?? 0,
                  projects: [
                    ...(currentReadModel?.projects ?? []).filter((p) => p.id !== existingId),
                    {
                      id: existingId as any,
                      title: basenameFromPath(workspaceRoot),
                      workspaceRoot,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    } as any,
                  ],
                  threads: currentReadModel?.threads ?? [],
                  updatedAt: new Date().toISOString(),
                });
                nextProject = useStore.getState().projectById[existingId as any] ?? null;
              } else {
                throw createError;
              }
            }
          } else {
            nextProjectId = nextProject.id
          }

          // Only create a thread if we're resuming an existing one that's not
          // yet in the store. For fresh tiles (no threadId), skip thread
          // creation — it will happen on first send.
          if (isResumingExistingThread) {
            const resolvedTile = liveTile()
            let nextThread =
              (resolvedTile.threadId
                ? selectAssistantThreadById(useStore.getState(), resolvedTile.threadId)
                : null) ?? null

            let nextThreadId: string | null = resolvedTile.threadId ?? null

            // If the tile has a threadId but the store doesn't have it yet, we assume the read model is lagging
            // behind the creation event. We only create a new thread if the tile explicitly has no threadId,
            // or if the existing thread belongs to a different project.
            let needsThreadCreation = !nextThreadId;
            
            if (nextThread && nextThread.projectId !== nextProjectId) {
              needsThreadCreation = true;
            }

            if (needsThreadCreation) {
              const threadId = newThreadId()
              nextThreadId = threadId
              const modelSelection = resolvePreferredModelSelection({
                config: liveConfig,
                tile: resolvedTile,
                projectModelSelection: nextProject?.defaultModelSelection ?? null,
              })
              await api.orchestration.dispatchCommand({
                type: "thread.create",
                commandId: newCommandId(),
                threadId,
                projectId: nextProjectId as any,
                title: resolvedTile.agentLabel?.trim() || resolvedTile.title.trim() || "AI Agent",
                modelSelection,
                runtimeMode: resolveRuntimeMode(resolvedTile),
                interactionMode: resolveInteractionMode(resolvedTile),
                branch: null,
                worktreePath: null,
                createdAt: new Date().toISOString(),
              })
              nextThread =
                selectAssistantThreadById(useStore.getState(), threadId) ?? null
            }

            const latestTile = liveTile()
            const patch: Partial<WorkbenchAssistantChatTileRecord> = {}

            if (latestTile.assistantProjectId !== nextProjectId) {
              patch.assistantProjectId = nextProjectId
            }
            if (nextThreadId && latestTile.threadId !== nextThreadId) {
              patch.threadId = nextThreadId
            }
            if (nextThread && latestTile.provider !== nextThread.modelSelection.provider) {
              patch.provider = nextThread.modelSelection.provider
            }
            if (nextThread && latestTile.providerInstanceId !== nextThread.modelSelection.instanceId) {
              patch.providerInstanceId = nextThread.modelSelection.instanceId
            }
            if (nextThread && latestTile.model !== nextThread.modelSelection.model) {
              patch.model = nextThread.modelSelection.model
            }
            if (latestTile.runtimeMode !== resolveRuntimeMode(latestTile)) {
              patch.runtimeMode = resolveRuntimeMode(latestTile)
            }
            if (latestTile.interactionMode !== resolveInteractionMode(latestTile)) {
              patch.interactionMode = resolveInteractionMode(latestTile)
            }

            if (!cancelled && Object.keys(patch).length > 0) {
              updateAssistantTile(projectId, laneId, tile.id, patch, workspaceId)
            }
          } else {
            // Fresh tile: just bind the project, no thread yet
            const latestTile = liveTile()
            if (!cancelled && latestTile.assistantProjectId !== nextProjectId) {
              updateAssistantTile(projectId, laneId, tile.id, {
                assistantProjectId: nextProjectId,
              }, workspaceId)
            }
          }

          if (!cancelled) {
            setBindingError(null)
          }
        })
      } catch (error) {
        if (!cancelled) {
          setBindingError(toErrorMessage(error))
        }
      } finally {
        bindingInFlightRef.current = false
        if (!cancelled) {
          setIsBinding(false)
        }
      }
    }

    void ensureBinding()

    return () => {
      cancelled = true
    }
  }, [
    bindingRevision,
    config,
    hasBoundThread,
    isRuntimeReady,
    laneId,
    projectId,
    projectRootPath,
    workspaceId,
    tile,
    updateAssistantTile,
  ])

  // --- Fix 6: On-demand thread creation for fresh tiles ---
  // Called from handleSend when a user sends their first message on a fresh tile.
  const createThreadOnDemand = useCallback(async (input: {
    workspaceRoot: string
    modelSelection: ReturnType<typeof resolvePreferredModelSelection>
    runtimeMode: ReturnType<typeof resolveRuntimeMode>
    interactionMode: ReturnType<typeof resolveInteractionMode>
    title: string
  }) => {
    const api = ensureNativeApi()
    const currentAssistantState = useStore.getState()
    const currentProject =
      (tile.assistantProjectId
        ? selectAssistantProjectById(currentAssistantState, tile.assistantProjectId)
        : null) ??
      selectAssistantProjectByCwd(currentAssistantState, input.workspaceRoot) ??
      null

    if (!currentProject) {
      throw new Error("No assistant project found for this workspace.")
    }

    const threadId = newThreadId()
    await api.orchestration.dispatchCommand({
      type: "thread.create",
      commandId: newCommandId(),
      threadId,
      projectId: currentProject.id as any,
      title: input.title,
      modelSelection: input.modelSelection,
      runtimeMode: input.runtimeMode,
      interactionMode: input.interactionMode,
      branch: null,
      worktreePath: null,
      createdAt: new Date().toISOString(),
    })

    updateAssistantTile(projectId, laneId, tile.id, {
      threadId,
      assistantProjectId: currentProject.id,
    }, workspaceId)

    return threadId
  }, [laneId, projectId, workspaceId, tile, updateAssistantTile])

  return {
    bindingError,
    isBinding,
    setBindingRevision,
    createThreadOnDemand,
  }
}
