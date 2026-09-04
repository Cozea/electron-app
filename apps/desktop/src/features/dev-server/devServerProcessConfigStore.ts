import { create } from "zustand"
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware"

import type { DevServerAuxiliaryProcessConfig } from "@shared/electronApiTypes"

export const MAX_DEV_SERVER_AUXILIARY_PROCESSES = 6
export const MAX_DEV_SERVER_PROCESS_NAME_LENGTH = 48
export const MAX_DEV_SERVER_PROCESS_COMMAND_LENGTH = 1_000
export const EMPTY_DEV_SERVER_AUXILIARY_PROCESSES: DevServerAuxiliaryProcessConfig[] = []

interface DevServerProcessConfigState {
  byWorkspace: Record<string, DevServerAuxiliaryProcessConfig[]>
  actions: {
    setForWorkspace: (
      workspaceId: string,
      processes: DevServerAuxiliaryProcessConfig[],
    ) => void
    clearWorkspace: (workspaceId: string) => void
  }
}

function createMemoryStorage(): StateStorage {
  const values = new Map<string, string>()
  return {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value)
    },
    removeItem: (name) => {
      values.delete(name)
    },
  }
}

const processConfigStorage =
  typeof window !== "undefined" &&
  typeof window.localStorage?.getItem === "function" &&
  typeof window.localStorage?.setItem === "function" &&
  typeof window.localStorage?.removeItem === "function"
    ? window.localStorage
    : createMemoryStorage()

function normalizeProcess(
  value: unknown,
): DevServerAuxiliaryProcessConfig | null {
  if (!value || typeof value !== "object") return null
  const process = value as Partial<DevServerAuxiliaryProcessConfig>
  if (
    typeof process.id !== "string" ||
    typeof process.name !== "string" ||
    typeof process.command !== "string"
  ) {
    return null
  }
  const id = process.id.trim().slice(0, 80)
  const name = process.name.trim().slice(0, MAX_DEV_SERVER_PROCESS_NAME_LENGTH)
  const command = process.command.trim().slice(0, MAX_DEV_SERVER_PROCESS_COMMAND_LENGTH)

  if (!id || !name || !command) return null
  return { id, name, command }
}

export function normalizeDevServerAuxiliaryProcesses(
  processes: readonly unknown[],
): DevServerAuxiliaryProcessConfig[] {
  const seenIds = new Set<string>()
  const normalized: DevServerAuxiliaryProcessConfig[] = []

  for (const process of processes.slice(0, MAX_DEV_SERVER_AUXILIARY_PROCESSES)) {
    const next = normalizeProcess(process)
    if (!next || seenIds.has(next.id)) continue
    seenIds.add(next.id)
    normalized.push(next)
  }

  return normalized
}

export const useDevServerProcessConfigStore = create<DevServerProcessConfigState>()(
  persist(
    (set) => ({
      byWorkspace: {},
      actions: {
        setForWorkspace: (workspaceId, processes) => {
          const normalizedWorkspaceId = workspaceId.trim()
          if (!normalizedWorkspaceId) return
          const normalized = normalizeDevServerAuxiliaryProcesses(processes)
          set((state) => ({
            byWorkspace: {
              ...state.byWorkspace,
              [normalizedWorkspaceId]: normalized,
            },
          }))
        },
        clearWorkspace: (workspaceId) => {
          const normalizedWorkspaceId = workspaceId.trim()
          if (!normalizedWorkspaceId) return
          set((state) => {
            if (!(normalizedWorkspaceId in state.byWorkspace)) return state
            const byWorkspace = { ...state.byWorkspace }
            delete byWorkspace[normalizedWorkspaceId]
            return { byWorkspace }
          })
        },
      },
    }),
    {
      name: "cozea:dev-server-process-configs",
      version: 1,
      storage: createJSONStorage(() => processConfigStorage),
      partialize: (state) => ({ byWorkspace: state.byWorkspace }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<DevServerProcessConfigState>
        const byWorkspace = Object.fromEntries(
          Object.entries(persisted.byWorkspace ?? {}).map(([workspaceId, processes]) => [
            workspaceId,
            normalizeDevServerAuxiliaryProcesses(Array.isArray(processes) ? processes : []),
          ]),
        )
        return { ...currentState, byWorkspace }
      },
    },
  ),
)

export function clearDevServerProcessConfigForWorkspace(workspaceId: string): void {
  useDevServerProcessConfigStore.getState().actions.clearWorkspace(workspaceId)
}
