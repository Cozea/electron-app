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

import { useEffect, useRef, useState } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { destinationHref } from "@/lib/destinations"
import { loadGitBranchesCompat } from "@/features/workbench/branch-control/workbenchBranchCompat"
import { appToast } from "@/lib/appToast"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { cn } from "@/lib/utils"
import { useCreateCollaborationSession } from "../hooks/useCreateCollaborationSession"
import { useProjectSessions } from "../hooks/useProjectSessions"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"
import { planLiveSessionStart } from "../live/liveSessionModel"
import {
  normalizeSessionRepositoryUrl,
  remoteCarriesCredentials,
} from "@shared/collaboration/repositoryUrl"

type AccessMode = "invite_only" | "organization_available"

export interface StartCollaborationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  projectName: string
  /** The branch the project's folder has checked out; the session follows it. */
  currentBranch: string | null
  /** Opaque local workspace ID; Electron main resolves its path. */
  sourceWorkspaceId: string | null
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
  sourceWorkspaceId,
  targetBranch,
  hasGitRepo,
  uncommittedFileCount = 0,
  repositoryBindingId = "repo_default",
  onSessionStarted,
}: StartCollaborationDialogProps) {
  const navigate = useViewTransitionNavigate()
  const [accessMode, setAccessMode] = useState<AccessMode>("invite_only")
  const accessModeTouchedRef = useRef(false)
  const prevOpenRef = useRef(false)
  const project = useQuery(api.projects.get, isOpen ? { projectId } : "skip")
  const projectOrganizationId = project?.organizationId ?? null
  // Organization sessions are the default: anyone in the org can join
  // without a per-session invite. Projects outside an organization can only
  // create project-scoped sessions until they are attached to one.
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) accessModeTouchedRef.current = false
    prevOpenRef.current = isOpen
    if (!isOpen || accessModeTouchedRef.current || project === undefined) return
    setAccessMode(projectOrganizationId ? "organization_available" : "invite_only")
  }, [isOpen, project, projectOrganizationId])
  const { stage, error, startCollaboration, reset } = useCreateCollaborationSession()
  const sessions = useProjectSessions(projectId, isOpen)
  const [settingUp, setSettingUp] = useState(false)
  const submitting = stage === "creating_session" || settingUp
  const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null)
  // The remote exactly as the folder has it, to warn about sign-in details in it.
  const [originUrl, setOriginUrl] = useState<string | null>(null)
  const [shareEnvironmentFiles, setShareEnvironmentFiles] = useState(true)
  const [acknowledgeCredentialRemote, setAcknowledgeCredentialRemote] = useState(false)
  const [includeUncommitted, setIncludeUncommitted] = useState(true)
  const [branchMode, setBranchMode] = useState<"existing" | "new">("existing")
  const [existingBranch, setExistingBranch] = useState(currentBranch ?? "")
  const [newBranch, setNewBranch] = useState("")
  const [baseBranch, setBaseBranch] = useState(currentBranch ?? targetBranch)
  const [branches, setBranches] = useState<string[]>(currentBranch ? [currentBranch] : [])
  const [localSetupError, setLocalSetupError] = useState<string | null>(null)
  const [createdSession, setCreatedSession] = useState<{ sessionId: string; publicSessionId: string } | null>(null)
  const selectedBranch = branchMode === "new" ? newBranch.trim() : existingBranch.trim()
  const plan = createdSession
    ? ({ status: "ready", branch: selectedBranch } as const)
    : planLiveSessionStart({ branch: selectedBranch || null, hasGitRepo, sessions })

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const workspaceApi = window.electronAPI.workspace
    if (!workspaceApi) return
    void workspaceApi
      .listForProject(String(projectId))
      .then((workspaces) => {
        if (cancelled) return
        const workspace = workspaces.find((candidate) => candidate.workspaceId === sourceWorkspaceId) ?? null
        setOriginUrl(workspace?.gitOriginUrl ?? null)
        setRepositoryUrl(normalizeSessionRepositoryUrl(workspace?.gitOriginUrl))
      })
      .catch(() => {
        if (cancelled) return
        setOriginUrl(null)
        setRepositoryUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, projectId, sourceWorkspaceId])

  useEffect(() => {
    if (!isOpen) return
    setExistingBranch(currentBranch ?? "")
    setBaseBranch(currentBranch ?? targetBranch)
    setBranchMode("existing")
    setNewBranch("")
    setIncludeUncommitted(true)
    setLocalSetupError(null)
    setCreatedSession(null)
    if (!sourceWorkspaceId) return
    let cancelled = false
    void loadGitBranchesCompat(sourceWorkspaceId).then((result) => {
      if (cancelled || !result.isRepo) return
      const localBranches = Array.from(
        new Set(result.branches.filter((branch) => !branch.isRemote).map((branch) => branch.name)),
      ).sort()
      if (currentBranch && !localBranches.includes(currentBranch)) localBranches.unshift(currentBranch)
      setBranches(localBranches)
      if (!currentBranch && localBranches[0]) {
        setExistingBranch(localBranches[0])
        setBaseBranch(localBranches[0])
      }
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, sourceWorkspaceId, currentBranch, targetBranch])

  const close = (open: boolean) => {
    if (submitting) return
    reset()
    setLocalSetupError(null)
    setCreatedSession(null)
    setAcknowledgeCredentialRemote(false)
    setIncludeUncommitted(true)
    onOpenChange(open)
  }

  const handleStart = async () => {
    if (plan.status !== "ready") return
    setLocalSetupError(null)
    setSettingUp(true)
    try {
      const result =
        createdSession ??
        (await startCollaboration({
          projectId,
          repositoryBindingId,
          branchName: plan.branch,
          targetBranch,
          accessMode,
          repositoryUrl,
          shareEnvironmentFiles,
          includeDirtyChanges: Boolean(uncommittedFileCount > 0 && includeUncommitted),
        }))
      setCreatedSession({ sessionId: String(result.sessionId), publicSessionId: result.publicSessionId })

      const ensured = await window.electronAPI.projectd.workbenches.ensureSession({
        projectId: String(projectId),
        publicSessionId: result.publicSessionId,
        branchName: plan.branch,
        baseBranch: branchMode === "new" ? baseBranch : plan.branch,
        createBranch: branchMode === "new",
        title: `${projectName} · ${plan.branch}`,
        sourceRepoUrl: repositoryUrl,
        sourceWorkspaceId,
        includeDirtyChanges: Boolean(uncommittedFileCount > 0 && includeUncommitted),
        setActive: true,
      })
      if (!ensured.success) throw new Error(ensured.error)

      invalidateProjectWorkspaceResolution(String(projectId))
      appToast.success({
        title: "Live session started",
        description: `The Session Workbench for ${plan.branch} is ready. Invite people from Share.`,
      })
      onSessionStarted?.({ sessionId: String(result.sessionId), publicSessionId: result.publicSessionId })
      reset()
      onOpenChange(false)
      navigate(destinationHref({ to: "workbench", projectId: String(projectId) }), {
        state: buildProjectRouteNavigationState({
          projectId: String(projectId),
          projectName,
          preferredWorkspaceId: ensured.workspace.workspaceId,
        }),
      })
    } catch (caught) {
      setLocalSetupError(caught instanceof Error ? caught.message : "Could not prepare the Session Workbench.")
    } finally {
      setSettingUp(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Start live session</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Collaborate in real time on <strong className="text-foreground">{projectName}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Branch Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground">Session branch</Label>
              <div className="flex rounded-md bg-muted/60 p-0.5 text-xs">
                <button
                  type="button"
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium transition-all cursor-pointer",
                    branchMode === "existing"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setBranchMode("existing")}
                  disabled={submitting || createdSession !== null}
                >
                  Existing
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded-sm px-2.5 py-1 font-medium transition-all cursor-pointer",
                    branchMode === "new"
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setBranchMode("new")}
                  disabled={submitting || createdSession !== null}
                >
                  New branch
                </button>
              </div>
            </div>

            {branchMode === "existing" ? (
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm focus:ring-1 focus:ring-ring"
                value={existingBranch}
                onChange={(event) => setExistingBranch(event.target.value)}
                disabled={submitting || createdSession !== null}
              >
                {branches.length === 0 ? <option value="">No local branches found</option> : null}
                {branches.map((branch) => (
                  <option key={branch} value={branch}>{branch}</option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={newBranch}
                  onChange={(event) => setNewBranch(event.target.value)}
                  placeholder="feature/branch"
                  className="h-9 font-mono text-sm"
                  disabled={submitting || createdSession !== null}
                />
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 font-mono text-sm"
                  value={baseBranch}
                  onChange={(event) => setBaseBranch(event.target.value)}
                  disabled={submitting || createdSession !== null}
                  aria-label="Base branch"
                >
                  {branches.map((branch) => (
                    <option key={branch} value={branch}>{`from ${branch}`}</option>
                  ))}
                </select>
              </div>
            )}
            {selectedBranch && targetBranch !== selectedBranch ? (
              <p className="text-xs text-muted-foreground">
                Merges into <span className="font-mono text-foreground">{targetBranch}</span>
              </p>
            ) : null}
          </div>

          {/* Access Mode */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium text-foreground">Who can join</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-all cursor-pointer",
                  accessMode === "invite_only"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70",
                )}
                onClick={() => {
                  accessModeTouchedRef.current = true
                  setAccessMode("invite_only")
                }}
                disabled={submitting}
              >
                <span className="font-medium text-foreground text-sm">Project</span>
                <span className="text-xs text-muted-foreground">Anyone on this project</span>
              </button>
              <button
                type="button"
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left text-sm transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                  accessMode === "organization_available"
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                    : "border-border/60 bg-card/40 text-muted-foreground hover:bg-card/70",
                )}
                onClick={() => {
                  accessModeTouchedRef.current = true
                  setAccessMode("organization_available")
                }}
                disabled={submitting || !projectOrganizationId}
                title={
                  projectOrganizationId
                    ? undefined
                    : "Attach this project to an organization first (Project Settings → Organization)"
                }
              >
                <span className="font-medium text-foreground text-sm">Organization</span>
                <span className="text-xs text-muted-foreground">Anyone in project org</span>
              </button>
            </div>
            {project !== undefined && !projectOrganizationId ? (
              <p className="text-xs text-muted-foreground">
                This project isn&apos;t in an organization yet, so new sessions stay limited to this project.
                Attach it to an organization in Project Settings to open sessions to the whole organization.
              </p>
            ) : null}
          </div>

          {/* Options */}
          <div className="space-y-2.5 rounded-lg border border-border/60 bg-card/40 p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <Checkbox
                checked={shareEnvironmentFiles}
                onCheckedChange={(checked) => setShareEnvironmentFiles(checked === true)}
                disabled={submitting}
              />
              <div className="space-y-0.5">
                <span className="font-medium text-foreground text-sm">Share environment files (.env)</span>
                <span className="block text-xs text-muted-foreground">
                  End-to-end encrypted across session members.
                </span>
              </div>
            </label>

            {uncommittedFileCount > 0 ? (
              <label className="flex cursor-pointer items-start gap-2.5 border-t border-border/40 pt-2.5 text-sm">
                <Checkbox
                  checked={includeUncommitted}
                  onCheckedChange={(checked) => setIncludeUncommitted(checked === true)}
                  disabled={submitting || createdSession !== null}
                />
                <div className="space-y-0.5">
                  <span className="font-medium text-foreground text-sm">
                    Include uncommitted changes ({uncommittedFileCount} {uncommittedFileCount === 1 ? "file" : "files"})
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Copies your working files into the session workbench.
                  </span>
                </div>
              </label>
            ) : null}
          </div>

          {repositoryUrl && remoteCarriesCredentials(originUrl) ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={acknowledgeCredentialRemote}
                onChange={(event) => setAcknowledgeCredentialRemote(event.target.checked)}
                disabled={submitting}
              />
              <span>
                This Git remote contains credentials that will be shared with session members so their Git can clone it.
              </span>
            </label>
          ) : null}

          {plan.status === "blocked" ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {plan.reason}
            </p>
          ) : null}

          {error || localSetupError ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {localSetupError ?? error}
              {createdSession && localSetupError ? " The cloud session already exists; Retry setup will reuse it." : null}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => close(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleStart}
            disabled={
              submitting ||
              plan.status !== "ready" ||
              Boolean(repositoryUrl && remoteCarriesCredentials(originUrl) && !acknowledgeCredentialRemote)
            }
          >
            {submitting ? <Spinner size="xs" className="mr-1.5" /> : null}
            {submitting ? "Starting…" : createdSession ? "Retry setup" : "Start session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
