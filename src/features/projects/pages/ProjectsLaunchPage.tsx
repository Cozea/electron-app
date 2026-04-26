import { useEffect, useState } from "react"
import { Navigate } from "@/lib/router"
import { useQuery } from "convex/react"

import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  buildWorkbenchHref,
  clearLastWorkbenchRoute,
  readLastWorkbenchRoute,
} from "@/features/projects/lib/lastWorkbenchRoute"
import { useTranslation } from "@/lib/i18n"

export function ProjectsLaunchPage() {
  const { convexUserId, user } = useAuth()
  const { t } = useTranslation()
  const workspaceSelectionId = user?.id ?? "local-device"
  const [ignoredWorkspaceSelectionId, setIgnoredWorkspaceSelectionId] = useState<string | null>(null)
  const lastWorkbenchRoute =
    ignoredWorkspaceSelectionId === workspaceSelectionId
      ? null
      : readLastWorkbenchRoute(workspaceSelectionId)

  const restoredProject = useQuery(
    api.projects.getAccessibleById,
    lastWorkbenchRoute?.projectId && convexUserId
      ? {
          projectId: lastWorkbenchRoute.projectId as Id<"projects">,
          userId: convexUserId,
        }
      : "skip",
  )

  const projectsPage = useQuery(
    api.projects.listPageForCurrentUser,
    !lastWorkbenchRoute && convexUserId
      ? {
          userId: convexUserId,
          statusFilter: "all",
          sortBy: "last_modified",
          page: 1,
          pageSize: 1,
        }
      : "skip",
  )

  useEffect(() => {
    if (!workspaceSelectionId || !lastWorkbenchRoute) {
      return
    }
    if (restoredProject !== null) {
      return
    }

    clearLastWorkbenchRoute(workspaceSelectionId)
    setIgnoredWorkspaceSelectionId(workspaceSelectionId)
  }, [lastWorkbenchRoute, restoredProject, workspaceSelectionId])

  if (lastWorkbenchRoute) {
    if (restoredProject) {
      return (
        <Navigate
          to={buildWorkbenchHref(lastWorkbenchRoute.projectId, lastWorkbenchRoute.laneId, {
            focusTileId: lastWorkbenchRoute.focusTileId,
          })}
          replace
        />
      )
    }
  }

  const fallbackProject = projectsPage?.items?.[0] ?? null

  const hasProjects = Boolean(fallbackProject?._id)
  const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac")

  const shortcutRows = [
    {
      label: t("projects.shortcutOpenChat"),
      keys: isMac ? ["⌃", "⌘", "I"] : ["Ctrl", "Alt", "I"],
    },
    {
      label: t("projects.shortcutShowCommands"),
      keys: isMac ? ["⇧", "⌘", "P"] : ["Ctrl", "Shift", "P"],
    },
    {
      label: t("projects.shortcutToggleTerminal"),
      keys: isMac ? ["⌃", "`"] : ["Ctrl", "`"],
    },
  ] as const

  return (
    <div className="flex min-h-full flex-1 items-center justify-center">
      <div className="w-full p-6 md:p-10">
        <Empty className="py-6">
          {hasProjects ? (
            <EmptyHeader>
              <EmptyTitle>{t("projects.selectProject")}</EmptyTitle>
              <EmptyDescription>
                {t("projects.selectProjectDesc")}
              </EmptyDescription>
            </EmptyHeader>
          ) : (
            <EmptyHeader>
              <EmptyTitle>{t("projects.welcomeToCozea")}</EmptyTitle>
              <EmptyDescription>
                {t("projects.createProjectDesc")}
              </EmptyDescription>
            </EmptyHeader>
          )}
          <EmptyContent className="w-full max-w-xs">
            <div className="w-full space-y-2 rounded-lg p-3">
              {shortcutRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{row.label}</span>
                    <KbdGroup className="gap-1">
                      {row.keys.map((key) => (
                        <Kbd
                          key={`${row.label}-${key}`}
                          className="h-6 min-w-6 rounded-md border border-border border-b-[2px] bg-background px-1.5 text-foreground shadow-sm"
                        >
                          {key}
                        </Kbd>
                      ))}
                    </KbdGroup>
                  </div>
                ))}
              </div>
            </EmptyContent>
        </Empty>
      </div>
    </div>
  )
}
