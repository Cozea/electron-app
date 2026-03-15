import { useMemo } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"

interface SlugResolutionCandidate {
  projectId: Id<"projects">
  organizationId: Id<"organizations">
  name: string
  role: string
  updatedAt: number
}

interface SlugResolutionResult {
  status: "not_found" | "ambiguous" | "ok"
  project?: Doc<"projects">
  role?: string
  slug?: string
  candidates?: SlugResolutionCandidate[]
}

export function useAccessibleProject() {
  const { slug, projectId } = useParams<{ slug?: string; projectId?: string }>()
  const { convexUserId } = useAuth()
  const { convexOrg, preferredConvexOrganizationId } = useScopedAppContext()

  const projectById = useQuery(
    api.projects.getAccessibleById,
    projectId && convexUserId
      ? { projectId: projectId as Id<"projects">, userId: convexUserId }
      : "skip"
  )

  const projectBySlugResult = useQuery(
    api.projects.getAccessibleBySlug,
    !projectId && slug && convexUserId
      ? {
          slug,
          userId: convexUserId,
          preferredOrganizationId: preferredConvexOrganizationId,
        }
      : "skip"
  ) as SlugResolutionResult | undefined

  const project = useMemo(() => {
    if (projectId) {
      return projectById
    }
    if (!slug) {
      return null
    }
    if (projectBySlugResult === undefined) {
      return undefined
    }
    if (projectBySlugResult.status !== "ok") {
      return null
    }
    return projectBySlugResult.project ?? null
  }, [projectById, projectBySlugResult, projectId, slug])

  return {
    project,
    projectIdParam: projectId ?? null,
    slugParam: slug ?? null,
    convexUserId,
    convexOrg,
    slugResolution: projectBySlugResult,
  }
}
