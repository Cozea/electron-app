import { createContext, useContext } from "react";

import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes";

export interface ProjectRouteSlugResolutionCandidate {
  projectId: Id<"projects">;
  name: string;
  role: string;
  updatedAt: number;
}

export interface ProjectRouteSlugResolutionResult {
  status: "not_found" | "ambiguous" | "ok";
  project?: Doc<"projects">;
  role?: string;
  slug?: string;
  candidates?: ProjectRouteSlugResolutionCandidate[];
}

export interface ProjectRouteContextValue {
  project: Doc<"projects"> | null | undefined;
  projectIdParam: string | null;
  slugParam: string | null;
  slugResolution?: ProjectRouteSlugResolutionResult;
  localPath: string | null;
  gitCwd: string | null;
  projectBasePath: string | null;
  projectName: string | null;
  collabBranch: string | null;
  laneState: ProjectLaneState | null;
  activeLane: ProjectLaneDescriptor | null;
  collabLane: ProjectLaneDescriptor | null;
  collaborationEnabled: boolean;
  refreshLaneState?: () => Promise<void>;
}

export const ProjectRouteContext = createContext<ProjectRouteContextValue | null>(null);

export function useOptionalProjectRouteContext() {
  return useContext(ProjectRouteContext);
}
