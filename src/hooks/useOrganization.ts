import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"

export function useOrganization(orgId: Id<"organizations"> | null) {
  const { convexUserId } = useAuth()
  const organization = useQuery(
    api.organizations.get,
    orgId ? { id: orgId } : "skip"
  )

  const members = useQuery(
    api.organizations.getMembers,
    orgId && convexUserId ? { orgId, viewerUserId: convexUserId } : "skip"
  )

  const pendingInvitations = useQuery(
    api.invitations.listForOrganization,
    orgId && convexUserId ? { orgId, viewerUserId: convexUserId } : "skip"
  )

  const usageSummary = useQuery(
    api.organizations.getUsageSummary,
    orgId ? { orgId, period: "monthly" } : "skip"
  )

  return {
    organization,
    members,
    pendingInvitations,
    usageSummary,
    isLoading: orgId && !organization,
  }
}

export function useOrganizationMutations() {
  const createOrganization = useMutation(api.organizations.create)
  const inviteMember = useMutation(api.invitations.create)
  const revokeInvitation = useMutation(api.invitations.revoke)

  return {
    createOrganization,
    inviteMember,
    revokeInvitation,
  }
}
