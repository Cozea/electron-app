import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import { useAuth } from "@/contexts/AuthContext"

/**
 * Organizations this device belongs to. Previously OrgAttachDialog,
 * ProjectSettingsPage, and Organizations each subscribed separately.
 */
export function useMyOrganizations() {
  const { principalId } = useAuth()
  return useQuery(api.organizations.listMine, principalId ? {} : "skip")
}
