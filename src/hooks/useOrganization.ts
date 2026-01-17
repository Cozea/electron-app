import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

export function useOrganization(orgId: Id<"organizations"> | null) {
  const organization = useQuery(
    api.organizations.get,
    orgId ? { id: orgId } : "skip"
  )

  const members = useQuery(
    api.organizations.getMembers,
    orgId ? { orgId } : "skip"
  )

  const pendingInvitations = useQuery(
    api.invitations.listForOrganization,
    orgId ? { orgId } : "skip"
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
  const updateSettings = useMutation(api.organizations.updateSettings)
  const updateAiCredentials = useMutation(api.organizations.updateAiCredentials)
  const inviteMember = useMutation(api.invitations.create)
  const revokeInvitation = useMutation(api.invitations.revoke)
  const acceptInvitation = useMutation(api.invitations.accept)

  return {
    createOrganization,
    updateSettings,
    updateAiCredentials,
    inviteMember,
    revokeInvitation,
    acceptInvitation,
  }
}
