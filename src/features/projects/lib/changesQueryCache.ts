import type { Id } from "../../../../convex/_generated/dataModel"

export function getProjectChangesActivityCacheKey(projectId: Id<"projects"> | string): string {
  return `project-changes-activity:${String(projectId)}`
}

export function getProjectChangesSelectedChangeCacheKey(changeId: Id<"fileChanges"> | string): string {
  return `project-changes-selected:${String(changeId)}`
}
