import { useQuery } from "@/lib/cloudQueries"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"

/**
 * The project's member roster plus this device's role in it. Single shared
 * subscription; previously HeaderProjectShareButton, SessionHubDialog,
 * ProjectTeamPage, TasksPage, and ProjectSettingsPage each fired their own
 * identical pair of queries.
 */
export function useProjectTeam(projectId: Id<"projects"> | null | undefined, includeRoster = true) {
  const { principalId, isConvexAuthReady } = useAuth()
  const members = useQuery(
    api.projectMembers.listMembers,
    includeRoster && projectId && principalId && isConvexAuthReady ? { projectId, viewerPrincipalId: principalId } : "skip",
  )
  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    projectId && principalId && isConvexAuthReady ? { projectId, principalId: principalId } : "skip",
  )
  return { members, memberRole, principalId: principalId ?? null }
}
