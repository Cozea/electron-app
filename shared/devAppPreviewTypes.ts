import type { DevAppGrant } from "./devAppCapabilities"
import type { DevAppPackageToolSpec } from "./devAppPackage"
import type { DevAppTrustBadge } from "./devAppDevelopmentTrust"
import type { OrgDevAppPreflightReport } from "./orgDevAppDiagnostics"

/** One renderer-safe diagnostic, shared by legacy package and native-v3 previews. */
export interface DevAppPreviewDiagnostic {
  code: string
  severity: "blocker" | "warning"
  message: string
  field?: string
  fix?: string
}

export interface DevAppPreviewNativeReactView {
  kind: "nativeReact"
  appId: string
  appVersion: string
  surfaceId: string
  component: string
  moduleUrl: string
  stylesUrl?: string
}

/**
 * What the renderer is told about a development preview.
 *
 * A native surface is a React component loaded into Cozea's renderer. Web applications
 * retain their isolated browser surface, but both are represented by the same preview
 * lifecycle and workbench tile.
 */
export type DevAppPreviewView =
  | DevAppPreviewNativeReactView
  /** A framework dev server the author is already running. Hot reload comes free. */
  | { kind: "devServer"; url: string }
  /** The same built output publishing would pack. No hot reload, but no surprises either. */
  | { kind: "builtOutput"; entryPath: string; url: string }
  | { kind: "unavailable"; reason: string; fix?: string }

/** Mirrors the worker/extension host's state so a crash loop is diagnosable. */
export interface DevAppPreviewWorkerState {
  publicationId: string
  protocolVersion: number
  status: "starting" | "ready" | "stopped" | "crashed"
  restarts: number
  lastError: string | null
  logs: string[]
}

export type DevAppPreviewStatus =
  | { status: "invalid"; diagnostics: DevAppPreviewDiagnostic[] }
  | {
    status: "needsApproval"
    sourceId: string
    name: string
    requested: DevAppGrant
    declaredTools: DevAppPackageToolSpec[]
    /** Executable background code will run outside the renderer. */
    workerExecution: boolean
    /** Same-renderer React code will run inside Cozea and therefore always needs trust. */
    nativeExecution?: boolean
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
    declaredTools: DevAppPackageToolSpec[]
    badge: DevAppTrustBadge
    preflight: OrgDevAppPreflightReport
    worker: DevAppPreviewWorkerState | null
    /** Changes whenever the view should reload. */
    reloadToken: number
  }

export type DevAppPreviewOpenResult =
  | { success: true; preview: DevAppPreviewStatus & { hotReload: boolean } }
  | { success: false; error: string }

export type DevAppPreviewResult =
  | { success: true; preview: DevAppPreviewStatus }
  | { success: false; error: string }
