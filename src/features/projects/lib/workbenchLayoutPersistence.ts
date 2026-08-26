import type { SerializedDockview } from "dockview-react"
import { buildWorkbenchScopeKey } from "@/stores/useProjectWorkbenchStore"

const WORKBENCH_LAYOUTS_STORAGE_KEY = "cozea:project-workbench-layouts"
const LEGACY_WORKBENCH_STORAGE_KEY = "cozea:project-workbench"

interface PersistedWorkbenchLayoutEntry {
  layout: SerializedDockview
  layoutResetKey: number
}

interface PersistedWorkbenchLayoutsState {
  version: 1
  migratedFromLegacy: boolean
  layouts: Record<string, PersistedWorkbenchLayoutEntry>
}

interface LegacyPersistedWorkbenchState {
  state?: {
    workbenches?: Record<string, LegacyPersistedWorkbenchRecord>
    projects?: Record<string, LegacyPersistedWorkbenchRecord>
  }
  workbenches?: Record<string, LegacyPersistedWorkbenchRecord>
  projects?: Record<string, LegacyPersistedWorkbenchRecord>
}

interface LegacyPersistedWorkbenchRecord {
  layout?: SerializedDockview | null
  layoutResetKey?: number
}

let didAttemptLegacyMigration = false

function isSerializedDockview(value: unknown): value is SerializedDockview {
  if (!value || typeof value !== "object") return false
  return "grid" in value && "panels" in value
}

function isPersistedWorkbenchLayoutEntry(value: unknown): value is PersistedWorkbenchLayoutEntry {
  if (!value || typeof value !== "object") return false

  const typedValue = value as Partial<PersistedWorkbenchLayoutEntry>
  return (
    typeof typedValue.layoutResetKey === "number" &&
    isSerializedDockview(typedValue.layout)
  )
}

function getEmptyPersistedWorkbenchLayoutsState(): PersistedWorkbenchLayoutsState {
  return {
    version: 1,
    migratedFromLegacy: false,
    layouts: {},
  }
}

function readPersistedWorkbenchLayoutsStateUnsafe(): PersistedWorkbenchLayoutsState {
  if (typeof window === "undefined") {
    return getEmptyPersistedWorkbenchLayoutsState()
  }

  try {
    const rawValue = window.localStorage.getItem(WORKBENCH_LAYOUTS_STORAGE_KEY)
    if (!rawValue) {
      return getEmptyPersistedWorkbenchLayoutsState()
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedWorkbenchLayoutsState>
    const nextLayouts = Object.fromEntries(
      Object.entries(parsedValue.layouts ?? {}).filter(([, entry]) =>
        isPersistedWorkbenchLayoutEntry(entry),
      ),
    )

    return {
      version: 1,
      migratedFromLegacy: parsedValue.migratedFromLegacy === true,
      layouts: nextLayouts,
    }
  } catch {
    return getEmptyPersistedWorkbenchLayoutsState()
  }
}

function writePersistedWorkbenchLayoutsState(
  state: PersistedWorkbenchLayoutsState,
): void {
  if (typeof window === "undefined") return

  window.localStorage.setItem(
    WORKBENCH_LAYOUTS_STORAGE_KEY,
    JSON.stringify(state),
  )
}

function resolveLegacyPersistedWorkbenches(
  state: LegacyPersistedWorkbenchState,
): Record<string, LegacyPersistedWorkbenchRecord> {
  if (state.state?.workbenches && typeof state.state.workbenches === "object") {
    return state.state.workbenches
  }

  if (state.workbenches && typeof state.workbenches === "object") {
    return state.workbenches
  }

  if (state.state?.projects && typeof state.state.projects === "object") {
    return state.state.projects
  }

  if (state.projects && typeof state.projects === "object") {
    return state.projects
  }

  return {}
}

function ensureLegacyLayoutsMigrated(): void {
  if (didAttemptLegacyMigration || typeof window === "undefined") return

  didAttemptLegacyMigration = true

  const currentState = readPersistedWorkbenchLayoutsStateUnsafe()
  if (currentState.migratedFromLegacy) {
    return
  }

  const nextLayouts = { ...currentState.layouts }

  try {
    const rawLegacyState = window.localStorage.getItem(LEGACY_WORKBENCH_STORAGE_KEY)
    if (rawLegacyState) {
      const parsedLegacyState = JSON.parse(rawLegacyState) as LegacyPersistedWorkbenchState
      const legacyWorkbenches = resolveLegacyPersistedWorkbenches(parsedLegacyState)

      for (const [scopeKey, legacyWorkbench] of Object.entries(legacyWorkbenches)) {
        if (!isSerializedDockview(legacyWorkbench.layout) || nextLayouts[scopeKey]) {
          continue
        }

        nextLayouts[scopeKey] = {
          layout: legacyWorkbench.layout,
          layoutResetKey:
            typeof legacyWorkbench.layoutResetKey === "number"
              ? legacyWorkbench.layoutResetKey
              : 0,
        }
      }
    }
  } catch {
    // Ignore malformed legacy persisted state and continue with a clean layout store.
  }

  writePersistedWorkbenchLayoutsState({
    version: 1,
    migratedFromLegacy: true,
    layouts: nextLayouts,
  })
}

export function ensureWorkbenchLayoutPersistenceReady(): void {
  ensureLegacyLayoutsMigrated()
}

export function peekPersistedWorkbenchLayout(
  scopeKey: string,
  layoutResetKey: number,
): SerializedDockview | null {
  const state = readPersistedWorkbenchLayoutsStateUnsafe()
  const entry = state.layouts[scopeKey]
  if (!entry || entry.layoutResetKey !== layoutResetKey) {
    return null
  }

  return entry.layout
}

export function writePersistedWorkbenchLayout(
  scopeKey: string,
  layoutResetKey: number,
  layout: SerializedDockview,
): void {
  ensureLegacyLayoutsMigrated()

  const state = readPersistedWorkbenchLayoutsStateUnsafe()
  writePersistedWorkbenchLayoutsState({
    ...state,
    migratedFromLegacy: true,
    layouts: {
      ...state.layouts,
      [scopeKey]: {
        layout,
        layoutResetKey,
      },
    },
  })
}

export function clearPersistedWorkbenchLayout(scopeKey: string): void {
  ensureLegacyLayoutsMigrated()

  const state = readPersistedWorkbenchLayoutsStateUnsafe()
  if (!(scopeKey in state.layouts)) {
    return
  }

  const nextLayouts = { ...state.layouts }
  delete nextLayouts[scopeKey]

  writePersistedWorkbenchLayoutsState({
    ...state,
    migratedFromLegacy: true,
    layouts: nextLayouts,
  })
}

export function clonePersistedWorkbenchLayoutsForWorkspace(args: {
  projectId: string
  fromWorkspace?: string | null
  toWorkspace?: string | null
}): void {
  const normalizedTargetScopeWorkspace = args.toWorkspace?.trim()
  if (!args.projectId || !normalizedTargetScopeWorkspace) {
    return
  }

  ensureLegacyLayoutsMigrated()

  const state = readPersistedWorkbenchLayoutsStateUnsafe()
  const nextLayouts = { ...state.layouts }
  let mutated = false

  for (const [scopeKey, entry] of Object.entries(state.layouts)) {
    const scopeKeyParts = scopeKey.split("::")
    const [scopeProjectId, scopeLaneId] = scopeKeyParts
    const revisionPart = scopeKeyParts[scopeKeyParts.length - 1]
    if (
      scopeProjectId !== args.projectId ||
      !scopeLaneId ||
      scopeKeyParts.length < 4 ||
      !revisionPart?.startsWith("v")
    ) {
      continue
    }

    const scopeWorkspace = scopeKeyParts.slice(2, -1).join("::")
    if (!scopeWorkspace) {
      continue
    }

    const isSourceMatch = args.fromWorkspace?.trim()
      ? scopeWorkspace === args.fromWorkspace.trim()
      : true

    if (!isSourceMatch) {
      continue
    }

    const targetScopeKey = buildWorkbenchScopeKey(
      args.projectId,
      scopeLaneId,
      normalizedTargetScopeWorkspace,
    )

    if (nextLayouts[targetScopeKey]) {
      continue
    }

    nextLayouts[targetScopeKey] = entry
    mutated = true
  }

  if (!mutated) {
    return
  }

  writePersistedWorkbenchLayoutsState({
    ...state,
    migratedFromLegacy: true,
    layouts: nextLayouts,
  })
}
