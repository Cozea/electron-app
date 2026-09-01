import type { DevAppPackage, DevAppPackageDiagnostic } from "./devAppPackage";

export type DevAppScaffoldStarter = "view" | "worker" | "view-worker";

export interface DevAppDevelopmentSource {
  /** Opaque device-local ref segment; never a filesystem path. */
  sourceId: string;
  ref: string;
  projectId: string;
  workspaceId: string;
  relativePath: string;
  name: string;
  description: string | null;
  manifest: DevAppPackage;
}

export type DevAppPackageInspection =
  | { status: "missing"; diagnostics: DevAppPackageDiagnostic[] }
  | { status: "invalid"; diagnostics: DevAppPackageDiagnostic[] }
  | {
      status: "valid";
      source: DevAppDevelopmentSource;
      diagnostics: DevAppPackageDiagnostic[];
    };

export type DevAppAuthoringInspectionResult =
  | { success: true; inspection: DevAppPackageInspection }
  | { success: false; error: string };

export type DevAppAuthoringListResult =
  | { success: true; sources: DevAppDevelopmentSource[] }
  | { success: false; error: string };

export type DevAppAuthoringScaffoldResult =
  | { success: true; source: DevAppDevelopmentSource; createdFiles: string[] }
  | { success: false; error: string };
