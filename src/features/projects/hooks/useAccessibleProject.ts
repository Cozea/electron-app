import { useMemo } from "react"
import { useParams } from "react-router-dom"
import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Doc, Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"

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
  const { user, currentOrganization } = useAuth()

  const convexUser = useQuery(
    api.users.getByWorkosId,
    user?.id ? { workosId: user.id } : "skip"
  )

  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : "skip"
  )

  const projectById = useQuery(
    api.projects.getAccessibleById,
    projectId && convexUser?._id
      ? { projectId: projectId as Id<"projects">, userId: convexUser._id }
      : "skip"
  )

  const projectBySlugResult = useQuery(
    api.projects.getAccessibleBySlug,
    !projectId && slug && convexUser?._id
      ? {
          slug,
          userId: convexUser._id,
          preferredOrganizationId: convexOrg?._id,
        }
      : "skip"
  ) as SlugResolutionResult | undefined

  const project = useMemo(() => {
    if (projectId) {
      return projectById ?? null
    }
    if (!projectBySlugResult || projectBySlugResult.status !== "ok") {
      return null
    }
    return projectBySlugResult.project ?? null
  }, [projectById, projectBySlugResult, projectId])

  return {
    project,
    projectIdParam: projectId ?? null,
    slugParam: slug ?? null,
    convexUser,
    convexOrg,
    slugResolution: projectBySlugResult ?? null,
  }
}
