import type { ConvexReactClient } from "convex/react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { ProjectGitRuntimeSourceControlLike } from "@/lib/git/projectGitRuntime";

export interface GitRepositoryMetadataLike {
  provider?: string;
  url?: string;
  defaultBranch?: string | null;
}

export interface ProjectImportedFromLike {
  provider: string;
  repoFullName: string;
  branch?: string | null;
  detectedStack?: unknown;
}

export interface ProjectOpenGitProjectLike {
  _id: Id<"projects">;
  name?: string | null;
  slug: string;
  organizationId: Id<"organizations">;
  createdBy?: Id<"users"> | string | null;
  localPath?: string | null;
  gitRepository?: GitRepositoryMetadataLike | null;
  sourceControl?: ProjectGitRuntimeSourceControlLike | null;
  importedFrom?: ProjectImportedFromLike | null;
}

export interface PrepareGitProjectForOpenOptions {
  convex: ConvexReactClient;
  project: ProjectOpenGitProjectLike;
  localPath: string | null;
  userId: Id<"users"> | null | undefined;
  onProgress?: (message: string) => void;
  updateMemberLocalPath?: (args: {
    projectId: Id<"projects">;
    userId: Id<"users">;
    localPath: string;
  }) => Promise<unknown>;
}

export interface PrepareGitProjectForOpenResult {
  localPath: string;
  skipInitialSyncCheck: boolean;
  changed: boolean;
  currentBranch?: string;
  cancelled?: boolean;
  needsConflictResolution?: boolean;
  conflictedPaths?: string[];
}
