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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { loadGitBranchesCompat } from "@/features/workbench/branch-control/workbenchBranchCompat"
import { appToast } from "@/lib/appToast"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useCreateCollaborationSession } from "../hooks/useCreateCollaborationSession"
import { planLiveSessionStart } from "../live/liveSessionModel"
import {
  describeSessionRepository,
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
  const { stage, error, startCollaboration, reset } = useCreateCollaborationSession()
  const sessions = useQuery(api.collaborationSessions.listByProject, isOpen ? { projectId } : "skip")
  const [settingUp, setSettingUp] = useState(false)
  const submitting = stage === "creating_session" || settingUp
  const [repositoryUrl, setRepositoryUrl] = useState<string | null>(null)
  // The remote exactly as the folder has it, to warn about sign-in details in it.
  const [originUrl, setOriginUrl] = useState<string | null>(null)
  const [shareEnvironmentFiles, setShareEnvironmentFiles] = useState(true)
  const [acknowledgeCredentialRemote, setAcknowledgeCredentialRemote] = useState(false)
  const [acknowledgeDirtyPublish, setAcknowledgeDirtyPublish] = useState(false)
  const [dirtyMode, setDirtyMode] = useState<"include" | "exclude">("include")
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
    setDirtyMode("include")
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
    setAcknowledgeDirtyPublish(false)
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
          includeDirtyChanges: dirtyMode === "include",
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
        includeDirtyChanges: dirtyMode === "include",
        setActive: true,
      })
      if (!ensured.success) throw new Error(ensured.error)

      appToast.success({
        title: "Live session started",
        description: `The Session Workbench for ${plan.branch} is ready. Invite people from Share.`,
      })
      onSessionStarted?.({ sessionId: String(result.sessionId), publicSessionId: result.publicSessionId })
      reset()
      onOpenChange(false)
      navigate(buildProjectPath(String(projectId), "workbench"), {
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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Start a live session</DialogTitle>
          <DialogDescription>
            Edit <strong>{projectName}</strong> together in real time. Everyone in the session works on the same
            branch, from their own Mac.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">Session branch</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="branchMode"
                  checked={branchMode === "existing"}
                  onChange={() => setBranchMode("existing")}
                  disabled={submitting || createdSession !== null}
                />
                Existing branch
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="branchMode"
                  checked={branchMode === "new"}
                  onChange={() => setBranchMode("new")}
                  disabled={submitting || createdSession !== null}
                />
                New branch
              </label>
            </div>

            {branchMode === "existing" ? (
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
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
                  placeholder="feature/collab"
                  className="font-mono"
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
            <p className="text-[11px] text-muted-foreground">
              Cozea prepares this branch in a dedicated Session Workbench. Your current project folder stays on
              {currentBranch ? ` ${currentBranch}` : " its current Git state"}.
              {selectedBranch && targetBranch !== selectedBranch ? ` Session work will merge into ${targetBranch}.` : null}
            </p>
          </fieldset>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Copies for people you invite</Label>
            <p className="text-[11px] text-muted-foreground">
              {repositoryUrl
                ? `Anyone you invite who has no copy of ${projectName} gets one cloned from ${describeSessionRepository(repositoryUrl)}.`
                : "This folder has no https or ssh remote to share, so people you invite need their own copy on this branch."}
            </p>
            {repositoryUrl && remoteCarriesCredentials(originUrl) ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={acknowledgeCredentialRemote}
                  onChange={(event) => setAcknowledgeCredentialRemote(event.target.checked)}
                  disabled={submitting}
                />
                <span>
                  This Git remote contains sign-in details. Starting the session shares that configured remote with
                  invited members so their Git can clone it. I understand those details will be shared.
                </span>
              </label>
            ) : null}
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
                everyone. Git keeps them out of commits as your .gitignore says; while one isn&apos;t ignored, saving to
                Git waits and the session bar offers to add it. Anyone you remove keeps the copies they already have.
              </span>
            </span>
          </label>

          {uncommittedFileCount > 0 ? (
            <fieldset className="space-y-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              <legend className="px-1 text-xs font-medium text-foreground">Existing uncommitted work</legend>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="dirtyMode"
                  className="mt-0.5"
                  checked={dirtyMode === "include"}
                  onChange={() => setDirtyMode("include")}
                  disabled={submitting || createdSession !== null}
                />
                <span>Include the current working files in the Session Workbench.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="dirtyMode"
                  className="mt-0.5"
                  checked={dirtyMode === "exclude"}
                  onChange={() => {
                    setDirtyMode("exclude")
                    setAcknowledgeDirtyPublish(false)
                  }}
                  disabled={submitting || createdSession !== null}
                />
                <span>Exclude them. The Session Workbench starts from Git; this folder is left untouched.</span>
              </label>
              {dirtyMode === "include" ? (
                <label className="flex cursor-pointer items-start gap-2 border-t border-border/60 pt-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acknowledgeDirtyPublish}
                    onChange={(event) => setAcknowledgeDirtyPublish(event.target.checked)}
                    disabled={submitting}
                  />
                  <span>
                    Include my uncommitted changes to {uncommittedFileCount}{" "}
                    {uncommittedFileCount === 1 ? "file" : "files"}. I understand AutoGit can publish them to {selectedBranch || "the session branch"}.
                  </span>
                </label>
              ) : null}
            </fieldset>
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

          {error || localSetupError ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {localSetupError ?? error}
              {createdSession && localSetupError ? " The cloud session already exists; Retry setup will reuse it." : null}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleStart}
            disabled={
              submitting ||
              plan.status !== "ready" ||
              (uncommittedFileCount > 0 && dirtyMode === "include" && !acknowledgeDirtyPublish) ||
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
