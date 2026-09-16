import { create } from "zustand"

import type {
  SecurityScanBackendOption,
  SecurityScanEnvironment,
  SecurityScanRun,
  SecurityScanTarget,
} from "@shared/securityScanTypes"

import { SAMPLE_BACKEND_OPTIONS, SAMPLE_SCAN_RUN } from "./sampleScan"

/**
 * Shared scan state for the Security Scan tile.
 *
 * The run controls (Run / Stop) and the setup toggle live in the tile-chrome header while
 * the dashboard lives in the tile body, so both must read one truth. A module-level store
 * gives them that; the tile is a singleton, so a single instance is correct.
 *
 * Slice 1 drives the UI from representative sample state. The live wiring replaces
 * `startScan`/`cancelScan`/`exportReport` with the main-process runner and the platform
 * bridge without changing this shape.
 */

// The target in slice 1 is the running dev server. Slice 2 sources this from the workspace.
const DEFAULT_TARGET: SecurityScanTarget = {
  kind: "devServer",
  value: "http://127.0.0.1:5173",
  label: "Dev server · :5173",
}

function firstEligibleBackendId(options: readonly SecurityScanBackendOption[]): string | null {
  return options.find((option) => option.eligible)?.id ?? null
}

export interface SecurityScanStore {
  environment: SecurityScanEnvironment
  backendOptions: readonly SecurityScanBackendOption[]
  run: SecurityScanRun | null
  setupOpen: boolean
  selectedBackendId: string | null
  acknowledged: boolean
  exporting: boolean

  setSetupOpen: (open: boolean) => void
  toggleSetup: () => void
  selectBackend: (id: string) => void
  setAcknowledged: (value: boolean) => void
  startScan: () => void
  cancelScan: () => void
  exportReport: () => Promise<void>
}

const environment: SecurityScanEnvironment = {
  dockerAvailable: true,
  dockerDetail: "Docker 27.1",
  strixInstalled: true,
  strixVersion: "1.6.2",
  hasEligibleBackend: SAMPLE_BACKEND_OPTIONS.some((option) => option.eligible),
}

export const useSecurityScanStore = create<SecurityScanStore>((set, get) => ({
  environment,
  backendOptions: SAMPLE_BACKEND_OPTIONS,
  run: null,
  setupOpen: false,
  selectedBackendId: firstEligibleBackendId(SAMPLE_BACKEND_OPTIONS),
  acknowledged: false,
  exporting: false,

  setSetupOpen: (open) => set({ setupOpen: open }),
  toggleSetup: () => set((state) => ({ setupOpen: !state.setupOpen })),
  selectBackend: (id) => set({ selectedBackendId: id }),
  setAcknowledged: (value) => set({ acknowledged: value }),

  startScan: () => {
    const state = get()
    if (!canStartScan(state)) return
    const option = state.backendOptions.find((item) => item.id === state.selectedBackendId)
    if (!option) return
    // TODO(slice 2): launch Strix in Docker and subscribe to run updates over the bridge.
    // Slice 1 loads a representative run so the dashboard is populated after Run.
    set({
      setupOpen: false,
      run: {
        ...SAMPLE_SCAN_RUN,
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        target: DEFAULT_TARGET,
        backend: {
          kind: option.kind,
          connectionId: option.id,
          model: option.model,
          label: option.label,
          baseUrl: option.baseUrl,
        },
      },
    })
  },

  cancelScan: () => {
    // TODO(slice 2): signal the runner to stop the sandbox.
    set((state) =>
      state.run
        ? { run: { ...state.run, status: "cancelled", finishedAt: Date.now() } }
        : {},
    )
  },

  exportReport: async () => {
    // TODO(slice 2): ask the main process to render the run to a PDF and reveal it.
    set({ exporting: true })
    try {
      // Placeholder until the PDF pipeline lands.
    } finally {
      set({ exporting: false })
    }
  },
}))

export function isScanRunning(run: SecurityScanRun | null): boolean {
  return run?.status === "running" || run?.status === "preparing"
}

/** A scan can start only with Docker, an eligible backend, consent, and nothing running. */
export function canStartScan(state: SecurityScanStore): boolean {
  if (!state.environment.dockerAvailable) return false
  if (isScanRunning(state.run)) return false
  if (!state.acknowledged) return false
  const option = state.backendOptions.find((item) => item.id === state.selectedBackendId)
  return option?.eligible === true
}
