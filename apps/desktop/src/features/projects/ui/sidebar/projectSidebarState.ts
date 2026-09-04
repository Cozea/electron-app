import type { SidebarProjectItem } from "@/features/projects/ui/sidebar/projectSidebarShared"

const PROJECT_SIDEBAR_STATE_STORAGE_KEY = "cozea.projectSidebar.state.v1"

export interface PersistedProjectSidebarState {
  expandedProjectIds: string[]
  projectOrderIds: string[]
}

function sortProjectsAlphabetically(projects: SidebarProjectItem[]): SidebarProjectItem[] {
  return [...projects].sort(
    (left, right) =>
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.id.localeCompare(right.id, undefined, { sensitivity: "base" }),
  )
}

function dedupeStringArray(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const next: string[] = []
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    next.push(value)
  }
  return next
}

export function areStringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function readPersistedProjectSidebarState(): PersistedProjectSidebarState {
  if (typeof window === "undefined") {
    return {
      expandedProjectIds: [],
      projectOrderIds: [],
    }
  }

  try {
    const raw = window.localStorage.getItem(PROJECT_SIDEBAR_STATE_STORAGE_KEY)
    if (!raw) {
      return {
        expandedProjectIds: [],
        projectOrderIds: [],
      }
    }

    const parsed = JSON.parse(raw) as Partial<PersistedProjectSidebarState>
    return {
      expandedProjectIds: dedupeStringArray(
        Array.isArray(parsed.expandedProjectIds) ? parsed.expandedProjectIds : [],
      ),
      projectOrderIds: dedupeStringArray(
        Array.isArray(parsed.projectOrderIds) ? parsed.projectOrderIds : [],
      ),
    }
  } catch {
    return {
      expandedProjectIds: [],
      projectOrderIds: [],
    }
  }
}

export function writePersistedProjectSidebarState(
  state: PersistedProjectSidebarState,
): void {
  if (typeof window === "undefined") return

  window.localStorage.setItem(
    PROJECT_SIDEBAR_STATE_STORAGE_KEY,
    JSON.stringify(state),
  )
}

export function clearPersistedProjectSidebarEntry(projectId: string): void {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return

  const state = readPersistedProjectSidebarState()
  const expandedProjectIds = state.expandedProjectIds.filter((id) => id !== normalizedProjectId)
  const projectOrderIds = state.projectOrderIds.filter((id) => id !== normalizedProjectId)
  if (
    areStringArraysEqual(expandedProjectIds, state.expandedProjectIds) &&
    areStringArraysEqual(projectOrderIds, state.projectOrderIds)
  ) {
    return
  }

  writePersistedProjectSidebarState({ expandedProjectIds, projectOrderIds })
}

export function buildOrderedProjects(
  projects: SidebarProjectItem[],
  projectOrderIds: readonly string[],
): SidebarProjectItem[] {
  const projectsById = new Map(projects.map((project) => [project.id, project] as const))
  const orderedProjects: SidebarProjectItem[] = []

  for (const projectId of projectOrderIds) {
    const project = projectsById.get(projectId)
    if (!project) continue
    orderedProjects.push(project)
    projectsById.delete(projectId)
  }

  return [...orderedProjects, ...sortProjectsAlphabetically([...projectsById.values()])]
}
