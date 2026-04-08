import type { Doc, Id } from "../_generated/dataModel"
import type { QueryCtx } from "../_generated/server"

const PROJECT_PAGE_DEFAULT_SIZE = 20
const PROJECT_PAGE_MAX_SIZE = 100

export type ProjectsPageStatusFilter = "all" | "active" | "draft" | "building" | "archived"
export type ProjectsPageSortOption = "last_modified" | "name" | "created"

export interface ProjectPageItem {
  _id: Id<"projects">
  organizationId: Id<"organizations">
  name: string
  slug: string
  description?: string
  template?: string
  status: Doc<"projects">["status"]
  createdAt: number
  updatedAt: number
  createdBy: Id<"users">
  lastSyncAt?: number
  lastSyncBy?: Id<"users">
  syncMode?: Doc<"projects">["syncMode"]
  sourceControl?: Doc<"projects">["sourceControl"]
  gitRepository?: Doc<"projects">["gitRepository"]
  localPath: string | null
  previewImageUrl: string | null
}

export interface ProjectsPageResult {
  items: ProjectPageItem[]
  total: number
  totalPages: number
  page: number
  pageSize: number
  hasArchivedProjects: boolean
}

export function normalizeProjectsPageSize(pageSize?: number): number {
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize)) {
    return PROJECT_PAGE_DEFAULT_SIZE
  }

  return Math.max(1, Math.min(PROJECT_PAGE_MAX_SIZE, Math.floor(pageSize)))
}

function normalizeProjectsPage(page: number | undefined, totalPages: number): number {
  if (typeof page !== "number" || !Number.isFinite(page)) {
    return 1
  }

  return Math.max(1, Math.min(totalPages, Math.floor(page)))
}

function matchesProjectsPageStatus(
  project: Doc<"projects">,
  statusFilter: ProjectsPageStatusFilter,
): boolean {
  if (project.status === "deleted") {
    return false
  }

  if (statusFilter === "all") {
    return project.status !== "archived"
  }

  if (statusFilter === "building") {
    return project.status === "building" || project.status === "generating"
  }

  return project.status === statusFilter
}

function sortProjectsPageRows(
  projects: Doc<"projects">[],
  sortBy: ProjectsPageSortOption,
): Doc<"projects">[] {
  return [...projects].sort((left, right) => {
    switch (sortBy) {
      case "name": {
        const byName = left.name.localeCompare(right.name, undefined, {
          sensitivity: "base",
        })
        if (byName !== 0) return byName
        break
      }
      case "created": {
        const byCreated = right.createdAt - left.createdAt
        if (byCreated !== 0) return byCreated
        break
      }
      case "last_modified":
      default: {
        const byUpdated = right.updatedAt - left.updatedAt
        if (byUpdated !== 0) return byUpdated
        break
      }
    }

    return String(left._id).localeCompare(String(right._id))
  })
}

function paginateProjectsPageRows<T>(
  items: T[],
  page?: number,
  pageSize?: number,
): {
  items: T[]
  total: number
  totalPages: number
  page: number
  pageSize: number
} {
  const normalizedPageSize = normalizeProjectsPageSize(pageSize)
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize))
  const normalizedPage = normalizeProjectsPage(page, totalPages)
  const startIndex = (normalizedPage - 1) * normalizedPageSize

  return {
    items: items.slice(startIndex, startIndex + normalizedPageSize),
    total,
    totalPages,
    page: normalizedPage,
    pageSize: normalizedPageSize,
  }
}

async function buildProjectsPageItems(
  ctx: QueryCtx,
  projects: Doc<"projects">[],
  memberPathMap: Map<string, string | null>,
): Promise<ProjectPageItem[]> {
  return await Promise.all(
    projects.map(async (project) => ({
      _id: project._id,
      organizationId: project.organizationId,
      name: project.name,
      slug: project.slug,
      description: project.description,
      template: project.template,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      createdBy: project.createdBy,
      lastSyncAt: project.lastSyncAt,
      lastSyncBy: project.lastSyncBy,
      syncMode: project.syncMode,
      sourceControl: project.sourceControl,
      gitRepository: project.gitRepository,
      localPath: memberPathMap.get(String(project._id)) ?? null,
      previewImageUrl: project.previewImageId
        ? await ctx.storage.getUrl(project.previewImageId)
        : null,
    })),
  )
}

export async function buildProjectsPageResult(
  ctx: QueryCtx,
  args: {
    projects: Doc<"projects">[]
    memberPathMap: Map<string, string | null>
    statusFilter: ProjectsPageStatusFilter
    sortBy: ProjectsPageSortOption
    page?: number
    pageSize?: number
  },
): Promise<ProjectsPageResult> {
  const hasArchivedProjects = args.projects.some((project) => project.status === "archived")
  const filteredProjects = args.projects.filter((project) =>
    matchesProjectsPageStatus(project, args.statusFilter),
  )
  const sortedProjects = sortProjectsPageRows(filteredProjects, args.sortBy)
  const paginated = paginateProjectsPageRows(sortedProjects, args.page, args.pageSize)
  const items = await buildProjectsPageItems(ctx, paginated.items, args.memberPathMap)

  return {
    items,
    total: paginated.total,
    totalPages: paginated.totalPages,
    page: paginated.page,
    pageSize: paginated.pageSize,
    hasArchivedProjects,
  }
}
