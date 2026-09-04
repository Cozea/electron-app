import type { NativeDevAppDiagnostic, NativeDevAppManifestV3 } from "./nativeDevAppManifest"

/**
 * Existing UI labels are retained for now, but every starter is native-React-first:
 * `view` is a component-only package, while `worker` and `view-worker` add an extension worker.
 */
export type DevAppScaffoldStarter = "view" | "worker" | "view-worker"

export interface DevAppDevelopmentSource {
  /** Opaque device-local ref segment; never a filesystem path. */
  sourceId: string
  ref: string
  projectId: string
  workspaceId: string
  relativePath: string
  name: string
  description: string | null
  manifest: NativeDevAppManifestV3
}

export type DevAppPackageInspection =
  | { status: "missing"; diagnostics: NativeDevAppDiagnostic[] }
  | { status: "invalid"; diagnostics: NativeDevAppDiagnostic[] }
  | {
      status: "valid"
      source: DevAppDevelopmentSource
      diagnostics: NativeDevAppDiagnostic[]
    }

export type DevAppAuthoringInspectionResult =
  | { success: true; inspection: DevAppPackageInspection }
  | { success: false; error: string }

export type DevAppAuthoringListResult =
  | { success: true; sources: DevAppDevelopmentSource[] }
  | { success: false; error: string }

/** What the scaffold could not finish. A package can still use its bootstrap preview. */
export interface DevAppScaffoldPreparationResult {
  lockfile: boolean
  committed: boolean
  warnings: string[]
}

export type DevAppAuthoringScaffoldResult =
  | {
      success: true
      source: DevAppDevelopmentSource
      createdFiles: string[]
      preparation: DevAppScaffoldPreparationResult
    }
  | { success: false; error: string }
