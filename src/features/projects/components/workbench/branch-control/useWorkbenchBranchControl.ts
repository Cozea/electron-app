import { useConvex } from "convex/react"
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import type { GitBranch as NativeGitBranch, GitStatusResult } from "@cozea/assistant-contracts"

import { dedupeRemoteBranchesWithLocalMatches, deriveLocalBranchNameFromRemoteRef } from "@/lib/git/projectBranchToolbar"
import {
  buildPullRequestUrl,
  resolveProjectLaneGitContext,
  type ResolvedProjectLaneGitContext,
} from "@/lib/git/projectLaneContext"
import type { ProjectGitRuntimeProjectLike } from "@/lib/git/projectGitRuntime"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"

import {
  buildLaneId,
  buildWorkbenchBranchMenuItems,
  parseWorkbenchBranchMenuBranchIndex,
  parseWorkbenchBranchMenuLaneId,
  showWorkbenchBranchNativeMenu,
  toToolbarGitStatus,
  type GitToolbarSnapshot,
  type LaneAction,
  WB_BRANCH_MENU,
} from "./workbenchBranchControlShared"
import {
  checkoutGitBranchCompat,
  createGitWorktreeCompat,
  loadGitBranchesCompat,
  switchToLane,
} from "./workbenchBranchCompat"

interface UseWorkbenchBranchControlInput {
  project: ProjectGitRuntimeProjectLike | null
  projectId: string | null
  projectPath: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  userId?: Id<"users"> | null
  onLaneStateChange?: () => void
}

export function useWorkbenchBranchControl(input: UseWorkbenchBranchControlInput) {
  const convex = useConvex()
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [activeAction, setActiveAction] = useState<LaneAction | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
  const [branches, setBranches] = useState<NativeGitBranch[]>([])
  const [currentGitBranch, setCurrentGitBranch] = useState<string | null>(null)
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)

  const branchCwd = input.activeLane?.projectPath ?? input.projectPath
  const displayedBranch =
    input.activeLane?.branch ?? currentGitBranch ?? input.collabBranch
  const rememberedPersonalLanes = useMemo(
    () =>
      (input.laneState?.lanes ?? []).filter(
        (lane) => !lane.isCollab && lane.id !== input.activeLane?.id,
      ),
    [input.activeLane?.id, input.laneState?.lanes],
  )

  const loadGitToolbarSnapshot = useCallback(async (): Promise<GitToolbarSnapshot | null> => {
    if (!branchCwd) {
      return {
        isRepo: false,
        branches: [],
        currentGitBranch: null,
        gitStatus: null,
        loadError: null,
      }
    }

    try {
      const [branchResult, statusResult] = await Promise.all([
        loadGitBranchesCompat(branchCwd),
        window.electronAPI.sync.gitStatus({ projectPath: branchCwd }),
      ])

      const nextIsRepo = Boolean(branchResult.isRepo || statusResult.isRepo)
      let loadError: string | null = null
      if (branchResult.error) {
        loadError = branchResult.error
      } else if (statusResult.success === false && nextIsRepo && statusResult.error) {
        loadError = statusResult.error
      }

      return {
        isRepo: nextIsRepo,
        branches: [...dedupeRemoteBranchesWithLocalMatches(branchResult.branches)],
        currentGitBranch:
          statusResult.currentBranch ??
          branchResult.branches.find((branch) => branch.current)?.name ??
          null,
        gitStatus: toToolbarGitStatus(statusResult),
        loadError,
      }
    } catch (error) {
      console.error("[Workbench] Failed to load branch toolbar state", error)
      return {
        isRepo: false,
        branches: [],
        currentGitBranch: null,
        gitStatus: null,
        loadError:
          error instanceof Error ? error.message : "Failed to inspect the local git repository.",
      }
    }
  }, [branchCwd])

  const applyGitToolbarSnapshot = useCallback((snapshot: GitToolbarSnapshot) => {
    setBranches(snapshot.branches)
    setCurrentGitBranch(snapshot.currentGitBranch)
    setGitStatus(snapshot.gitStatus)
    setLastError(snapshot.loadError)
  }, [])

  const refreshGitState = useCallback(async () => {
    if (!branchCwd) {
      setBranches([])
      setCurrentGitBranch(null)
      setGitStatus(null)
      setLastError(null)
      return
    }

    setIsLoading(true)
    setLastError(null)

    try {
      const snapshot = await loadGitToolbarSnapshot()
      if (!snapshot) return
      applyGitToolbarSnapshot(snapshot)
    } finally {
      setIsLoading(false)
    }
  }, [applyGitToolbarSnapshot, branchCwd, loadGitToolbarSnapshot])

  useEffect(() => {
    void refreshGitState()
  }, [refreshGitState])

  const resolveLaneContext = useCallback(async (): Promise<ResolvedProjectLaneGitContext> => {
    if (!input.projectId || !input.projectPath) {
      throw new Error("Local project checkout is not available on this device.")
    }

    return resolveProjectLaneGitContext({
      convex,
      project: input.project,
      projectId: input.projectId,
      projectPath: input.projectPath,
      collabBranch: input.collabBranch,
      activeLane: input.activeLane,
      userId: input.userId,
    })
  }, [
    convex,
    input.activeLane,
    input.collabBranch,
    input.project,
    input.projectId,
    input.projectPath,
    input.userId,
  ])

  const handleBranchSelect = useCallback(
    async (branch: NativeGitBranch) => {
      if (!input.projectId || !input.projectPath || !branchCwd || isSwitching) return

      const selectedBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      const selectedExistingWorktreePath =
        branch.worktreePath && branch.worktreePath !== input.projectPath
          ? branch.worktreePath
          : null

      setIsSwitching(true)
      setLastError(null)

      try {
        if (selectedBranchName === input.collabBranch && !selectedExistingWorktreePath) {
          await switchToLane(input.projectId, "collab")
        } else if (selectedExistingWorktreePath) {
          const laneId = buildLaneId(selectedBranchName)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId: input.projectId,
            laneId,
            branch: selectedBranchName,
            name: selectedBranchName,
            projectPath: selectedExistingWorktreePath,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to remember existing lane")
          }
          await switchToLane(input.projectId, laneId)
        } else if (input.activeLane?.isCollab) {
          const worktreeResult = await createGitWorktreeCompat({
            projectPath: input.projectPath,
            branch: branch.name,
            ...(branch.isRemote ? { newBranch: selectedBranchName } : {}),
            path: null,
          })
          if (!worktreeResult.success || !worktreeResult.worktree) {
            throw new Error(worktreeResult.error || "Failed to create personal lane")
          }
          const laneId = buildLaneId(worktreeResult.worktree.branch)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId: input.projectId,
            laneId,
            branch: worktreeResult.worktree.branch,
            name: worktreeResult.worktree.branch,
            projectPath: worktreeResult.worktree.path,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to create personal lane")
          }
          await switchToLane(input.projectId, laneId)
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
          const laneId = input.activeLane?.id ?? buildLaneId(nextBranchName)
          const upsertResult = await window.electronAPI.project.upsertLane({
            projectId: input.projectId,
            laneId,
            branch: nextBranchName,
            name: nextBranchName,
            projectPath: branchCwd,
          })
          if (!upsertResult.success) {
            throw new Error(upsertResult.error || "Failed to update active personal lane")
          }
          await switchToLane(input.projectId, laneId)
        }

        await refreshGitState()
        await input.onLaneStateChange?.()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to switch personal lane"
        setLastError(message)
        console.error("[Workbench] Failed to switch branch lane", error)
      } finally {
        setIsSwitching(false)
      }
    },
    [
      branchCwd,
      input.activeLane,
      input.collabBranch,
      input.onLaneStateChange,
      input.projectId,
      input.projectPath,
      isSwitching,
      refreshGitState,
    ],
  )

  const handleCreatePersonalLane = useCallback(async () => {
    if (!input.projectId || !input.projectPath || isSwitching) return

    const rawBranchName = window.prompt("New personal lane branch name")
    const nextBranchName = rawBranchName?.trim() ?? ""
    if (!nextBranchName) return

    if (nextBranchName === input.collabBranch) {
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

      if (existingBranch?.worktreePath && existingBranch.worktreePath !== input.projectPath) {
        const laneId = buildLaneId(nextBranchName)
        const upsertResult = await window.electronAPI.project.upsertLane({
          projectId: input.projectId,
          laneId,
          branch: nextBranchName,
          name: nextBranchName,
          projectPath: existingBranch.worktreePath,
        })
        if (!upsertResult.success) {
          throw new Error(upsertResult.error || "Failed to remember existing personal lane")
        }
        await switchToLane(input.projectId, laneId)
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
          projectId: input.projectId,
          laneId,
          branch: worktreeResult.worktree.branch,
          name: worktreeResult.worktree.branch,
          projectPath: worktreeResult.worktree.path,
        })
        if (!upsertResult.success) {
          throw new Error(upsertResult.error || "Failed to create personal lane")
        }
        await switchToLane(input.projectId, laneId)
      }

      await refreshGitState()
      await input.onLaneStateChange?.()
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
    input.collabBranch,
    input.onLaneStateChange,
    input.projectId,
    input.projectPath,
    isSwitching,
    refreshGitState,
    resolveLaneContext,
  ])

  const handleLaneAction = useCallback(
    async (action: LaneAction) => {
      if (!input.projectId) return

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
        await input.onLaneStateChange?.()
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to run lane action"
        setLastError(message)
        console.error("[Workbench] Lane action failed", { action, error })
      } finally {
        setActiveAction(null)
      }
    },
    [gitStatus?.pr?.url, input.onLaneStateChange, input.projectId, refreshGitState, resolveLaneContext],
  )

  const handleOpenNativeBranchMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      if (!branchCwd) return

      event.preventDefault()
      event.stopPropagation()

      const rect = event.currentTarget.getBoundingClientRect()
      const menuPosition = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.bottom + 4),
      }

      const priorPanelError = lastError
      setLastError(null)
      const snapshot = await loadGitToolbarSnapshot()

      if (!snapshot) return
      applyGitToolbarSnapshot(snapshot)

      const menuItems = buildWorkbenchBranchMenuItems({
        snapshot,
        activeLane: input.activeLane,
        collabBranch: input.collabBranch,
        projectPath: input.projectPath,
        rememberedPersonalLanes,
        laneActionsLocked: activeAction !== null,
        newLaneDisabled: isSwitching || activeAction !== null,
        priorPanelError,
      })

      const action = await showWorkbenchBranchNativeMenu(menuPosition, menuItems)
      if (!action || !input.projectId) return

      const laneIdFromMenu = parseWorkbenchBranchMenuLaneId(action)
      if (laneIdFromMenu) {
        void (async () => {
          try {
            await switchToLane(input.projectId!, laneIdFromMenu)
            await input.onLaneStateChange?.()
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to activate saved lane"
            setLastError(message)
          }
        })()
        return
      }

      if (action === WB_BRANCH_MENU.switchCollab) {
        void (async () => {
          try {
            await switchToLane(input.projectId!, "collab")
            await input.onLaneStateChange?.()
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to switch to collab lane"
            setLastError(message)
          }
        })()
        return
      }

      if (action === WB_BRANCH_MENU.newPersonalLane) {
        void handleCreatePersonalLane()
        return
      }

      if (action === WB_BRANCH_MENU.pull) {
        void handleLaneAction("pull")
        return
      }
      if (action === WB_BRANCH_MENU.push) {
        void handleLaneAction("push")
        return
      }
      if (action === WB_BRANCH_MENU.updateFromCollab) {
        void handleLaneAction("updateFromCollab")
        return
      }
      if (action === WB_BRANCH_MENU.mergeIntoCollab) {
        void handleLaneAction("mergeIntoCollab")
        return
      }
      if (action === WB_BRANCH_MENU.openPr) {
        void handleLaneAction("openPullRequest")
        return
      }

      const branchIndex = parseWorkbenchBranchMenuBranchIndex(action)
      if (branchIndex !== null) {
        const branch = snapshot.branches[branchIndex]
        if (branch) {
          void handleBranchSelect(branch)
        }
      }
    },
    [
      activeAction,
      applyGitToolbarSnapshot,
      branchCwd,
      handleBranchSelect,
      handleCreatePersonalLane,
      handleLaneAction,
      input.activeLane,
      input.collabBranch,
      input.onLaneStateChange,
      input.projectId,
      input.projectPath,
      isSwitching,
      lastError,
      loadGitToolbarSnapshot,
      rememberedPersonalLanes,
    ],
  )

  const chromeLabel = useMemo(() => {
    if (!displayedBranch) return "Select branch"
    return displayedBranch
  }, [displayedBranch])

  return {
    branchCwd,
    chromeLabel,
    isBusy: isLoading || isSwitching || activeAction !== null,
    showActionSpinner: isSwitching || activeAction !== null,
    handleOpenNativeBranchMenu,
  }
}
