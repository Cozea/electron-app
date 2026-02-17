import type { Id } from "../../../../convex/_generated/dataModel"
import type { ProjectOpenReplicaCheckResult } from "./projectOpenReplicaCheck"

export interface ProjectOpenSyncReviewRequest {
  projectId: Id<"projects">
  projectSlug: string
  projectName: string
  projectTemplate?: string | null
  projectPath: string
  check: ProjectOpenReplicaCheckResult
}
