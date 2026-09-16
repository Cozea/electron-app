import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"

/**
 * The project's member roster plus this device's role in it. Single shared
 * subscription; previously HeaderProjectShareButton, SessionHubDialog,
 * ProjectTeamPage, TasksPage, and ProjectSettingsPage each fired their own
 * identical pair of queries.
 */
export function useProjectTeam(projectId: Id<"projects"> | null | undefined) {
  const { principalId } = useAuth()
  const members = useQuery(
    api.projectMembers.listMembers,
    projectId && principalId ? { projectId, viewerPrincipalId: principalId } : "skip",
  )
  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    projectId && principalId ? { projectId, principalId } : "skip",
  )
  return { members, memberRole, principalId: principalId ?? null }
}
