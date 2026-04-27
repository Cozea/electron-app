import type { Doc } from "../../../../../convex/_generated/dataModel"
import type {
  ProjectLaneDescriptor,
  ProjectLaneState,
} from "@shared/electronApiTypes"

import type { ProjectOpenGitProjectLike } from "@/features/projects/lib/projectOpenTypes"
import { resolveProjectSharedBranch } from "@/lib/git/projectRepositoryIntegration"
import { cn } from "@/lib/utils"

/** Use on `<button>`/rows; pair with `SIDEBAR_PILL_ACTIVE_CLASS` when selected */
export const SIDEBAR_PILL_HOVER_CLASS =
  "transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"

export const SIDEBAR_PILL_BASE_CLASS =
  `${SIDEBAR_PILL_HOVER_CLASS} rounded-md px-2 text-xs font-normal`

export const SIDEBAR_PILL_ACTIVE_CLASS =
  "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]"

/** Section titles (Projects, Workspace, …) — one style everywhere */
export const SIDEBAR_GROUP_LABEL_CLASS =
  "px-2 text-[14px] font-normal tracking-[-0.01em] text-muted-foreground/70"

/**
 * Primary nav row: same height, gap, label + icon color rules as `SidebarMenuButton variant="pill"`.
 * Inactive: label `text-sidebar-foreground/70`, icons `muted-foreground/75`. Active: pill fg via `SIDEBAR_PILL_ACTIVE_CLASS`.
 */
export const SIDEBAR_NAV_ROW_LAYOUT_CLASS = "flex h-7 min-h-7 w-full items-center gap-2 text-left"
export const SIDEBAR_NAV_ROW_TEXT_CLASS =
  "text-xs font-normal text-sidebar-foreground/70 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-muted-foreground/75"

export const SIDEBAR_NAV_ROW_BUTTON_CLASS = cn(
  SIDEBAR_PILL_BASE_CLASS,
  SIDEBAR_NAV_ROW_LAYOUT_CLASS,
  SIDEBAR_NAV_ROW_TEXT_CLASS,
)

/** Settings sheet drawer: same pill hover/active as project list + focus ring + label truncation */
export const SETTINGS_DRAWER_NAV_ROW_CLASS = cn(
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  "overflow-hidden outline-hidden ring-sidebar-ring focus-visible:ring-2 [&>span:last-child]:truncate",
)

/**
 * Workbench tile row: full-width hover/active pill (`px-2` matches project row).
 * Indent labels/icons with `SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS` inside the button.
 */
export const SIDEBAR_PILL_NESTED_ROW_CLASS = cn(
  SIDEBAR_PILL_HOVER_CLASS,
  "flex h-7 min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-normal text-sidebar-foreground/70",
)

/** Indented block inside a nested row (icon + primary label) — pill stays full width */
export const SIDEBAR_WORKBENCH_ROW_CONTENT_CLASS = "flex min-w-0 flex-1 items-center gap-2 ps-6"

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
  relinkProjectWorkspace: (project: SidebarProjectItem, localPath: string | null) => Promise<void>
  closeProjectWorkspace: (project: SidebarProjectItem, localPath: string | null) => Promise<void>
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
      projectPath?: string | null
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
  return resolveProjectSharedBranch(project)
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
    left.createdBy === right.createdBy &&
    left.localPath === right.localPath &&
    left.importedFrom?.provider === right.importedFrom?.provider &&
    left.importedFrom?.repoFullName === right.importedFrom?.repoFullName &&
    left.importedFrom?.branch === right.importedFrom?.branch &&
    left.sourceControl === right.sourceControl &&
    left.gitRepository === right.gitRepository
  )
}
