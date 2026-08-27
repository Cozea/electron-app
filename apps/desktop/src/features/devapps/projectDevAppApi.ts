import type { Id } from "../../../../../convex/_generated/dataModel";

export interface ProjectDevAppPublication {
  _id: Id<"devAppPublications">;
  projectId: Id<"projects">;
  activeReleaseId?: Id<"devAppReleases">;
  visibility: "project";
  name: string;
  description?: string;
  status: "active" | "archived";
  createdBy: Id<"users">;
  updatedBy: Id<"users">;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDevAppRelease {
  _id: Id<"devAppReleases">;
  publicationId: Id<"devAppPublications">;
  projectId: Id<"projects">;
  version: number;
  framework: string;
  devCommand: string;
  devPort?: number;
  sourceRevision?: string;
  sourceFingerprint: string;
  createdBy: Id<"users">;
  createdAt: number;
}

export interface ProjectDevAppSourceProject {
  _id: Id<"projects">;
  name: string;
  slug: string;
  description: string | null;
  previewImageId: Id<"_storage"> | null;
  status: string;
  updatedAt: number;
}

export interface ProjectDevAppProjectState {
  projectId: Id<"projects">;
  canPublish: boolean;
  publication: ProjectDevAppPublication | null;
  activeRelease: ProjectDevAppRelease | null;
}

export interface AccessibleProjectDevApp {
  publication: ProjectDevAppPublication;
  activeRelease: ProjectDevAppRelease;
  sourceProject: ProjectDevAppSourceProject;
  /** Presentation-ready, machine-local raster logo. Absent for legacy entries. */
  logoDataUrl?: string;
}

export type PublishProjectDevAppArgs = {
  projectId: Id<"projects">;
  userId: Id<"users">;
  name: string;
  description?: string;
  framework: string;
  devCommand: string;
  devPort?: number;
  sourceRevision?: string;
  sourceFingerprint: string;
};

export interface PublishProjectDevAppResult {
  publication: ProjectDevAppPublication;
  release: ProjectDevAppRelease;
  created: boolean;
}
