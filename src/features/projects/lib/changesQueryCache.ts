import type { Id } from "../../../../convex/_generated/dataModel"

export function getProjectChangesActivityCacheKey(projectId: Id<"projects"> | string): string {
  return `project-changes-activity:${String(projectId)}`
}
