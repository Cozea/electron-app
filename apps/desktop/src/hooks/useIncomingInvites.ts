import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"

/**
 * Shared hook for incoming project enrollments, organization enrollments,
 * and live session invitations. Used by the sidebar badge and the Inbox page.
 */
export function useIncomingInvites() {
  const { principalId } = useAuth()

  const projectEnrollments = useQuery(
    api.projectDeviceEnrollments.listIncoming,
    principalId ? {} : "skip",
  )

  const organizationEnrollments = useQuery(
    api.organizations.listIncomingEnrollments,
    principalId ? {} : "skip",
  )

  const sessionInvitations = useQuery(
    api.collaborationSessions.listIncomingInvitations,
    principalId ? {} : "skip",
  )

  const totalCount =
    (projectEnrollments?.length ?? 0) +
    (organizationEnrollments?.length ?? 0) +
    (sessionInvitations?.length ?? 0)

  return {
    projectEnrollments,
    organizationEnrollments,
    sessionInvitations,
    totalCount,
    isLoading:
      Boolean(principalId) &&
      (projectEnrollments === undefined ||
        organizationEnrollments === undefined ||
        sessionInvitations === undefined),
  }
}
