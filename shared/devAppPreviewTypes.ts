import type { DevAppGrant } from "./devAppCapabilities"
import type {
  NativeDevAppDiagnostic,
  NativeDevAppToolSpec,
} from "./nativeDevAppManifest"
import type { DevAppTrustBadge } from "./devAppDevelopmentTrust"
import type { OrgDevAppPreflightReport } from "./orgDevAppDiagnostics"

/** What the renderer is told about a development preview. */
export type DevAppPreviewView =
  | {
      kind: "nativeReact"
      appId: string
      appVersion: string
      surfaceId: string
      moduleUrl: string
      component: string
      stylesUrl?: string
    }
  /** An adopted web application's local development server. */
  | { kind: "devServer"; url: string }
  /** An adopted web application's built static output. */
  | { kind: "builtOutput"; entryPath: string; url: string }
  | { kind: "unavailable"; reason: string; fix?: string }

/** Mirrors the extension host's state, which the tile shows so a crash loop is diagnosable. */
export interface DevAppPreviewWorkerState {
  publicationId: string
  protocolVersion: number
  status: "starting" | "ready" | "stopped" | "crashed"
  restarts: number
  lastError: string | null
  logs: string[]
}

export type DevAppPreviewStatus =
  | { status: "invalid"; diagnostics: NativeDevAppDiagnostic[] }
  | {
      status: "needsApproval"
      sourceId: string
      name: string
      requested: DevAppGrant
      declaredTools: NativeDevAppToolSpec[]
      /** Extension code executes out of process but is not an OS sandbox in development. */
      workerExecution: boolean
      /** Binds approval to the exact request the user was shown. */
      approvalFingerprint: string
      missing: string[]
      badge: DevAppTrustBadge
      preflight: OrgDevAppPreflightReport
    }
  | {
      status: "running"
      sourceId: string
      name: string
      view: DevAppPreviewView
      grant: DevAppGrant
      declaredTools: NativeDevAppToolSpec[]
      badge: DevAppTrustBadge
      preflight: OrgDevAppPreflightReport
      worker: DevAppPreviewWorkerState | null
      /** Changes whenever the renderer module or adopted web view should reload. */
      reloadToken: number
    }

export type DevAppPreviewOpenResult =
  | { success: true; preview: DevAppPreviewStatus & { hotReload: boolean } }
  | { success: false; error: string }

export type DevAppPreviewResult =
  | { success: true; preview: DevAppPreviewStatus }
  | { success: false; error: string }
