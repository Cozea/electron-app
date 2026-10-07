/**
 * Session Hub Dialog.
 *
 * Primary modal accessed when clicking the collaboration avatar stack in the header.
 * Houses the Session Work & Call Dashboard alongside invite & access controls.
 */

import { useState } from "react"
import { useTranslation } from "@/lib/i18n"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  FolderGitIcon,
  GitBranchIcon,
  Share01Icon,
} from "@hugeicons/core-free-icons"

import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useProjectTeam } from "@/hooks/useProjectTeam"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { UnifiedModal } from "@/components/ui/unified-modal"
import { cn } from "@/lib/utils"
import type { LiveSessionRecord, LiveSessionContext } from "../live/useLiveSession"
import { useSessionMetrics } from "../live/useSessionMetrics"
import { LiveSessionShareSection } from "./LiveSessionShareSection"
import { SessionWorkDashboard } from "./SessionWorkDashboard"

export interface SessionHubDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: LiveSessionRecord
  liveSession: LiveSessionContext
  projectId: Id<"projects">
  projectName?: string | null
  workspaceId?: string | null
  canManage: boolean
}

export function SessionHubDialog({
  open,
  onOpenChange,
  session,
  liveSession,
  projectId,
  projectName,
  workspaceId,
  canManage,
}: SessionHubDialogProps) {
  const { t } = useTranslation()
  const { members: projectMembers } = useProjectTeam(projectId)
  const [activeTab, setActiveTab] = useState<"dashboard" | "share">("dashboard")

  const metrics = useSessionMetrics({
    session,
    members: liveSession.members,
    autoGit: liveSession.autoGit,
    workspaceId,
  })

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Session Hub · ${session.branchName}`}
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="flex items-center gap-2">
            {liveSession.autoGit?.canSave ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-sm gap-1.5"
                onClick={() => void liveSession.saveNow()}
              >
                <HugeiconsIcon icon={FolderGitIcon} className="size-3.5 text-muted-foreground" />
                <span>{t("collab.saveToGitNow")}</span>
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {/* The only plain way out: the modal has no close button, and
                without this one "Leave session" read as the exit. */}
            <Button variant="ghost" size="sm" className="h-8 text-sm" onClick={() => onOpenChange(false)}>
              {t("collab.close")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40"
              onClick={() => {
                onOpenChange(false)
                liveSession.leave()
              }}
            >
              {t("collab.leaveSession")}
            </Button>
            {canManage ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-sm gap-1.5"
                disabled={liveSession.busyAction !== null}
                onClick={() => {
                  onOpenChange(false)
                  liveSession.end()
                }}
              >
                {liveSession.busyAction === "end" ? <Spinner size="xs" /> : null}
                End session
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {projectName ? `${projectName} · ` : ""}Active for {metrics.sessionDurationFormatted} · {metrics.totalOperations} edit operations batched
        </p>

        {/* Segmented Tab Navigation */}
        <div className="flex items-center gap-1 rounded-md bg-muted/60 p-1 w-full pt-0.5">
          <button
            type="button"
            className={cn(
              "flex-1 px-3 py-1.5 rounded-sm text-sm font-medium transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer",
              activeTab === "dashboard"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("dashboard")}
          >
            <HugeiconsIcon icon={GitBranchIcon} className="size-4" />
            <span>{t("collab.workCallDashboard")}</span>
          </button>
          <button
            type="button"
            className={cn(
              "flex-1 px-3 py-1.5 rounded-sm text-sm font-medium transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer",
              activeTab === "share"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setActiveTab("share")}
          >
            <HugeiconsIcon icon={Share01Icon} className="size-4" />
            <span>{t("collab.shareInvites")}</span>
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto">
          {/* Tab 1: Work & Call Dashboard */}
          {activeTab === "dashboard" ? (
            <div className="py-2">
              <SessionWorkDashboard
                session={session}
                metrics={metrics}
                media={liveSession.media ?? undefined}
                canManage={canManage}
              />
            </div>
          ) : null}

          {/* Tab 2: Share & Invites */}
          {activeTab === "share" ? (
            <div className="py-2 space-y-4">
              <LiveSessionShareSection
                projectId={projectId}
                projectMembers={projectMembers}
                canManageProject={canManage}
              />
            </div>
          ) : null}
        </div>
      </div>
    </UnifiedModal>
  )
}
