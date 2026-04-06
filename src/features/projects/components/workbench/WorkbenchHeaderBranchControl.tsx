import { useConvex } from "convex/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import type { MouseEvent } from "react"
import type { Id } from "../../../../../convex/_generated/dataModel"
import type {
  ContextMenuItem,
  GitBranch as NativeGitBranch,
  GitStatusResult,
} from "@cozea/assistant-contracts"
import { ChevronDown, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
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

const WB_BRANCH_MENU = {
  switchCollab: "workbench-branch:switch-collab",
  newPersonalLane: "workbench-branch:new-personal-lane",
  pull: "workbench-branch:pull",
  push: "workbench-branch:push",
  updateFromCollab: "workbench-branch:update-from-collab",
  mergeIntoCollab: "workbench-branch:merge-into-collab",
  openPr: "workbench-branch:open-pr",
  lane: (laneId: string) => `workbench-branch:lane#${encodeURIComponent(laneId)}`,
  branch: (index: number) => `workbench-branch:branch#${index}`,
} as const

interface GitToolbarSnapshot {
  isRepo: boolean
  branches: NativeGitBranch[]
  currentGitBranch: string | null
  gitStatus: GitStatusResult | null
  loadError: string | null
}

function parseWorkbenchBranchMenuLaneId(action: string): string | null {
  const prefix = "workbench-branch:lane#"
  if (!action.startsWith(prefix)) return null
  try {
    return decodeURIComponent(action.slice(prefix.length))
  } catch {
    return null
  }
}

function parseWorkbenchBranchMenuBranchIndex(action: string): number | null {
  const prefix = "workbench-branch:branch#"
  if (!action.startsWith(prefix)) return null
  const index = Number.parseInt(action.slice(prefix.length), 10)
  return Number.isFinite(index) ? index : null
}

async function showWorkbenchBranchNativeMenu(
  position: { x: number; y: number },
  items: readonly ContextMenuItem<string>[],
): Promise<string | null> {
  if (items.length === 0) return null

  if (window.desktopBridge?.showContextMenu) {
    return window.desktopBridge.showContextMenu(items, position)
  }
  if (window.nativeApi?.contextMenu?.show) {
    return window.nativeApi.contextMenu.show(items, position)
  }
  return null
}

function buildWorkbenchBranchMenuItems(input: {
  snapshot: GitToolbarSnapshot
  activeLane: ProjectLaneDescriptor | null
  collabBranch: string
  projectPath: string | null
  rememberedPersonalLanes: ProjectLaneDescriptor[]
  laneActionsLocked: boolean
  newLaneDisabled: boolean
  /** Shown when git snapshot has no loadError (e.g. prior lane merge failure). */
  priorPanelError?: string | null
}): ContextMenuItem<string>[] {
  const {
    snapshot,
    activeLane,
    collabBranch,
    projectPath,
    rememberedPersonalLanes,
    laneActionsLocked,
    newLaneDisabled,
    priorPanelError,
  } = input

  const footerMessage = snapshot.loadError ?? priorPanelError ?? null

  const displayedBranch = activeLane?.branch ?? snapshot.currentGitBranch ?? collabBranch
  const chromeLabel = displayedBranch || "Select branch"
  const actionLabel =
    activeLane?.isCollab === false && chromeLabel !== collabBranch
      ? `Target ${collabBranch}`
      : "Collab lane"
  const statusSummary = getStatusSummary(snapshot.gitStatus)
  const laneKind = activeLane?.isCollab ? "Collab Lane" : "Personal Lane"

  const items: ContextMenuItem<string>[] = [
    {
      id: "workbench-branch:header-kind",
      label: laneKind,
      enabled: false,
    },
    {
      id: "workbench-branch:header-status",
      label: actionLabel,
      sublabel: statusSummary ?? undefined,
      enabled: false,
    },
    { id: "workbench-branch:sep-after-header", type: "separator" },
  ]

  if (!snapshot.isRepo) {
    items.push({
      id: "workbench-branch:no-repo",
      label: projectPath ? "No git repository detected." : "Local project path is not ready yet.",
      enabled: false,
    })
    if (footerMessage) {
      items.push({ id: "workbench-branch:sep-err", type: "separator" })
      items.push({
        id: "workbench-branch:last-error",
        label: footerMessage,
        enabled: false,
      })
    }
    return items
  }

  if (!activeLane?.isCollab) {
    items.push({
      id: WB_BRANCH_MENU.switchCollab,
      label: "Switch To Collab Lane",
    })
  }

  for (const lane of rememberedPersonalLanes) {
    items.push({
      id: WB_BRANCH_MENU.lane(lane.id),
      label: lane.branch,
    })
  }

  items.push({
    id: WB_BRANCH_MENU.newPersonalLane,
    label: "New Personal Lane",
    enabled: !newLaneDisabled,
  })

  const showLaneActionSeparator =
    rememberedPersonalLanes.length > 0 || !activeLane?.isCollab
  if (showLaneActionSeparator) {
    items.push({ id: "workbench-branch:sep-lane-actions", type: "separator" })
  }

  items.push(
    {
      id: WB_BRANCH_MENU.pull,
      label: "Pull Active Lane",
      enabled: !laneActionsLocked,
    },
    {
      id: WB_BRANCH_MENU.push,
      label: "Push Active Lane",
      enabled: !laneActionsLocked,
    },
  )

  if (!activeLane?.isCollab && chromeLabel !== collabBranch) {
    items.push({
      id: WB_BRANCH_MENU.updateFromCollab,
      label: "Merge Collab Into Lane",
      enabled: !laneActionsLocked,
    })
  }

  if (!activeLane?.isCollab) {
    items.push({
      id: WB_BRANCH_MENU.mergeIntoCollab,
      label: "Merge Lane Into Collab",
      enabled: !laneActionsLocked,
    })
    items.push({
      id: WB_BRANCH_MENU.openPr,
      label: snapshot.gitStatus?.pr?.url ? "Open Current PR" : "Start Pull Request",
      enabled: !laneActionsLocked,
    })
  }

  items.push({ id: "workbench-branch:sep-branches", type: "separator" })
  items.push({
    id: "workbench-branch:branches-label",
    label: "Branches",
    enabled: false,
  })

  if (snapshot.branches.length === 0) {
    items.push({
      id: "workbench-branch:no-branches",
      label: "No branches available.",
      enabled: false,
    })
  } else {
    for (let i = 0; i < snapshot.branches.length; i += 1) {
      const branch = snapshot.branches[i]!
      const nextBranchName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      const isActive = nextBranchName === chromeLabel
      const isCollabTarget = nextBranchName === collabBranch
      const worktreeExtra =
        branch.worktreePath && branch.worktreePath !== projectPath ? " (worktree)" : ""
      const collabExtra = isCollabTarget ? " · collab" : ""
      items.push({
        id: WB_BRANCH_MENU.branch(i),
        type: "radio",
        label: `${branch.name}${collabExtra}${worktreeExtra}`,
        checked: isActive,
      })
    }
  }

  if (footerMessage) {
    items.push({ id: "workbench-branch:sep-footer-err", type: "separator" })
    items.push({
      id: "workbench-branch:footer-error",
      label: footerMessage,
      enabled: false,
    })
  }

  return items
}

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
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [activeAction, setActiveAction] = useState<LaneAction | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)
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

  const handleOpenNativeBranchMenu = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      if (!branchCwd) return

      event.preventDefault()
      event.stopPropagation()

      // Capture anchor before any await — React clears `currentTarget` after async gaps.
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
        activeLane,
        collabBranch,
        projectPath,
        rememberedPersonalLanes,
        laneActionsLocked: activeAction !== null,
        newLaneDisabled: isSwitching || activeAction !== null,
        priorPanelError,
      })

      const action = await showWorkbenchBranchNativeMenu(menuPosition, menuItems)
      if (!action || !projectId) return

      const laneIdFromMenu = parseWorkbenchBranchMenuLaneId(action)
      if (laneIdFromMenu) {
        void (async () => {
          try {
            await switchToLane(projectId, laneIdFromMenu)
            await onLaneStateChange?.()
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
            await switchToLane(projectId, "collab")
            await onLaneStateChange?.()
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
      activeLane,
      applyGitToolbarSnapshot,
      branchCwd,
      collabBranch,
      handleBranchSelect,
      handleCreatePersonalLane,
      handleLaneAction,
      isSwitching,
      loadGitToolbarSnapshot,
      onLaneStateChange,
      projectId,
      projectPath,
      rememberedPersonalLanes,
      lastError,
    ],
  )

  const chromeLabel = useMemo(() => {
    if (!displayedBranch) return "Select branch"
    return displayedBranch
  }, [displayedBranch])

  const isBusy = isLoading || isSwitching || activeAction !== null

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "group h-6 gap-1 rounded-md border-0 bg-transparent px-1.5 text-[11px] font-medium text-muted-foreground shadow-none hover:bg-muted/60",
        triggerClassName,
      )}
      disabled={!branchCwd}
      aria-busy={isBusy}
      aria-haspopup="menu"
      onClick={handleOpenNativeBranchMenu}
    >
      {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      <span className="max-w-[160px] truncate leading-none">{chromeLabel}</span>
      <ChevronDown className="hidden h-3 w-3 opacity-70 group-hover:block group-focus-visible:block" />
    </Button>
  )
}
