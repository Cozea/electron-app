/**
 * Session Hub Dialog.
 *
 * Primary modal accessed when clicking the collaboration avatar stack in the header.
 * Houses the Session Work & Call Dashboard alongside invite & access controls.
 */

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  FolderGitIcon,
  GitBranchIcon,
  Share01Icon,
} from "@hugeicons/core-free-icons"

import { useQuery } from "convex/react"
import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
  onStartSession?: () => void
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
  onStartSession,
}: SessionHubDialogProps) {
  const { principalId } = useAuth()
  const projectMembers = useQuery(
    api.projectMembers.listMembers,
    projectId && principalId ? { projectId, viewerPrincipalId: principalId } : "skip",
  )
  const [activeTab, setActiveTab] = useState<"dashboard" | "share">("dashboard")

  const metrics = useSessionMetrics({
    session,
    members: liveSession.members,
    autoGit: liveSession.autoGit,
    workspaceId,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader className="space-y-2">
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2 min-w-0">
              <DialogTitle className="text-base truncate">
                Session Hub · {session.branchName}
              </DialogTitle>
              <Badge variant="outline" className="text-2xs font-normal border-emerald-500/30 text-emerald-500 bg-emerald-500/10 shrink-0">
                LIVE
              </Badge>
            </div>
          </div>

          <DialogDescription className="text-sm text-muted-foreground">
            {projectName ? `${projectName} · ` : ""}Active for {metrics.sessionDurationFormatted} · {metrics.totalOperations} edit operations batched
          </DialogDescription>

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
              <span>Work & Call Dashboard</span>
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
              <span>Share & Invites</span>
            </button>
          </div>
        </DialogHeader>

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
              onStartSession={onStartSession ?? (() => {})}
            />
          </div>
        ) : null}

        {/* Action Footer */}
        <DialogFooter className="flex items-center justify-between border-t border-border/60 pt-3 sm:justify-between">
          <div className="flex items-center gap-2">
            {liveSession.autoGit?.canSave ? (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-sm gap-1.5"
                onClick={() => void liveSession.saveNow()}
              >
                <HugeiconsIcon icon={FolderGitIcon} className="size-3.5 text-muted-foreground" />
                <span>Save to Git now</span>
              </Button>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40"
              onClick={() => {
                onOpenChange(false)
                liveSession.leave()
              }}
            >
              Leave session
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
