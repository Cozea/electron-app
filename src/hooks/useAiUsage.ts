import { useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"

/**
 * Hook to fetch AI usage data for an organization/user.
 * Note: Usage logging is handled server-side via the AI gateway.
 */
export function useAiUsage(
  organizationId: Id<"organizations"> | null,
  userId: Id<"users"> | null
) {
  const recentOrgUsage = useQuery(
    api.aiUsage.getRecentForOrganization,
    organizationId ? { organizationId, limit: 50 } : "skip"
  )

  const recentUserUsage = useQuery(
    api.aiUsage.getRecentForUser,
    userId ? { userId, limit: 25 } : "skip"
  )

  const monthlyAggregates = useQuery(
    api.aiUsage.getAggregates,
    organizationId ? { organizationId, period: "monthly" } : "skip"
  )

  const dailyAggregates = useQuery(
    api.aiUsage.getAggregates,
    organizationId ? { organizationId, period: "daily" } : "skip"
  )

  return {
    recentOrgUsage,
    recentUserUsage,
    monthlyAggregates,
    dailyAggregates,
    isLoading: organizationId && !recentOrgUsage,
  }
}

// Helper to extract usage from AI SDK response
export function extractUsageFromAiResponse(response: {
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens?: number
  }
}) {
  if (!response.usage) {
    return null
  }

  return {
    promptTokens: response.usage.promptTokens,
    completionTokens: response.usage.completionTokens,
    totalTokens:
      response.usage.totalTokens ||
      response.usage.promptTokens + response.usage.completionTokens,
  }
}
