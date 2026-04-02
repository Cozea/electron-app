import { useConvex } from "convex/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { Id } from "../../../../../convex/_generated/dataModel"
import type { GitBranch as NativeGitBranch, GitStatusResult } from "@cozea/assistant-contracts"
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronDown,
  ExternalLink,
  GitBranch,
  GitFork,
  GitPullRequest,
  Loader2,
  Plus,
  RefreshCcw,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { readNativeApi } from "@/lib/nativeApi"
import {
  dedupeRemoteBranchesWithLocalMatches,
  deriveLocalBranchNameFromRemoteRef,
} from "@/lib/git/projectBranchToolbar"
import {
  buildPullRequestUrl,
  resolveProjectLaneGitContext,
  type ResolvedProjectLaneGitContext,
} from "@/lib/git/projectLaneContext"
import type { ProjectGitRuntimeProjectLike } from "@/lib/git/projectGitRuntime"
import { cn } from "@/lib/utils"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"

interface WorkbenchHeaderBranchControlProps {
  project: ProjectGitRuntimeProjectLike | null
  projectId: string | null
  projectPath: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  userId?: Id<"users"> | null
  onLaneStateChange?: () => void
  triggerClassName?: string
}

type LaneAction =
  | "pull"
  | "push"
  | "updateFromCollab"
  | "mergeIntoCollab"
  | "openPullRequest"

function buildLaneId(branch: string): string {
  const sanitized = branch
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `lane:${sanitized || "branch"}`
}

function getStatusSummary(status: GitStatusResult | null): string | null {
  if (!status) return null

  const parts: string[] = []

  if (status.behindCount > 0) {
    parts.push(`${status.behindCount} behind`)
  }
  if (status.aheadCount > 0) {
    parts.push(`${status.aheadCount} ahead`)
  }
  if (status.pr?.number) {
    parts.push(`PR #${status.pr.number}`)
  }
  if (status.hasWorkingTreeChanges) {
    parts.push("local changes")
  }

  return parts.length > 0 ? parts.join(" · ") : "Up to date"
}

function toToolbarGitStatus(
  status: Awaited<ReturnType<typeof window.electronAPI.sync.gitStatus>>,
): GitStatusResult | null {
  if (!status.success || !status.isRepo) {
    return null
  }

  return {
    branch: status.currentBranch ?? null,
    hasWorkingTreeChanges: !Boolean(status.clean),
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: Boolean(status.upstreamBranch),
    aheadCount: status.ahead ?? 0,
    behindCount: status.behind ?? 0,
    pr: null,
  }
}

async function loadGitBranchesCompat(projectPath: string): Promise<{
  isRepo: boolean
  hasOriginRemote: boolean
  branches: NativeGitBranch[]
  error?: string
}> {
  const listGitBranches = window.electronAPI.project.listGitBranches
  if (typeof listGitBranches === "function") {
    try {
      return await listGitBranches({ projectPath })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          isRepo: false,
          hasOriginRemote: false,
          branches: [],
          error: error instanceof Error ? error.message : "Failed to list local branches.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.listBranches) {
    try {
      const result = await api.git.listBranches({ cwd: projectPath })
      return {
        isRepo: result.isRepo,
        hasOriginRemote: result.hasOriginRemote,
        branches: [...result.branches],
      }
    } catch (error) {
      return {
        isRepo: false,
        hasOriginRemote: false,
        branches: [],
        error: error instanceof Error ? error.message : "Failed to list local branches.",
      }
    }
  }

  return {
    isRepo: false,
    hasOriginRemote: false,
    branches: [],
    error: "Git branch controls need a full app restart to load the latest desktop bridge.",
  }
}

async function checkoutGitBranchCompat(projectPath: string, branch: string): Promise<{
  success: boolean
  branch?: string
  error?: string
}> {
  const checkoutGitBranch = window.electronAPI.project.checkoutGitBranch
  if (typeof checkoutGitBranch === "function") {
    try {
      return await checkoutGitBranch({ projectPath, branch })
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to switch branches.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.checkout) {
    try {
      await api.git.checkout({ cwd: projectPath, branch })
      const status = await api.git.status({ cwd: projectPath }).catch(() => null)
      return {
        success: true,
        branch: status?.branch ?? branch,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to switch branches.",
      }
    }
  }

  return {
    success: false,
    error: "Git branch switching needs a full app restart to load the latest desktop bridge.",
  }
}

async function createGitWorktreeCompat(input: {
  projectPath: string
  branch: string
  newBranch?: string
  path?: string | null
}): Promise<{
  success: boolean
  worktree?: {
    path: string
    branch: string
  }
  error?: string
}> {
  const createGitWorktree = window.electronAPI.project.createGitWorktree
  if (typeof createGitWorktree === "function") {
    try {
      return await createGitWorktree(input)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.toLowerCase().includes("no handler registered")
      ) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create personal lane.",
        }
      }
    }
  }

  const api = readNativeApi()
  if (api?.git?.createWorktree) {
    try {
      const result = await api.git.createWorktree({
        cwd: input.projectPath,
        branch: input.branch,
        newBranch: input.newBranch,
        path: input.path ?? null,
      })
      return {
        success: true,
        worktree: result.worktree,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create personal lane.",
      }
    }
  }

  return {
    success: false,
    error: "Git worktree creation needs a full app restart to load the latest desktop bridge.",
  }
}

async function switchToLane(projectId: string, laneId: string): Promise<void> {
  const result = await window.electronAPI.project.setActiveLane({
    projectId,
    laneId,
  })
  if (!result.success) {
    throw new Error(result.error || "Failed to activate lane")
  }
}

export function WorkbenchHeaderBranchControl({
  project,
  projectId,
  projectPath,
  collabBranch,
  laneState,
  activeLane,
  userId,
  onLaneStateChange,
  triggerClassName,
}: WorkbenchHeaderBranchControlProps) {
  const convex = useConvex()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [activeAction, setActiveAction] = useState<LaneAction | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [isRepo, setIsRepo] = useState(false)
  const [branches, setBranches] = useState<NativeGitBranch[]>([])
  const [currentGitBranch, setCurrentGitBranch] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)

  const branchCwd = activeLane?.projectPath ?? projectPath
  const displayedBranch = activeLane?.branch ?? currentGitBranch ?? collabBranch
  const rememberedPersonalLanes = useMemo(
    () =>
      (laneState?.lanes ?? []).filter(
        (lane) => !lane.isCollab && lane.id !== activeLane?.id,
      ),
    [activeLane?.id, laneState?.lanes],
  )

  const refreshGitState = useCallback(async () => {
    if (!branchCwd) {
      setIsRepo(false)
      setBranches([])
      setCurrentGitBranch(null)
      setGitStatus(null)
      return
    }

    setIsLoading(true)
    setLastError(null)

    try {
      const [branchResult, statusResult] = await Promise.all([
        loadGitBranchesCompat(branchCwd),
        window.electronAPI.sync.gitStatus({ projectPath: branchCwd }),
      ])

      const nextIsRepo = Boolean(branchResult.isRepo || statusResult.isRepo)
      setIsRepo(nextIsRepo)
      setBranches([...dedupeRemoteBranchesWithLocalMatches(branchResult.branches)])
      setGitStatus(toToolbarGitStatus(statusResult))
      setCurrentGitBranch(
        statusResult.currentBranch ??
          branchResult.branches.find((branch) => branch.current)?.name ??
          null,
      )

      if (branchResult.error) {
        setLastError(branchResult.error)
      } else if (statusResult.success === false && nextIsRepo && statusResult.error) {
        setLastError(statusResult.error)
      }
    } catch (error) {
      console.error("[Workbench] Failed to load branch toolbar state", error)
      setIsRepo(false)
      setBranches([])
      setCurrentGitBranch(null)
      setGitStatus(null)
      setLastError(
        error instanceof Error ? error.message : "Failed to inspect the local git repository.",
      )
    } finally {
      setIsLoading(false)
    }
  }, [branchCwd])

  useEffect(() => {
    void refreshGitState()
  }, [refreshGitState])

  useEffect(() => {
    if (!isOpen) return
    void refreshGitState()
  }, [isOpen, refreshGitState])

  const resolveLaneContext = useCallback(async (): Promise<ResolvedProjectLaneGitContext> => {
    if (!projectId || !projectPath) {
      throw new Error("Local project checkout is not available on this device.")
    }

    return resolveProjectLaneGitContext({
      convex,
      project,
      projectId,
      projectPath,
      collabBranch,
      activeLane,
      userId,
    })
  }, [activeLane, collabBranch, convex, project, projectId, projectPath, userId])

  const handleBranchSelect = useCallback(
    async (branch: NativeGitBranch) => {
      if (!projectId || !projectPath || !branchCwd || isSwitching) return

      const selectedBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      const selectedExistingWorktreePath =
        branch.worktreePath && branch.worktreePath !== projectPath ? branch.worktreePath : null

      setIsSwitching(true)
      setLastError(null)

      try {
        if (selectedBranchName === collabBranch && !selectedExistingWorktreePath) {
          await switchToLane(projectId, "collab")
        } else if (selectedExistingWorktreePath) {
          const laneId = buildLaneId(selectedBranchName)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId,
            laneId,
            branch: selectedBranchName,
            name: selectedBranchName,
            projectPath: selectedExistingWorktreePath,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to remember existing lane")
          }
          await switchToLane(projectId, laneId)
        } else if (activeLane?.isCollab) {
          const worktreeResult = await createGitWorktreeCompat({
            projectPath,
            branch: branch.name,
            ...(branch.isRemote ? { newBranch: selectedBranchName } : {}),
            path: null,
          })
          if (!worktreeResult.success || !worktreeResult.worktree) {
            throw new Error(worktreeResult.error || "Failed to create personal lane")
          }
          const laneId = buildLaneId(worktreeResult.worktree.branch)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId,
            laneId,
            branch: worktreeResult.worktree.branch,
            name: worktreeResult.worktree.branch,
            projectPath: worktreeResult.worktree.path,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to create personal lane")
          }
          await switchToLane(projectId, laneId)
        } else {
          const checkoutResult = await checkoutGitBranchCompat(branchCwd, branch.name)
          if (!checkoutResult.success) {
            throw new Error(checkoutResult.error || "Failed to switch branches")
          }

          const statusResult = await window.electronAPI.sync
            .gitStatus({ projectPath: branchCwd })
            .catch(() => null)
          const nextBranchName =
            statusResult?.currentBranch ?? checkoutResult.branch ?? selectedBranchName
          const laneId = activeLane?.id ?? buildLaneId(nextBranchName)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId,
            laneId,
            branch: nextBranchName,
            name: nextBranchName,
            projectPath: branchCwd,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to update active personal lane")
          }
          await switchToLane(projectId, laneId)
        }

        await refreshGitState()
        await onLaneStateChange?.()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to switch personal lane"
        setLastError(message)
        console.error("[Workbench] Failed to switch branch lane", error)
      } finally {
        setIsSwitching(false)
        setIsOpen(false)
      }
    },
    [
      activeLane,
      branchCwd,
      collabBranch,
      isSwitching,
      onLaneStateChange,
      projectId,
      projectPath,
      refreshGitState,
    ],
  )

  const handleCreatePersonalLane = useCallback(async () => {
    if (!projectId || !projectPath || isSwitching) return

    const rawBranchName = window.prompt("New personal lane branch name")
    const nextBranchName = rawBranchName?.trim() ?? ""
    if (!nextBranchName) return

    if (nextBranchName === collabBranch) {
      setLastError("Personal lane branch must differ from the collab branch.")
      return
    }

    setIsSwitching(true)
    setLastError(null)

    try {
      const existingBranch = branches.find((branch) => {
        const comparableName = branch.isRemote
          ? deriveLocalBranchNameFromRemoteRef(branch.name)
          : branch.name
        return comparableName === nextBranchName
      })

      if (existingBranch?.worktreePath && existingBranch.worktreePath !== projectPath) {
        const laneId = buildLaneId(nextBranchName)
        const upsertResult = await window.electronAPI.project.upsertLane({
          projectId,
          laneId,
          branch: nextBranchName,
          name: nextBranchName,
          projectPath: existingBranch.worktreePath,
        })
        if (!upsertResult.success) {
          throw new Error(upsertResult.error || "Failed to remember existing personal lane")
        }
        await switchToLane(projectId, laneId)
      } else {
        const context = await resolveLaneContext()
        const worktreeResult = await createGitWorktreeCompat({
          projectPath: context.collabLanePath,
          branch:
            existingBranch?.name && !existingBranch.isRemote
              ? existingBranch.name
              : context.collabBranch,
          ...(existingBranch?.name && !existingBranch.isRemote
            ? {}
            : { newBranch: nextBranchName }),
          path: null,
        })
        if (!worktreeResult.success || !worktreeResult.worktree) {
          throw new Error(worktreeResult.error || "Failed to create personal lane")
        }

        const laneId = buildLaneId(worktreeResult.worktree.branch)
        const upsertResult = await window.electronAPI.project.upsertLane({
          projectId,
          laneId,
          branch: worktreeResult.worktree.branch,
          name: worktreeResult.worktree.branch,
          projectPath: worktreeResult.worktree.path,
        })
        if (!upsertResult.success) {
          throw new Error(upsertResult.error || "Failed to create personal lane")
        }
        await switchToLane(projectId, laneId)
      }

      await refreshGitState()
      await onLaneStateChange?.()
      setIsOpen(false)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to create personal lane"
      setLastError(message)
      console.error("[Workbench] Failed to create personal lane", error)
    } finally {
      setIsSwitching(false)
    }
  }, [
    branches,
    collabBranch,
    isSwitching,
    onLaneStateChange,
    projectId,
    projectPath,
    refreshGitState,
    resolveLaneContext,
  ])

  const handleLaneAction = useCallback(
    async (action: LaneAction) => {
      if (!projectId) return

      setActiveAction(action)
      setLastError(null)

      try {
        const context = await resolveLaneContext()

        switch (action) {
          case "pull": {
            const pullResult = await window.electronAPI.sync.gitPullMain({
              projectPath: context.lanePath,
              branch: context.laneBranch,
              repoUrl: context.remoteConfig.repoUrl,
              strategy: "merge",
              provider: context.remoteConfig.provider,
              accessToken: context.remoteConfig.accessToken,
            })
            if (!pullResult.success) {
              throw new Error(pullResult.error || "Failed to pull the active lane")
            }
            if (pullResult.hadConflicts) {
              throw new Error("Resolve merge conflicts before continuing.")
            }
            break
          }
          case "push": {
            const pushResult = await window.electronAPI.sync.gitPushMain({
              projectPath: context.lanePath,
              branch: context.laneBranch,
              repoUrl: context.remoteConfig.repoUrl,
              provider: context.remoteConfig.provider,
              accessToken: context.remoteConfig.accessToken,
            })
            if (!pushResult.success) {
              throw new Error(pushResult.error || "Failed to push the active lane")
            }
            break
          }
          case "updateFromCollab": {
            if (context.laneIsCollab || context.laneBranch === context.collabBranch) {
              break
            }
            const pullResult = await window.electronAPI.sync.gitPullMain({
              projectPath: context.lanePath,
              branch: context.collabBranch,
              repoUrl: context.remoteConfig.repoUrl,
              strategy: "merge",
              provider: context.remoteConfig.provider,
              accessToken: context.remoteConfig.accessToken,
            })
            if (!pullResult.success) {
              throw new Error(pullResult.error || "Failed to merge the collab branch into this lane")
            }
            if (pullResult.hadConflicts) {
              throw new Error("Resolve merge conflicts before continuing.")
            }
            break
          }
          case "mergeIntoCollab": {
            if (context.laneIsCollab || context.laneBranch === context.collabBranch) {
              break
            }

            const updateCollabResult = await window.electronAPI.sync.gitPullMain({
              projectPath: context.collabLanePath,
              branch: context.collabBranch,
              repoUrl: context.remoteConfig.repoUrl,
              strategy: "merge",
              provider: context.remoteConfig.provider,
              accessToken: context.remoteConfig.accessToken,
            })
            if (!updateCollabResult.success) {
              throw new Error(
                updateCollabResult.error || "Failed to update the collab lane before merge",
              )
            }
            if (updateCollabResult.hadConflicts) {
              throw new Error("Resolve collab-lane conflicts before merging into collab.")
            }

            const mergeResult = await window.electronAPI.project.mergeLaneIntoCollab({
              collabProjectPath: context.collabLanePath,
              collabBranch: context.collabBranch,
              sourceBranch: context.laneBranch,
            })
            if (!mergeResult.success) {
              throw new Error(mergeResult.error || "Failed to merge lane into collab")
            }

            const pushResult = await window.electronAPI.sync.gitPushMain({
              projectPath: context.collabLanePath,
              branch: context.collabBranch,
              repoUrl: context.remoteConfig.repoUrl,
              provider: context.remoteConfig.provider,
              accessToken: context.remoteConfig.accessToken,
            })
            if (!pushResult.success) {
              throw new Error(pushResult.error || "Failed to publish merged collab branch")
            }
            break
          }
          case "openPullRequest": {
            const prUrl =
              gitStatus?.pr?.url ??
              buildPullRequestUrl({
                repoUrl: context.remoteConfig.repoUrl,
                provider: context.remoteConfig.provider,
                baseBranch: context.collabBranch,
                headBranch: context.laneBranch,
              })
            if (!prUrl) {
              throw new Error("Pull request URL is unavailable for this repository.")
            }
            await window.electronAPI.shell.openExternal(prUrl)
            break
          }
          default:
            break
        }

        await refreshGitState()
        await onLaneStateChange?.()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to run lane action"
        setLastError(message)
        console.error("[Workbench] Lane action failed", { action, error })
      } finally {
        setActiveAction(null)
      }
    },
    [gitStatus?.pr?.url, onLaneStateChange, projectId, refreshGitState, resolveLaneContext],
  )

  const chromeLabel = useMemo(() => {
    if (!displayedBranch) return "Select branch"
    return displayedBranch
  }, [displayedBranch])

  const statusSummary = useMemo(() => getStatusSummary(gitStatus), [gitStatus])
  const isBusy = isLoading || isSwitching || activeAction !== null
  const actionLabel =
    activeLane?.isCollab === false && chromeLabel !== collabBranch
      ? `Target ${collabBranch}`
      : "Collab lane"

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-full border border-border/60 bg-secondary/70 px-2 text-xs font-medium text-muted-foreground shadow-none hover:bg-secondary",
            triggerClassName,
          )}
          disabled={!branchCwd}
        >
          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span className="max-w-[160px] truncate">{chromeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-72">
        <DropdownMenuLabel>{activeLane?.isCollab ? "Collab Lane" : "Personal Lane"}</DropdownMenuLabel>
        <div className="px-2 pb-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">{actionLabel}</div>
          {statusSummary ? <div className="pt-1">{statusSummary}</div> : null}
        </div>
        {!branchCwd || !isRepo ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-3 text-sm text-muted-foreground">
              {branchCwd ? "No git repository detected." : "Local project path is not ready yet."}
            </div>
          </>
        ) : (
          <>
            <DropdownMenuSeparator />
            {!activeLane?.isCollab ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  if (!projectId) return
                  void (async () => {
                    try {
                      await switchToLane(projectId, "collab")
                      await onLaneStateChange?.()
                      setIsOpen(false)
                    } catch (error) {
                      const message =
                        error instanceof Error ? error.message : "Failed to switch to collab lane"
                      setLastError(message)
                    }
                  })()
                }}
              >
                <GitBranch className="mr-2 h-3.5 w-3.5" />
                Switch To Collab Lane
              </DropdownMenuItem>
            ) : null}
            {rememberedPersonalLanes.map((lane) => (
              <DropdownMenuItem
                key={lane.id}
                onSelect={(event) => {
                  event.preventDefault()
                  if (!projectId) return
                  void (async () => {
                    try {
                      await switchToLane(projectId, lane.id)
                      await onLaneStateChange?.()
                      setIsOpen(false)
                    } catch (error) {
                      const message =
                        error instanceof Error ? error.message : "Failed to activate saved lane"
                      setLastError(message)
                    }
                  })()
                }}
              >
                <GitFork className="mr-2 h-3.5 w-3.5" />
                <span className="truncate">{lane.branch}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleCreatePersonalLane()
              }}
              disabled={isBusy}
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              New Personal Lane
            </DropdownMenuItem>
            {rememberedPersonalLanes.length > 0 || !activeLane?.isCollab ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleLaneAction("pull")
              }}
              disabled={activeAction !== null}
            >
              <ArrowDownToLine className="mr-2 h-3.5 w-3.5" />
              Pull Active Lane
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleLaneAction("push")
              }}
              disabled={activeAction !== null}
            >
              <ArrowUpToLine className="mr-2 h-3.5 w-3.5" />
              Push Active Lane
            </DropdownMenuItem>
            {!activeLane?.isCollab && chromeLabel !== collabBranch ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  void handleLaneAction("updateFromCollab")
                }}
                disabled={activeAction !== null}
              >
                <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                Merge Collab Into Lane
              </DropdownMenuItem>
            ) : null}
            {!activeLane?.isCollab ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  void handleLaneAction("mergeIntoCollab")
                }}
                disabled={activeAction !== null}
              >
                <GitBranch className="mr-2 h-3.5 w-3.5" />
                Merge Lane Into Collab
              </DropdownMenuItem>
            ) : null}
            {!activeLane?.isCollab ? (
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  void handleLaneAction("openPullRequest")
                }}
                disabled={activeAction !== null}
              >
                {gitStatus?.pr?.url ? (
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                ) : (
                  <GitPullRequest className="mr-2 h-3.5 w-3.5" />
                )}
                {gitStatus?.pr?.url ? "Open Current PR" : "Start Pull Request"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Branches</DropdownMenuLabel>
            <div className="max-h-80 overflow-y-auto">
              {branches.length === 0 ? (
                <div className="px-2 py-3 text-sm text-muted-foreground">
                  No branches available.
                </div>
              ) : (
                branches.map((branch) => {
                  const nextBranchName = branch.isRemote
                    ? deriveLocalBranchNameFromRemoteRef(branch.name)
                    : branch.name
                  const isActive = nextBranchName === chromeLabel
                  const isCollabTarget = nextBranchName === collabBranch

                  return (
                    <DropdownMenuItem
                      key={branch.name}
                      className="flex items-center justify-between gap-3"
                      onSelect={(event) => {
                        event.preventDefault()
                        void handleBranchSelect(branch)
                      }}
                    >
                      <span className="min-w-0 truncate">{branch.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {isCollabTarget ? (
                          <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">
                            collab
                          </span>
                        ) : null}
                        {branch.worktreePath && branch.worktreePath !== projectPath ? (
                          <GitFork className="h-3.5 w-3.5 text-muted-foreground/70" />
                        ) : null}
                        <Check
                          className={cn(
                            "h-3.5 w-3.5 text-foreground/80",
                            isActive ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </span>
                    </DropdownMenuItem>
                  )
                })
              )}
            </div>
          </>
        )}
        {lastError ? (
          <>
            <DropdownMenuSeparator />
            <div className="px-2 py-2 text-xs text-destructive">{lastError}</div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
