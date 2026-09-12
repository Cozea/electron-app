/**
 * Starts a live session on the branch the project's folder has checked out.
 *
 * Master Specification: Section 6.1, 6.4
 * Phase: P14
 *
 * The session starts from the folder as it is, uncommitted changes included: once
 * the session exists, the background sync service seeds it from this folder. Using
 * another branch means switching to it first. The session records the folder's Git
 * remote, so invitees without a copy get one when they accept.
 */

import { useEffect, useState } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { appToast } from "@/lib/appToast"
import { useCreateCollaborationSession } from "../hooks/useCreateCollaborationSession"
import { planLiveSessionStart } from "../live/liveSessionModel"
import { describeSessionRepository, normalizeSessionRepositoryUrl } from "@shared/collaboration/repositoryUrl"

type AccessMode = "invite_only" | "organization_available"

export interface StartCollaborationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  projectName: string
  /** The branch the project's folder has checked out; the session follows it. */
  currentBranch: string | null
  /** The branch the session's work is meant to merge into. */
  targetBranch: string
  hasGitRepo: boolean
  /** Files with uncommitted changes in the folder; they join the session as they are. */
  uncommittedFileCount?: number
  repositoryBindingId?: string
  onSessionStarted?: (result: { sessionId: string; publicSessionId: string }) => void
}

export function StartCollaborationDialog({
  isOpen,
  onOpenChange,
  projectId,
  projectName,
  currentBranch,
  targetBranch,
  hasGitRepo,
  uncommittedFileCount = 0,
  repositoryBindingId = "repo_default",
  onSessionStarted,
}: StartCollaborationDialogProps) {
  const [accessMode, setAccessMode] = useState<AccessMode>("invite_only")
  const { stage, error, startCollaboration, reset } = useCreateCollaborationSession()
  const sessions = useQuery(api.collaborationSessions.listByProject, isOpen ? { projectId } : "skip")
  const plan = planLiveSessionStart({ branch: currentBranch, hasGitRepo, sessions })
  const submitting = stage === "creating_session"
  const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null)
  const [shareEnvironmentFiles, setShareEnvironmentFiles] = useState(true)

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void window.electronAPI.workspace
      ?.getActiveForProject(String(projectId))
      .then((workspace) => {
        if (!cancelled) setRepositoryUrl(normalizeSessionRepositoryUrl(workspace?.gitOriginUrl))
      })
      .catch(() => {
        if (!cancelled) setRepositoryUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, projectId])

  const close = (open: boolean) => {
    if (submitting) return
    reset()
    onOpenChange(open)
  }

  const handleStart = async () => {
    if (plan.status !== "ready") return
    try {
      const result = await startCollaboration({
        projectId,
        repositoryBindingId,
        branchName: plan.branch,
        targetBranch,
        accessMode,
        repositoryUrl,
        shareEnvironmentFiles,
      })
      appToast.success({
        title: "Live session started",
        description: `This folder syncs with the session on ${plan.branch}. Invite people from Share.`,
      })
      onSessionStarted?.({ sessionId: result.sessionId, publicSessionId: result.publicSessionId })
      reset()
      onOpenChange(false)
    } catch {
      // The hook shows the error in the dialog.
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Start a live session</DialogTitle>
          <DialogDescription>
            Edit <strong>{projectName}</strong> together in real time. Everyone in the session works on the same
            branch, from their own Mac.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-xs font-medium">Branch</Label>
            <p className="font-mono text-sm">{currentBranch ?? "No branch checked out"}</p>
            <p className="text-[11px] text-muted-foreground">
              The session follows the branch this folder has checked out. To use another branch, switch to it first.
              {currentBranch && targetBranch !== currentBranch ? ` Its work is meant to merge into ${targetBranch}.` : null}
            </p>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Copies for people you invite</Label>
            <p className="text-[11px] text-muted-foreground">
              {repositoryUrl
                ? `Anyone you invite who has no copy of ${projectName} gets one cloned from ${describeSessionRepository(repositoryUrl)}.`
                : "This folder has no https or ssh remote to share, so people you invite need their own copy on this branch."}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={shareEnvironmentFiles}
              onChange={(event) => setShareEnvironmentFiles(event.target.checked)}
              disabled={submitting}
            />
            <span className="space-y-0.5">
              <span className="block">Share .env files</span>
              <span className="block text-[11px] text-muted-foreground">
                Everyone in the session gets the same env files, end-to-end encrypted, and a change anyone makes reaches
                everyone. They never go into Git. Anyone you remove keeps the copies they already have.
              </span>
            </span>
          </label>

          {uncommittedFileCount > 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              Your uncommitted changes to {uncommittedFileCount} {uncommittedFileCount === 1 ? "file are" : "files are"}{" "}
              included: the session starts from this folder as it is now.
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Who can join</legend>
            <div className="flex flex-col gap-1.5 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="accessMode"
                  checked={accessMode === "invite_only"}
                  onChange={() => setAccessMode("invite_only")}
                  disabled={submitting}
                />
                <span>People I invite</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="accessMode"
                  checked={accessMode === "organization_available"}
                  onChange={() => setAccessMode("organization_available")}
                  disabled={submitting}
                />
                <span>Anyone in the project&apos;s organization</span>
              </label>
            </div>
          </fieldset>

          {plan.status === "blocked" ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {plan.reason}
            </p>
          ) : null}

          {error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleStart} disabled={submitting || plan.status !== "ready"}>
            {submitting ? <Spinner size="xs" className="mr-1.5" /> : null}
            {submitting ? "Starting…" : "Start session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
