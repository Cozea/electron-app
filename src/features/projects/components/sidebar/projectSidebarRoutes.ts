import type { ComponentType } from "react"
import type { SidebarActiveSelectionLevel } from "@/features/projects/components/sidebar/projectSidebarShared"

import { Alert01Icon as __AlertTriangleHugeIcon, AlignHorizontalCenterIcon as __SlidersHorizontalHugeIcon, ArrowLeftRightIcon as __GitBranchHugeIcon } from '@hugeicons/core-free-icons'

import { asHugeIcon } from '@/lib/icons/asHugeIcon'
const SlidersHorizontal = asHugeIcon(__SlidersHorizontalHugeIcon)
const GitBranch = asHugeIcon(__GitBranchHugeIcon)
const AlertTriangle = asHugeIcon(__AlertTriangleHugeIcon)
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

