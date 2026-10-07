import type { ContextMenuItem } from "@cozea/assistant-contracts"
import type { CozeaDesktopPreviewBridge } from "../../../shared/browserSurfaceTypes"

/**
 * Types for `window.desktopBridge`, exposed by `apps/desktop/electron/preload.ts`
 * (checked there with `satisfies DesktopBridgeSurface`) and consumed by the
 * renderer through `src/lib/desktopBridgeClient.ts`.
 */

export type AssistantRuntimePhase = "idle" | "starting" | "ready" | "error"

export interface AssistantRuntimeBridgeStatus {
  phase: AssistantRuntimePhase
  wsUrl: string | null
  lastError: string | null
  updatedAt: number
}

export interface SubstrateShadowFeatureFlags {
  readonly rpcChat: boolean
  readonly providers: boolean
  readonly vcs: boolean
  readonly primary: boolean
  readonly inProcessAssistant: boolean
}

export interface SubstrateShadowBridgeStatus {
  readonly phase: "stopped" | "starting" | "ready" | "error" | "stopping"
  readonly enabled: boolean
  readonly baseUrl: string
  readonly readyPath: string
  readonly lastError: string | null
  readonly features: SubstrateShadowFeatureFlags
}

export interface SubstrateVcsInvalidateResult {
  readonly ok: boolean
  readonly reason?: "substrate_vcs_disabled" | "invalid_cwd" | "unavailable"
}

export interface SubstrateVcsCapabilities {
  readonly enabled: boolean
  readonly capabilities: {
    readonly status: boolean
    readonly refs: boolean
    readonly worktrees: boolean
    readonly checkpoints: boolean
    readonly push: boolean
    readonly ignore: boolean
    readonly init: boolean
  }
}

export interface DesktopBridgeSurface {
  preview?: CozeaDesktopPreviewBridge
  getAssistantRuntimeStatus: () => Promise<AssistantRuntimeBridgeStatus>
  getSubstrateShadowStatus?: () => Promise<SubstrateShadowBridgeStatus>
  substrateVcs?: {
    invalidate: (cwd: string) => Promise<SubstrateVcsInvalidateResult>
    getCapabilities: () => Promise<SubstrateVcsCapabilities>
  }
  getWsUrl: () => string | null
  pickFolder: () => Promise<string | null>
  confirm: (message: string) => Promise<boolean>
  setTheme?: (theme: "light" | "dark" | "system") => Promise<void>
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>
  openExternal: (url: string) => Promise<boolean>
  onAssistantRuntimeStatus?: (listener: (status: AssistantRuntimeBridgeStatus) => void) => () => void
  onMenuAction?: (listener: (action: string) => void) => () => void
  getUpdateState?: () => Promise<unknown>
  downloadUpdate?: () => Promise<{ accepted: boolean; completed: boolean; state: unknown }>
  installUpdate?: () => Promise<{ accepted: boolean; completed: boolean; state: unknown }>
  onUpdateState?: (listener: (state: unknown) => void) => () => void
}
