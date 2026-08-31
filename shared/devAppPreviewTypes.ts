import type { DevAppGrant } from "./devAppCapabilities"
import type { DevAppPackageDiagnostic } from "./devAppPackage"
import type { DevAppTrustBadge } from "./devAppDevelopmentTrust"
import type { OrgDevAppPreflightReport } from "./orgDevAppDiagnostics"

/**
 * What the renderer is told about a development preview.
 *
 * Lives in shared rather than beside the session because both sides read it, and because
 * the tile must not be able to invent a status the host did not produce — it renders
 * these, and never the other way around.
 */

export type DevAppPreviewView =
  /** A framework dev server the author is already running. Hot reload comes free. */
  | { kind: "devServer"; url: string }
  /** The same built output publishing would pack. No hot reload, but no surprises either. */
  | { kind: "builtOutput"; entryPath: string }
  | { kind: "unavailable"; reason: string; fix?: string }

/** Mirrors the worker host's state, which the tile shows so a crash loop is diagnosable. */
export interface DevAppPreviewWorkerState {
  publicationId: string
  status: "starting" | "ready" | "stopped" | "crashed"
  restarts: number
  lastError: string | null
  logs: string[]
}

export type DevAppPreviewStatus =
  | { status: "invalid"; diagnostics: DevAppPackageDiagnostic[] }
  | {
    status: "needsApproval"
    sourceId: string
    name: string
    requested: DevAppGrant
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
