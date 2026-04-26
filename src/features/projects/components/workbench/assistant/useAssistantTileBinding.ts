import { useEffect, useRef, useState } from "react"
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
  projectPath: string | null
  tile: WorkbenchAssistantChatTileRecord
  config: ServerConfig | null
  isRuntimeReady: boolean
  hasBoundThread: boolean
  updateAssistantTile: (
    projectId: string,
    laneId: string,
    tileId: string,
    patch: Partial<WorkbenchAssistantChatTileRecord>,
    projectPath?: string | null,
  ) => void
}

export function useAssistantTileBinding({
  projectId,
  laneId,
  projectPath,
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
    if (!isRuntimeReady || !projectPath) {
      return
    }
    const workspaceRoot = projectPath
    if (bindingInFlightRef.current) {
      return
    }
    if (hasBoundThread) {
      setBindingError(null)
      setIsBinding(false)
      return
    }

    let cancelled = false
    bindingInFlightRef.current = true
    setIsBinding(true)

    const ensureBinding = async () => {
      try {
        await withWorkspaceBindingLock(workspaceRoot, async () => {
          const api = ensureNativeApi()
          const liveTile = () =>
            getLiveAssistantTile(projectId, laneId, tile.id, projectPath) ?? tile
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

          if (!nextProject) {
            const assistantProjectId = newProjectId()
            const defaultModelSelection = resolvePreferredModelSelection({
              config: liveConfig,
              tile: currentTile,
              projectModelSelection: null,
            })
            await api.orchestration.dispatchCommand({
              type: "project.create",
              commandId: newCommandId(),
              projectId: assistantProjectId,
              title: basenameFromPath(workspaceRoot),
              workspaceRoot,
              defaultModelSelection,
              createdAt: new Date().toISOString(),
            })
            await refreshAssistantRuntimeSnapshot()
            const nextAssistantState = useStore.getState()
            nextProject =
              selectAssistantProjectById(nextAssistantState, assistantProjectId) ??
              selectAssistantProjectByCwd(nextAssistantState, workspaceRoot) ??
              null
          }

          if (!nextProject) {
            throw new Error("Unable to create an assistant project for this workspace.")
          }

          const resolvedTile = liveTile()
          let nextThread =
            (resolvedTile.threadId
              ? selectAssistantThreadById(useStore.getState(), resolvedTile.threadId)
              : null) ?? null

          if (!nextThread || nextThread.projectId !== nextProject.id) {
            const threadId = newThreadId()
            const modelSelection = resolvePreferredModelSelection({
              config: liveConfig,
              tile: resolvedTile,
              projectModelSelection: nextProject.defaultModelSelection,
            })
            await api.orchestration.dispatchCommand({
              type: "thread.create",
              commandId: newCommandId(),
              threadId,
              projectId: nextProject.id,
              title: resolvedTile.agentLabel?.trim() || resolvedTile.title.trim() || "AI Agent",
              modelSelection,
              runtimeMode: resolveRuntimeMode(resolvedTile),
              interactionMode: resolveInteractionMode(resolvedTile),
              branch: null,
              worktreePath: null,
              createdAt: new Date().toISOString(),
            })
            await refreshAssistantRuntimeSnapshot()
            nextThread =
              selectAssistantThreadById(useStore.getState(), threadId) ?? null
          }

          const latestTile = liveTile()
          const patch: Partial<WorkbenchAssistantChatTileRecord> = {}

          if (latestTile.assistantProjectId !== nextProject.id) {
            patch.assistantProjectId = nextProject.id
          }
          if (nextThread && latestTile.threadId !== nextThread.id) {
            patch.threadId = nextThread.id
          }
          if (nextThread && latestTile.provider !== nextThread.modelSelection.provider) {
            patch.provider = nextThread.modelSelection.provider
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
            updateAssistantTile(projectId, laneId, tile.id, patch, projectPath)
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
    projectPath,
    tile,
    updateAssistantTile,
  ])

  return {
    bindingError,
    isBinding,
    setBindingRevision,
  }
}
