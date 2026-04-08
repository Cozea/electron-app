import type { Doc } from "../../../../../convex/_generated/dataModel"
import type {
  ProjectLaneDescriptor,
  ProjectLaneState,
} from "@shared/electronApiTypes"

import type { ProjectOpenGitProjectLike } from "@/features/projects/lib/projectOpenGitSync"

export const SIDEBAR_PILL_BASE_CLASS =
  "rounded-md px-2 text-xs transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"
export const SIDEBAR_PILL_ACTIVE_CLASS =
  "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]"

export interface SidebarProjectItem extends ProjectOpenGitProjectLike {
  id: string
  name: string
  status: string
  template?: string | null
  slug: string
  updatedAt: number
  localPath: string | null
  sourceControl: Doc<"projects">["sourceControl"]
  gitRepository: Doc<"projects">["gitRepository"]
}

export type SidebarActiveSelectionLevel = "none" | "project" | "lane" | "tile"

export interface SidebarProjectTreeItemSelection {
  isExpanded: boolean
  activeSelectionLevel: SidebarActiveSelectionLevel
  activeTileId: string | null
}

export interface SidebarProjectTreeItemContext {
  isCurrentProject: boolean
  currentProjectPath: string | null
  isSyncingProject: boolean
  prefetchedLaneState?: ProjectLaneState | null
  prefetchedActiveLane?: ProjectLaneDescriptor | null
}

export interface SidebarProjectTreeItemActions {
  toggleExpanded: (projectId: string) => void
  openProject: (project: SidebarProjectItem, localPath: string | null) => Promise<void>
  openProjectFolder: (project: SidebarProjectItem, localPath: string | null) => Promise<void>
  openProjectSettings: (project: SidebarProjectItem) => void
  renameProject: (project: SidebarProjectItem) => void
  archiveProject: (project: SidebarProjectItem) => Promise<void>
  restoreProject: (project: SidebarProjectItem) => Promise<void>
  deleteProject: (project: SidebarProjectItem) => void
  syncProject: (project: SidebarProjectItem) => Promise<void>
  moveProject: (projectId: string, direction: "up" | "down") => void
  openLaneWorkbench: (
    project: SidebarProjectItem,
    laneId: string,
    options?: {
      openTile?: "assistantChat" | "terminal"
      focusTileId?: string
    },
  ) => Promise<void>
}

export interface SidebarProjectTreeItemProps {
  project: SidebarProjectItem
  projectIndex: number
  projectCount: number
  selection: SidebarProjectTreeItemSelection
  context: SidebarProjectTreeItemContext
  actions: SidebarProjectTreeItemActions
}

export function resolveProjectCollabBranch(project: SidebarProjectItem): string {
  return (
    project.sourceControl?.activeCollabBranch ??
    project.sourceControl?.defaultBranch ??
    project.gitRepository?.defaultBranch ??
    "main"
  )
}

export function areSidebarProjectItemsEqual(
  left: SidebarProjectItem,
  right: SidebarProjectItem,
): boolean {
  return (
    left.id === right.id &&
    left._id === right._id &&
    left.name === right.name &&
    left.status === right.status &&
    left.template === right.template &&
    left.slug === right.slug &&
    left.updatedAt === right.updatedAt &&
    left.organizationId === right.organizationId &&
    left.createdBy === right.createdBy &&
    left.syncMode === right.syncMode &&
    left.localPath === right.localPath &&
    left.sourceControl === right.sourceControl &&
    left.gitRepository === right.gitRepository
  )
}
