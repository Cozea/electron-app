import { useMutation, useQuery } from "convex/react"
import { api } from "../../convex/_generated/api"
import { Id } from "../../convex/_generated/dataModel"

interface LogUsageParams {
  organizationId: Id<"organizations">
  userId: Id<"users">
  model: string
  provider: "anthropic" | "openai"
  promptTokens: number
  completionTokens: number
  totalTokens: number
  keySource: "organization" | "byok"
  feature?: string
  projectId?: string
}

export function useAiUsage(
  organizationId: Id<"organizations"> | null,
  userId: Id<"users"> | null
) {
  const logUsage = useMutation(api.aiUsage.log)

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

  // Helper to log usage from AI SDK response
  const trackUsage = async (
    params: Omit<LogUsageParams, "organizationId" | "userId"> & {
      organizationId?: Id<"organizations">
      userId?: Id<"users">
    }
  ) => {
    const orgId = params.organizationId || organizationId
    const uId = params.userId || userId

    if (!orgId || !uId) {
      console.warn("Cannot track usage: missing organizationId or userId")
      return null
    }

    return logUsage({
      organizationId: orgId,
      userId: uId,
      model: params.model,
      provider: params.provider,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.totalTokens,
      keySource: params.keySource,
      feature: params.feature,
      projectId: params.projectId,
    })
  }

  return {
    trackUsage,
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
