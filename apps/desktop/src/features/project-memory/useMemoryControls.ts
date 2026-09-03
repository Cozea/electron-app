import { useEffect, useMemo, useState } from "react"

import { getDevAppForAssistantProvider } from "@/features/devapps/registry"
import {
  DEFAULT_MEMORY_LEGEND_POSITION,
  DEFAULT_MEMORY_SKILL_LABEL,
  useMemorySettingsStore,
  type MemoryLegendPosition,
} from "@/features/project-memory/memorySettingsStore"
import {
  filterMemorySkills,
  orderMemorySkills,
} from "@/features/project-memory/memorySkillRelevance"
import {
  buildMemoryBuildPrompt,
  buildMemoryUpdatePrompt,
  dispatchMemoryUpdateRequest,
  subscribeMemoryUpdateOutcomes,
} from "@/features/project-memory/memoryUpdateBus"
import {
  DEFAULT_PROJECT_MEMORY_RUN,
  buildProjectMemoryKey,
  failProjectMemoryUpdate,
  getProjectMemoryRun,
  startProjectMemoryUpdate,
  useProjectMemoryStore,
} from "@/features/project-memory/projectMemoryStore"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/features/workbench/model/workbenchStore"

/**
 * State shared by the Memory tile body and its header controls.
 *
 * The controls live in the tile chrome, beside the window buttons, while the
 * Build action lives in the body's empty state — two components, one source of
 * truth. Everything here is store-backed, so both can call this independently.
 */

export interface MemoryAgentOption {
  tileId: string
  name: string
  agentKey: string
}

/**
 * Only open assistant tiles can be targeted: the request is delivered to a
 * mounted controller, so an agent that is not on screen has nothing to receive
 * it. Labels come from the provider, never from the conversation title.
 */
function useOpenAgentTiles(projectId: string, laneId: string | null, workspaceId: string | null) {
  // Select only the stored tiles reference. Deriving the agent list inside the
  // selector would allocate a new array on every store read, and zustand
  // compares snapshots by identity — that is an infinite render loop, not a
  // performance detail.
  const tiles = useProjectWorkbenchStore(
    (state) =>
      selectProjectWorkbench(projectId, laneId ?? "collab", workspaceId)(state)?.tiles ?? null,
  )

  return useMemo(() => {
    if (!tiles) return EMPTY_AGENTS
    const agents = Object.values(tiles)
      .filter((tile) => tile.type === "assistantChat")
      .map((tile) => {
        const provider = tile.type === "assistantChat" ? (tile.provider ?? null) : null
        // Never fall back to tile.title: for an assistant tile that is the
        // conversation's name ("why is this unavailable?"), not the agent's.
        const name =
          (tile.type === "assistantChat" ? tile.agentLabel : null) ??
          getDevAppForAssistantProvider(provider)?.name ??
          provider ??
          "Agent"
        return {
          tileId: tile.id,
          name,
          // Durable across restarts, unlike the tile id.
          agentKey: provider ?? name,
        }
      })
    return agents.length > 0 ? agents : EMPTY_AGENTS
  }, [tiles])
}

const EMPTY_AGENTS: Array<{ tileId: string; name: string; agentKey: string }> = []

/**
 * The skill that powers memory is the user's choice. graphify is the default
 * because it is what produces the graph this tile reads, but any skill in their
 * Cozea library can be selected — including one they wrote.
 */
function useMemorySettings(workspaceId: string | null) {
  const [skills, setSkills] = useState<
    Array<{ id: string; name: string; isCozeaDefault: boolean }>
  >([])
  const selectedId = useMemorySettingsStore((state) =>
    workspaceId ? (state.byWorkspace[workspaceId] ?? null) : null,
  )
  const defaultAgentKey = useMemorySettingsStore((state) =>
    workspaceId ? (state.agentByWorkspace[workspaceId] ?? null) : null,
  )
  const setForWorkspace = useMemorySettingsStore((state) => state.setForWorkspace)
  const setDefaultAgent = useMemorySettingsStore((state) => state.setDefaultAgent)
  const legendPosition: MemoryLegendPosition = useMemorySettingsStore((state) =>
    workspaceId
      ? (state.legendByWorkspace[workspaceId] ?? DEFAULT_MEMORY_LEGEND_POSITION)
      : DEFAULT_MEMORY_LEGEND_POSITION,
  )
  const setLegendPosition = useMemorySettingsStore((state) => state.setLegendPosition)

  useEffect(() => {
    let cancelled = false
    const api = typeof window !== "undefined" ? window.electronAPI?.agentSkills : undefined
    if (!api) return
    void api
      .list()
      .then((snapshot) => {
        if (cancelled) return
        // Only skills that could plausibly drive the map; the library holds
        // plenty that could not.
        setSkills(
          orderMemorySkills(
            filterMemorySkills(
              snapshot.skills.map((skill) => ({
                id: skill.id,
                name: skill.name,
                description: skill.description,
              })),
            ),
          ).map((entry) => ({
            id: entry.skill.id,
            name: entry.skill.name,
            isCozeaDefault: entry.isCozeaDefault,
          })),
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const resolvedSkillId =
    selectedId ?? skills.find((skill) => skill.isCozeaDefault)?.id ?? null

  const label =
    skills.find((skill) => skill.id === resolvedSkillId)?.name ?? DEFAULT_MEMORY_SKILL_LABEL

  return {
    skills,
    resolvedSkillId,
    label,
    setForWorkspace,
    defaultAgentKey,
    setDefaultAgent,
    legendPosition,
    setLegendPosition,
  }
}

export interface UseMemoryControlsInput {
  projectId: string
  workspaceId: string | null
  laneId: string | null
}

export function useMemoryControls({ projectId, workspaceId, laneId }: UseMemoryControlsInput) {
  const key = workspaceId ? buildProjectMemoryKey(workspaceId, laneId) : null
  const run =
    useProjectMemoryStore((state) => (key ? state.byKey[key] : undefined)) ??
    DEFAULT_PROJECT_MEMORY_RUN
  const agents = useOpenAgentTiles(projectId, laneId, workspaceId)
  const settings = useMemorySettings(workspaceId)
  const [dispatchError, setDispatchError] = useState<string | null>(null)

  /*
   * The refresh button needs no picker: it targets the pinned agent when that
   * one is still open, and otherwise the first agent that is. Any open agent
   * tile is a signed-in, usable one — an agent that cannot run is not mounted.
   */
  const defaultAgent = useMemo(
    () => agents.find((agent) => agent.agentKey === settings.defaultAgentKey) ?? agents[0] ?? null,
    [agents, settings.defaultAgentKey],
  )

  const requestUpdate = (agent: MemoryAgentOption, mode: "build" | "update" = "update") => {
    if (!key || !workspaceId) return
    // Delivered to the mounted controller for that tile, which owns the
    // composer and sends it as an ordinary user turn.
    const delivered = dispatchMemoryUpdateRequest({
      targetTileId: agent.tileId,
      prompt:
        mode === "build"
          ? buildMemoryBuildPrompt(settings.label)
          : buildMemoryUpdatePrompt(settings.label),
    })
    if (!delivered) {
      setDispatchError("unreachable")
      window.setTimeout(() => setDispatchError(null), 5000)
      return
    }
    setDispatchError(null)
    startProjectMemoryUpdate(key, workspaceId, laneId, agent.name, agent.tileId)
  }

  // Stop waiting the moment the agent says it could not do it.
  useEffect(
    () =>
      subscribeMemoryUpdateOutcomes((outcome) => {
        if (!key) return
        const updating = getProjectMemoryRun(key).updating
        if (!updating || updating.targetTileId !== outcome.targetTileId) return
        failProjectMemoryUpdate(key, outcome.message)
      }),
    [key],
  )

  return { key, run, agents, defaultAgent, settings, requestUpdate, dispatchError }
}
