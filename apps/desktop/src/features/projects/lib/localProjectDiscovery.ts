import type { LocalProjectDTO, LocalProjectsElectronAPI } from "@shared/localProjectTypes";
import type { WorkspaceCatalogSnapshot } from "@shared/workspaceTypes";
import type { Doc } from "../../../../../../convex/_generated/dataModel";
import type { SidebarProjectItem } from "../ui/sidebar/projectSidebarShared";

/** Discovery comes only from durable entries, including hidden/unbound projects. */
export function discoverLocalProjects(
  snapshot: WorkspaceCatalogSnapshot | null,
): LocalProjectDTO[] | undefined {
  if (!snapshot?.projects) return undefined;
  return Object.values(snapshot.projects).filter((project) => project.status !== "removed");
}

export function buildLocalSidebarProject(
  project: LocalProjectDTO,
  sharedProject?: Doc<"projects"> | null,
): SidebarProjectItem {
  // Optional shared presentation never invents a row or changes its local key.
  const shared = sharedProject?._id === project.cloudProjectId ? sharedProject : null;
  return {
    id: project.projectId,
    _id: project.cloudProjectId,
    name: project.name,
    hidden: project.hidden,
    status: project.status,
    slug: project.slug,
    updatedAt: project.updatedAt,
    template: shared?.template ?? null,
    createdBy: shared?.createdBy ?? null,
    sourceControl: shared?.sourceControl,
    gitRepository: shared?.gitRepository,
    importedFrom: shared?.importedFrom ?? null,
    organizationId: shared?.organizationId ?? null,
  };
}

export async function updateLocalProjectPresentation(
  projects: Pick<LocalProjectsElectronAPI, "get" | "updateMetadata">,
  projectId: string,
  metadata: { localName?: string | null; hidden?: boolean },
): Promise<LocalProjectDTO> {
  const project = await projects.get(projectId);
  if (!project || project.status === "removed") throw new Error("Local project not found.");
  const result = await projects.updateMetadata({ projectId: project.projectId, ...metadata });
  if (!result.success) throw new Error(result.error);
  return result.value;
}
