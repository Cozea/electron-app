import { describe, expect, it } from "vitest";

import type { Id } from "../../convex/_generated/dataModel";
import type { AccessibleProjectDevApp } from "@/features/devapps/projectDevAppApi";
import { buildProjectDevAppManifest } from "@/features/devapps/projectDevAppManifest";

function createEntry(logoDataUrl?: string): AccessibleProjectDevApp {
  const projectId = "project_1" as Id<"projects">;
  const publicationId = "publication_1" as Id<"devAppPublications">;
  const releaseId = "release_1" as Id<"devAppReleases">;

  return {
    publication: {
      _id: publicationId,
      projectId,
      activeReleaseId: releaseId,
      visibility: "project",
      name: "Sammy",
      status: "active",
      createdBy: "user_1" as Id<"devicePrincipals">,
      updatedBy: "user_1" as Id<"devicePrincipals">,
      createdAt: 1,
      updatedAt: 1,
    },
    activeRelease: {
      _id: releaseId,
      publicationId,
      projectId,
      version: 1,
      framework: "vite-react",
      devCommand: "bun run dev",
      sourceFingerprint: "a".repeat(64),
      createdBy: "user_1" as Id<"devicePrincipals">,
      createdAt: 1,
    },
    sourceProject: {
      _id: projectId,
      name: "Sammy",
      slug: "sammy",
      description: null,
      previewImageId: null,
      status: "active",
      updatedAt: 1,
    },
    ...(logoDataUrl ? { logoDataUrl } : {}),
  };
}

describe("project DevApp manifest", () => {
  it("uses the publication's uploaded logo without bundled-art scaling", () => {
    const logoDataUrl = "data:image/webp;base64,UklGRjEyMzRXRUJQ";
    const manifest = buildProjectDevAppManifest(createEntry(logoDataUrl));

    expect(manifest.icon).toEqual({
      src: logoDataUrl,
      alt: "Sammy DevApp",
    });
    expect(JSON.stringify(manifest.launch)).not.toContain("data:image");
  });

  it("keeps the bundled Dev Server icon for legacy entries without a logo", () => {
    const manifest = buildProjectDevAppManifest(createEntry());

    expect(manifest.icon.src).not.toBe("");
    expect(manifest.icon.className).toBe("scale-[1.25]");
  });

  it("falls back to bundled artwork when a caller provides an unsafe logo URL", () => {
    const manifest = buildProjectDevAppManifest(createEntry("https://example.test/logo.png"));

    expect(manifest.icon.src).not.toBe("https://example.test/logo.png");
    expect(manifest.icon.className).toBe("scale-[1.25]");
  });

  it("carries the live source runtime without exposing a filesystem path", () => {
    const manifest = buildProjectDevAppManifest(createEntry(), {
      workspaceId: "workspace_source",
      laneId: "lane_source",
    });

    expect(manifest.launch).toMatchObject({
      kind: "projectDevApp",
      projectId: "project_1",
      sourceWorkspaceId: "workspace_source",
      sourceLaneId: "lane_source",
    });
    expect(JSON.stringify(manifest.launch)).not.toContain("/Users/");
  });
});
