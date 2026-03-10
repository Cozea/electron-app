interface ProjectSummaryForDebug {
  _id?: string | null
  slug?: string | null
  name?: string | null
  status?: string | null
  organizationId?: string | null
  createdBy?: string | null
  updatedAt?: number | null
}

function canUseProjectSourceDebug(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}

export function isProjectSourceDebugEnabled(): boolean {
  if (!canUseProjectSourceDebug()) {
    return false
  }

  return window.localStorage.getItem('projectSourceDebug') === '1'
}

export function logProjectSourceDebug(event: string, payload: Record<string, unknown>): void {
  if (!isProjectSourceDebugEnabled()) {
    return
  }

  console.info(`[ProjectSourceDebug] ${event}`, payload)
}

export function summarizeProjectForDebug(
  project: ProjectSummaryForDebug | null | undefined
): Record<string, unknown> | null {
  if (!project) {
    return null
  }

  return {
    id: project._id ?? null,
    slug: project.slug ?? null,
    name: project.name ?? null,
    status: project.status ?? null,
    organizationId: project.organizationId ?? null,
    createdBy: project.createdBy ?? null,
    updatedAt: project.updatedAt ?? null,
  }
}
