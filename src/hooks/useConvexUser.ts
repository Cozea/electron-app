import { useEffect, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import { Id } from "../../convex/_generated/dataModel"
import type { User } from "../types/electron"

interface ConvexUser {
  _id: Id<"users">
  workosId: string
  email: string
  firstName?: string
  lastName?: string
  profileImageUrl?: string
  byokAnthropicKey?: string
  byokOpenaiKey?: string
  preferences?: {
    theme?: "light" | "dark" | "system"
    defaultModel?: string
  }
  organizations?: Array<{
    _id: Id<"organizations">
    name: string
    slug: string
    role: "owner" | "admin" | "member" | "viewer"
  }>
}

export function useConvexUser(workosUser: User | null) {
  const [convexUserId, setConvexUserId] = useState<Id<"users"> | null>(null)

  const syncFromWorkOS = useMutation(api.users.syncFromWorkOS)

  // Sync user when workosUser changes
  useEffect(() => {
    if (!workosUser) {
      setConvexUserId(null)
      return
    }

    syncFromWorkOS({
      workosId: workosUser.id,
      email: workosUser.email,
      firstName: workosUser.firstName || undefined,
      lastName: workosUser.lastName || undefined,
    })
      .then((userId) => {
        setConvexUserId(userId)
      })
      .catch((error) => {
        console.error("Failed to sync user to Convex:", error)
      })
  }, [workosUser, syncFromWorkOS])

  // Query user with organizations
  const userWithOrgs = useQuery(
    api.users.getWithOrganizations,
    convexUserId ? { userId: convexUserId } : "skip"
  )

  return {
    convexUserId,
    user: userWithOrgs as ConvexUser | null | undefined,
    isLoading: workosUser && !convexUserId,
  }
}
