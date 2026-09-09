import type { Doc } from "../../../../../../../convex/_generated/dataModel"
import type {
  ProjectLaneDescriptor,
  ProjectLaneState,
} from "@shared/electronApiTypes"

import type { ProjectOpenGitProjectLike } from "@/features/projects/lib/projectOpenTypes"
import { isProjectDevAppLogoDataUrl } from "@/features/devapps/projectDevAppLogo"
import { resolveProjectRecordedDefaultBranch } from "@/lib/git/projectRepositoryIntegration"
import { cn } from "@/lib/utils"
import type { WorkbenchLaneSidebarSummary } from "@/lib/workbenchStore"

/** Use on `<button>`/rows; pair with `SIDEBAR_PILL_ACTIVE_CLASS` when selected */
export const SIDEBAR_PILL_HOVER_CLASS =
  "transition-colors hover:bg-[var(--sidebar-pill-hover-bg)] hover:text-[var(--sidebar-pill-hover-fg)]"

export const SIDEBAR_PILL_BASE_CLASS =
  `${SIDEBAR_PILL_HOVER_CLASS} rounded-md px-2 text-sm font-medium`

export const SIDEBAR_PILL_ACTIVE_CLASS =
  "bg-[var(--sidebar-pill-hover-bg)] text-[var(--sidebar-pill-hover-fg)]"

/** Section titles (Projects, Workspace, …) — one style everywhere */
export const SIDEBAR_GROUP_LABEL_CLASS =
  "px-2 text-sm font-medium text-muted-foreground/60"

/**
 * Primary nav row: same height, gap, label + icon color rules as `SidebarMenuButton variant="pill"`.
 * Inactive: label `text-sidebar-foreground/70`, icons `muted-foreground/75`. Active: pill fg via `SIDEBAR_PILL_ACTIVE_CLASS`.
 */
export const SIDEBAR_NAV_ROW_LAYOUT_CLASS = "flex h-7 min-h-7 w-full items-center gap-2 text-left"
export const SIDEBAR_NAV_ROW_TEXT_CLASS =
  "text-sm font-medium text-sidebar-foreground/80 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground/75"

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
  "flex h-7 min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-sidebar-foreground",
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
  sourceControl: Doc<"projects">["sourceControl"]
  gitRepository: Doc<"projects">["gitRepository"]
  organizationId?: string | null
}

export type SidebarActiveSelectionLevel = "none" | "project" | "lane" | "tile"

export interface SidebarProjectTreeItemSelection {
  isExpanded: boolean
  activeSelectionLevel: SidebarActiveSelectionLevel
  activeTileId: string | null
}

export type SidebarDevAppPublicationState = "unpublished" | "published" | "publishing"

export type SidebarDevAppPublishMode = "publish" | "update"

export interface SidebarDevAppMenuState {
  devAppPublicationState: SidebarDevAppPublicationState
  devAppPublishingMode: SidebarDevAppPublishMode | null
  canPublishDevApp: boolean
}

export interface SidebarDevAppMenuAction {
  label: "Publish" | "Publishing…" | "Update" | "Updating…"
  mode: SidebarDevAppPublishMode
  enabled: boolean
}

export interface SidebarProjectTreeItemContext {
  isCurrentProject: boolean
  currentWorkspaceId: string | null
  isSyncingProject: boolean
  devAppPublicationState: SidebarDevAppPublicationState
  devAppPublishingMode: SidebarDevAppPublishMode | null
  canPublishDevApp: boolean
  prefetchedLaneState?: ProjectLaneState | null
  prefetchedActiveLane?: ProjectLaneDescriptor | null
}

export interface SidebarProjectTreeItemActions {
  toggleExpanded: (projectId: string) => void
  openProject: (project: SidebarProjectItem, workspaceId: string | null) => Promise<void>
  relinkProjectWorkspace: (project: SidebarProjectItem, workspaceId: string | null) => Promise<void>
  closeProjectWorkspace: (project: SidebarProjectItem, workspaceId: string | null) => Promise<void>
  openProjectFolder: (project: SidebarProjectItem, workspaceId: string | null) => Promise<void>
  openProjectSettings: (project: SidebarProjectItem) => void
  publishDevApp: (
    project: SidebarProjectItem,
    workspaceId: string | null,
    mode: SidebarDevAppPublishMode,
  ) => Promise<void>
  renameProject: (project: SidebarProjectItem) => void
  archiveProject: (project: SidebarProjectItem) => Promise<void>
  restoreProject: (project: SidebarProjectItem) => Promise<void>
  deleteProject: (project: SidebarProjectItem) => void
  syncProject: (project: SidebarProjectItem) => Promise<void>
  moveProject: (projectId: string, direction: "up" | "down") => void
  reorderProject?: (
    sourceProjectId: string,
    targetProjectId: string,
    position: "before" | "after",
  ) => void
  openLaneWorkbench: (
    project: SidebarProjectItem,
    laneId: string,
    options?: {
      openTile?: "assistantChat" | "devServer" | "terminal"
      focusTileId?: string
      workspaceId?: string | null
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

export function resolveSidebarDevAppMenuAction({
  devAppPublicationState,
  devAppPublishingMode,
  canPublishDevApp,
}: SidebarDevAppMenuState): SidebarDevAppMenuAction {
  if (devAppPublicationState === "publishing") {
    const mode = devAppPublishingMode ?? "publish"
    return {
      label: mode === "update" ? "Updating…" : "Publishing…",
      mode,
      enabled: false,
    }
  }

  const mode = devAppPublicationState === "published" ? "update" : "publish"
  return {
    label: mode === "update" ? "Update" : "Publish",
    mode,
    enabled: canPublishDevApp,
  }
}

export function canReuseProjectDevAppLogo(
  mode: SidebarDevAppPublishMode,
  logoDataUrl: unknown,
): logoDataUrl is string {
  return mode === "update" && isProjectDevAppLogoDataUrl(logoDataUrl)
}

export function hasProjectSidebarChildren(
  activeLaneSummary: WorkbenchLaneSidebarSummary | null,
  hasHeadlessDevServer: boolean,
): boolean {
  return Boolean(
    hasHeadlessDevServer ||
      activeLaneSummary?.agents.length ||
      activeLaneSummary?.surfaces.length,
  )
}

/**
 * Controls that own their own click inside a sidebar row: the expand chevron,
 * the options menu, and anything interactive added to a row later. Kept as one
 * list so a new control is covered without revisiting each row's click handler.
 */
export const SIDEBAR_ROW_INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button'], [role='menuitem']"

/**
 * Whether a click inside a sidebar row landed on a control that handles the
 * click itself, rather than on the row background.
 *
 * Rows are clickable as a pointer affordance, so the row handler must not also
 * fire when the chevron expands or the menu opens. Testing the event target is
 * more durable than relying on every control to stop propagation, which the
 * options menu never did.
 */
export function isSidebarRowInteractiveTarget(
  target: Pick<Element, "closest"> | null | undefined,
): boolean {
  return Boolean(target?.closest(SIDEBAR_ROW_INTERACTIVE_SELECTOR))
}

/**
 * Null when the project records no default branch, so lane resolution learns it
 * from the repo rather than assuming "main" and stranding tiles in a branch lane.
 */
export function resolveProjectCollabBranch(project: SidebarProjectItem): string | null {
  return resolveProjectRecordedDefaultBranch(project)
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
    left.importedFrom?.provider === right.importedFrom?.provider &&
    left.importedFrom?.repoFullName === right.importedFrom?.repoFullName &&
    left.importedFrom?.branch === right.importedFrom?.branch &&
    left.sourceControl === right.sourceControl &&
    left.gitRepository === right.gitRepository &&
    left.organizationId === right.organizationId
  )
}
