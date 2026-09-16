import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"

/**
 * Live sessions in a project. Previously StartCollaborationDialog and
 * LiveSessionShareSection each subscribed separately; ProjectLayout keeps its
 * own cached variant and is intentionally not migrated.
 */
export function useProjectSessions(
  projectId: Id<"projects"> | null | undefined,
  enabled = true,
) {
  return useQuery(
    api.collaborationSessions.listByProject,
    projectId && enabled ? { projectId } : "skip",
  )
}
