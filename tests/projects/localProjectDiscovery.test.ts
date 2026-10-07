import { describe, expect, it, vi } from "vitest";
import {
  buildLocalSidebarProject,
  discoverLocalProjects,
  updateLocalProjectPresentation,
} from "@/features/projects/lib/localProjectDiscovery";
import {
  buildOrderedProjects,
  moveSidebarProject,
} from "@/features/projects/ui/sidebar/projectSidebarState";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import type {
  LocalProjectId,
  UpdateLocalProjectMetadataRequest,
} from "../../shared/localProjectTypes";
import { localProject } from "./localProjectFixtures";

describe("local project discovery and presentation", () => {
  it("distinguishes loading from an empty catalog and retains hidden/unbound entries", () => {
    expect(discoverLocalProjects(null)).toBeUndefined();
    expect(
      discoverLocalProjects({ revision: 1, generatedAt: 1, entries: {}, projects: {} }),
    ).toEqual([]);
    const hidden = {
      ...localProject,
      projectId: "historical_project" as LocalProjectId,
      hidden: true,
    };
    const projects = discoverLocalProjects({
      revision: 2,
      generatedAt: 1,
      entries: {},
      projects: {
        [localProject.projectId]: localProject,
        [hidden.projectId]: hidden,
        removed: { ...localProject, status: "removed" },
      },
    })!;
    expect(projects).toEqual([localProject, hidden]);
    const rows = projects.map((project) => buildLocalSidebarProject(project));
    expect(
      buildOrderedProjects(rows, [hidden.projectId, localProject.projectId]).map((p) => p.id),
    ).toEqual([hidden.projectId, localProject.projectId]);
    expect(rows[0]._id).toBeNull();
    expect(rows[1].id).toBe("historical_project");
  });

  it("keeps the local execution ID and rejects mismatched shared projections", () => {
    const cloud = "cloud_project" as Id<"projects">;
    const shared = {
      _id: cloud,
      name: "Shared",
      slug: "shared",
      status: "archived",
      template: "blank",
      sourceControl: { provider: "github", defaultBranch: "master" },
      organizationId: "org_one",
    } as Doc<"projects">;
    const associated = { ...localProject, cloudProjectId: cloud, hidden: true };
    expect(buildLocalSidebarProject(associated, shared)).toMatchObject({
      id: localProject.projectId,
      _id: cloud,
      name: "Personal",
      slug: "personal",
      status: "active",
      hidden: true,
      sourceControl: shared.sourceControl,
      organizationId: "org_one",
    });
    expect(buildLocalSidebarProject(localProject, shared)).toMatchObject({
      _id: null,
      sourceControl: undefined,
      organizationId: null,
    });
  });

  it("renames and hides through local metadata without changing shared name or status", async () => {
    let stored = {
      ...localProject,
      cloudProjectId: "shared" as Id<"projects">,
      sharedName: "Collaborators",
      sharedStatus: "active" as const,
    };
    const projects = {
      get: vi.fn(async () => stored),
      updateMetadata: vi.fn(async (request: UpdateLocalProjectMetadataRequest) => {
        stored = { ...stored, ...request, name: request.localName ?? stored.name };
        return { success: true as const, value: stored };
      }),
    };
    await updateLocalProjectPresentation(projects, stored.projectId, { localName: "My label" });
    await updateLocalProjectPresentation(projects, stored.projectId, { hidden: true });
    expect(stored).toMatchObject({
      name: "My label",
      hidden: true,
      sharedName: "Collaborators",
      sharedStatus: "active",
      cloudProjectId: "shared",
    });
    expect(projects.updateMetadata.mock.calls[0][0]).toEqual({
      projectId: localProject.projectId,
      localName: "My label",
    });
    expect(projects.updateMetadata.mock.calls[1][0]).toEqual({
      projectId: localProject.projectId,
      hidden: true,
    });
  });

  it("reports unavailable local storage instead of treating it as a successful rename", async () => {
    const projects = {
      get: vi.fn(async () => localProject),
      updateMetadata: vi.fn(async () => ({ success: false as const, error: "disk full" })),
    };
    await expect(
      updateLocalProjectPresentation(projects, localProject.projectId, { hidden: true }),
    ).rejects.toThrow("disk full");
  });

  it("moves visible rows across hidden neighbors while retaining their order entries", () => {
    const rows = [
      buildLocalSidebarProject(localProject),
      buildLocalSidebarProject({
        ...localProject,
        projectId: "hidden" as LocalProjectId,
        hidden: true,
      }),
      buildLocalSidebarProject({ ...localProject, projectId: "last" as LocalProjectId }),
    ];
    expect(
      moveSidebarProject(rows, [localProject.projectId, "hidden", "last"], "last", "up", false),
    ).toEqual(["last", localProject.projectId, "hidden"]);
  });
});
