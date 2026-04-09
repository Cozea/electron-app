import type { ComponentType } from "react"

import { AdjustmentsHorizontalIcon as SlidersHorizontal, ArrowsRightLeftIcon as GitBranch, ExclamationTriangleIcon as AlertTriangle } from "@heroicons/react/24/outline"

import type { SidebarActiveSelectionLevel } from "@/features/projects/components/sidebar/projectSidebarShared"

export type ProjectSettingsSectionId = "general" | "source-control" | "danger"

export const PROJECT_SETTINGS_SECTIONS: Array<{
  id: ProjectSettingsSectionId
  label: string
  icon: ComponentType<{ className?: string }>
}> = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "source-control", label: "Source Control", icon: GitBranch },
  { id: "danger", label: "Danger", icon: AlertTriangle },
]

interface ProjectSidebarRouteStateArgs {
  pathname: string
  currentProjectId: string | null
  currentWorkbenchPath: string | null
  currentProjectSettingsBasePath: string | null
  currentVisibleActiveTileId: string | null
}

interface ProjectSidebarRouteState {
  isOnCurrentProjectWorkbench: boolean
  isOnCurrentProjectSubMenu: boolean
  isOnCurrentProjectSettings: boolean
  currentProjectSettingsSection: ProjectSettingsSectionId
  currentSelectionLevel: SidebarActiveSelectionLevel
}

export function getProjectSidebarRouteState({
  pathname,
  currentProjectId,
  currentWorkbenchPath,
  currentProjectSettingsBasePath,
  currentVisibleActiveTileId,
}: ProjectSidebarRouteStateArgs): ProjectSidebarRouteState {
  const isOnCurrentProjectWorkbench = currentWorkbenchPath === pathname
  const isOnCurrentProjectSubMenu = Boolean(currentProjectId) && !isOnCurrentProjectWorkbench
  const isOnCurrentProjectSettings = Boolean(
    currentProjectSettingsBasePath &&
      (pathname === currentProjectSettingsBasePath ||
        pathname.startsWith(`${currentProjectSettingsBasePath}/`)),
  )

  const currentProjectSettingsSection: ProjectSettingsSectionId = (() => {
    if (!isOnCurrentProjectSettings || !currentProjectSettingsBasePath) return "general"
    const suffix = pathname.slice(currentProjectSettingsBasePath.length).replace(/^\/+/, "")
    if (suffix === "source-control") return "source-control"
    if (suffix === "danger") return "danger"
    return "general"
  })()

  const currentSelectionLevel: SidebarActiveSelectionLevel = !currentProjectId
    ? "none"
    : isOnCurrentProjectWorkbench
      ? currentVisibleActiveTileId
        ? "tile"
        : "lane"
      : "project"

  return {
    isOnCurrentProjectWorkbench,
    isOnCurrentProjectSubMenu,
    isOnCurrentProjectSettings,
    currentProjectSettingsSection,
    currentSelectionLevel,
  }
}
