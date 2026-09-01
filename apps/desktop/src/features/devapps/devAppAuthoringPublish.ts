import type { ConvexReactClient } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { OrgDevAppPublishStage } from "@/features/devapps/orgDevAppPublishing";
import { publishOrgDevAppFromWorkspace } from "@/features/devapps/orgDevAppPublishing";

export interface ProgrammaticDevAppPublishRequest {
  convex: ConvexReactClient;
  projectId: Id<"projects">;
  workspaceId: string;
  /** Required only for the first publication; later releases retain the current logo. */
  logoDataUrl?: string;
  signal?: AbortSignal;
  onStageChange?: (stage: OrgDevAppPublishStage) => void;
}

/**
 * Publishes the root native DevApp package without opening any dialog.
 *
 * The manifest is authoritative for name and description; identity and upload authority
 * still come from the authenticated Convex client. This is the API used by headless
 * commands and future agent tooling, so adding another UI is never a publication precondition.
 */
export async function publishNativeDevAppProgrammatically(
  request: ProgrammaticDevAppPublishRequest,
): Promise<void> {
  const inspection = await window.electronAPI.devAppAuthoring.inspectWorkspace({
    workspaceId: request.workspaceId,
  });
  if (!inspection.success) throw new Error(inspection.error);
  if (inspection.inspection.status !== "valid") {
    throw new Error(
      inspection.inspection.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
    );
  }

  const existing = await request.convex.query(api.devApps.getForProject, {
    projectId: request.projectId,
  });
  if (!existing && !request.logoDataUrl) {
    throw new Error("The first publication requires a PNG, JPEG, or WebP logo data URL.");
  }

  await publishOrgDevAppFromWorkspace({
    convex: request.convex,
    projectId: request.projectId,
    workspaceId: request.workspaceId,
    name: inspection.inspection.source.manifest.name,
    ...(inspection.inspection.source.manifest.description
      ? { description: inspection.inspection.source.manifest.description }
      : {}),
    ...(request.logoDataUrl ? { logoDataUrl: request.logoDataUrl } : {}),
    signal: request.signal,
    onStageChange: request.onStageChange,
  });
}
