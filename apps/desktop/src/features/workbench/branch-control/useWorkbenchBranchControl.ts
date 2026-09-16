import type { GitBranch as NativeGitBranch } from "@cozea/assistant-contracts"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"

import {
  getWorkspaceGitStatusSummary,
  humanizeGitError,
  parseBranchCheckoutConflict,
  resolveDisplayedWorkbenchBranch,
  resolveWorkbenchBranchAriaLabel,
  resolveWorkbenchBranchChromeLabel,
  resolveWorkbenchBranchTooltipDetail,
  type BranchCheckoutConflict,
} from "./workbenchBranchDisplay"
import { checkoutGitBranchCompat, loadGitBranchesCompat } from "./workbenchBranchCompat"
import { appToast } from "@/lib/appToast"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { deriveLocalBranchNameFromRemoteRef } from "@/lib/git/projectBranchToolbar"
import {
  readProjectBranchSession,
  readScopedProjectBranchSession,
  rememberProjectBranchSession,
} from "@/features/source-control/model/projectBranchSessionStore"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import {
  useOptionalProjectSyncContext,
  type CollabEncryptionStatus,
  type CollabSessionStatus,
} from "@/contexts/project/ProjectSyncContext"
import type { WorkbenchBranchPrInfo } from "./WorkbenchBranchStatusIcon"

interface UseWorkbenchBranchControlInput {
  projectId: string | null
  workspaceId: string | null
  collabBranch: string
  laneState: ProjectLaneState | null
  activeLane: ProjectLaneDescriptor | null
  onLaneStateChange?: () => void
}

interface GitToolbarSnapshot {
  isRepo: boolean
  branches: NativeGitBranch[]
  currentGitBranch: string | null
  gitStatus: Awaited<ReturnType<typeof window.electronAPI.workspaceSync.gitStatus>> | null
  loadError: string | null
  hasVerifiedGitStatus: boolean
}

function isCollabLiveAvailable(input: {
  sessionStatus: CollabSessionStatus
  encryptionStatus: CollabEncryptionStatus | null
}): boolean {
  if (input.sessionStatus !== "ready") return false
  if (
    input.encryptionStatus === "missing_for_device" ||
    input.encryptionStatus === "device_revoked"
  ) {
    return false
  }
  return true
}

function buildMenuItems(input: {
  snapshot: GitToolbarSnapshot
  collabBranch: string
  activeLane: ProjectLaneDescriptor | null
  priorPanelError?: string | null
  collabLiveAvailable?: boolean
}): ContextMenuItem<string>[] {
  const { snapshot, collabBranch, activeLane, priorPanelError, collabLiveAvailable = false } = input
  const footerMessage = snapshot.loadError ?? priorPanelError ?? null
  const currentBranch = activeLane?.branch ?? snapshot.currentGitBranch ?? collabBranch
  const modeLabel = activeLane?.isCollab === false ? "Local Branch Mode" : "Shared Branch Mode"
  const modeDetail =
    activeLane?.isCollab === false
      ? "Live collaboration is paused on this branch."
      : collabLiveAvailable
        ? "Live collaboration is active."
        : "Live collaboration unavailable"

  const statusSummary = getWorkspaceGitStatusSummary(snapshot.gitStatus)

  const items: ContextMenuItem<string>[] = [
    {
      id: "workbench-branch:mode",
      label: modeLabel,
      sublabel: modeDetail,
      enabled: false,
    },
    { id: "workbench-branch:sep-branches", type: "separator" },
  ]

  if (!snapshot.isRepo) {
    items.push({
      id: "workbench-branch:no-repo",
      label: "No git repository detected.",
      enabled: false,
    })
    if (footerMessage) {
      items.push({ id: "workbench-branch:sep-footer", type: "separator" })
      items.push({
        id: "workbench-branch:last-error",
        label: footerMessage,
        enabled: false,
      })
    }
    return items
  }

  let hasShownCurrentBranch = false
  let displayedBranchCount = 0

  const localBranchNames = new Set(
    snapshot.branches.filter((b) => !b.isRemote).map((b) => b.name)
  )

  if (snapshot.branches.length > 0) {
    snapshot.branches.forEach((branch, index) => {
      if (branch.isRemote) {
        const localName = deriveLocalBranchNameFromRemoteRef(branch.name)
        if (localBranchNames.has(localName)) return // Skip this one
      }

      displayedBranchCount++

      const comparableName = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name
      const isActive = comparableName === currentBranch
      if (isActive) hasShownCurrentBranch = true

      const branchLabel =
        comparableName === collabBranch ? `${branch.name} · shared` : branch.name
      items.push({
        id: `workbench-branch:branch#${index}`,
        type: "radio",
        label: branchLabel,
        sublabel: isActive && statusSummary ? statusSummary : undefined,
        checked: isActive,
      })
    })
  }

  // If there are no branches listed (e.g. empty repo) OR current branch wasn't explicitly in the list
  if (!hasShownCurrentBranch && currentBranch) {
    items.push({
      id: `workbench-branch:branch#current`,
      type: "radio",
      label: currentBranch === collabBranch ? `${currentBranch} · shared` : currentBranch,
      sublabel: statusSummary ?? undefined,
      checked: true,
    })
  } else if (displayedBranchCount === 0 && !currentBranch) {
    items.push({
      id: "workbench-branch:no-branches",
      label: "No branches available.",
      enabled: false,
    })
  }

  if (footerMessage) {
    items.push({ id: "workbench-branch:sep-footer", type: "separator" })
    items.push({
      id: "workbench-branch:last-error",
      label: footerMessage,
      enabled: false,
    })
  }

  return items
}

function parseBranchIndex(action: string): number | null {
  const prefix = "workbench-branch:branch#"
  if (!action.startsWith(prefix)) return null
  const suffix = action.slice(prefix.length)
  if (suffix === "current") return null // Current branch is already selected
  const value = Number.parseInt(suffix, 10)
  return Number.isFinite(value) ? value : null
}

export function useWorkbenchBranchControl(input: UseWorkbenchBranchControlInput) {
  const [cachedBranch, cachedIsRepo] = useMemo(() => {
    if (input.activeLane?.branch) {
      return [input.activeLane.branch, true] as const
    }
    const stored =
      readScopedProjectBranchSession(input.projectId, input.workspaceId) ??
      readProjectBranchSession(input.projectId)
    return [stored?.activeBranch ?? null, stored?.activeBranch ? true : null] as const
  }, [input.activeLane?.branch, input.projectId, input.workspaceId])

  const [isLoading, setIsLoading] = useState(() => Boolean(input.workspaceId))
  const [isSwitching, setIsSwitching] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [currentGitBranch, setCurrentGitBranch] = useState<string | null>(cachedBranch)
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(cachedIsRepo)
  const [hasVerifiedGitStatus, setHasVerifiedGitStatus] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitToolbarSnapshot["gitStatus"]>(null)
  const [branches, setBranches] = useState<NativeGitBranch[]>([])
  const [branchConflict, setBranchConflict] = useState<BranchCheckoutConflict | null>(null)
  const syncContext = useOptionalProjectSyncContext()

  useEffect(() => {
    setCurrentGitBranch((prev) => {
      if (!hasVerifiedGitStatus && cachedBranch) {
        return cachedBranch
      }
      return prev ?? cachedBranch
    })
    if (cachedIsRepo !== null) {
      setIsGitRepo((prev) => prev ?? cachedIsRepo)
    }
  }, [cachedBranch, cachedIsRepo, hasVerifiedGitStatus])

  const collabLiveAvailable = useMemo(
    () =>
      isCollabLiveAvailable({
        sessionStatus: syncContext?.collabSessionStatus ?? "idle",
        encryptionStatus: syncContext?.collabEncryptionStatus ?? null,
      }),
    [syncContext?.collabEncryptionStatus, syncContext?.collabSessionStatus],
  )

  const branchCwd = input.workspaceId
  const displayedBranch = resolveDisplayedWorkbenchBranch({
    activeLaneBranch: input.activeLane?.branch,
    currentGitBranch,
    collabBranch: input.collabBranch,
  })

  const loadGitToolbarSnapshot = useCallback(async (): Promise<GitToolbarSnapshot | null> => {
    if (!branchCwd) {
      return {
        isRepo: false,
        branches: [],
        currentGitBranch: null,
        gitStatus: null,
        loadError: null,
        hasVerifiedGitStatus: false,
      }
    }

    try {
      const [branchResult, statusResult] = await Promise.all([
        loadGitBranchesCompat(branchCwd),
        window.electronAPI.workspaceSync.gitStatus({ workspaceId: branchCwd }),
      ])

      const nextIsRepo = Boolean(branchResult.isRepo || statusResult.isRepo)
      const hasVerifiedGitStatus = statusResult.success === true
      return {
        isRepo: nextIsRepo,
        branches: [...branchResult.branches],
        currentGitBranch:
          statusResult.currentBranch ??
          branchResult.branches.find((branch) => branch.current)?.name ??
          null,
        gitStatus: statusResult.success === false ? null : statusResult,
        loadError: branchResult.error ?? (statusResult.success === false ? statusResult.error ?? null : null),
        hasVerifiedGitStatus,
      }
    } catch (error) {
      return {
        isRepo: false,
        branches: [],
        currentGitBranch: null,
        gitStatus: null,
        loadError: error instanceof Error ? error.message : "Failed to inspect the local git repository.",
        hasVerifiedGitStatus: false,
      }
    }
  }, [branchCwd])

  const applyGitToolbarSnapshot = useCallback((snapshot: GitToolbarSnapshot) => {
    setCurrentGitBranch(snapshot.currentGitBranch)
    setLastError(snapshot.loadError)
    setIsGitRepo(snapshot.isRepo)
    setHasVerifiedGitStatus(snapshot.hasVerifiedGitStatus)
    setGitStatus(snapshot.gitStatus)
    setBranches(snapshot.branches)
  }, [])

  const refreshGitState = useCallback(async () => {
    if (!branchCwd) {
      setCurrentGitBranch(null)
      setLastError(null)
      setIsGitRepo(null)
      setHasVerifiedGitStatus(false)
      setGitStatus(null)
      setBranches([])
      return
    }

    setIsLoading(true)
    try {
      const snapshot = await loadGitToolbarSnapshot()
      if (!snapshot) return
      applyGitToolbarSnapshot(snapshot)
    } finally {
      setIsLoading(false)
    }
  }, [applyGitToolbarSnapshot, branchCwd, loadGitToolbarSnapshot])

  useEffect(() => {
    setHasVerifiedGitStatus(false)
    void refreshGitState()
  }, [branchCwd, input.projectId, refreshGitState])

  const handleBranchSelect = useCallback(
    async (branch: NativeGitBranch, options?: { stash?: boolean }) => {
      if (!input.projectId || !branchCwd || isSwitching) return

      setIsSwitching(true)
      setLastError(null)

      const checkoutTarget = branch.isRemote
        ? deriveLocalBranchNameFromRemoteRef(branch.name)
        : branch.name

      try {
        const checkoutResult = await checkoutGitBranchCompat(branchCwd, checkoutTarget, options)
        if (!checkoutResult.success) {
          const rawError = checkoutResult.error || "Failed to switch branches"
          const conflict = parseBranchCheckoutConflict(rawError, checkoutTarget)
          if (conflict && !options?.stash) {
            setBranchConflict(conflict)
            return
          }
          throw new Error(rawError)
        }

        const statusResult = await window.electronAPI.workspaceSync
          .gitStatus({ workspaceId: branchCwd })
          .catch(() => null)
        const nextBranch =
          statusResult?.currentBranch ??
          checkoutResult.branch ??
          checkoutTarget

        rememberProjectBranchSession({
          projectId: input.projectId,
          branch: nextBranch,
          collabBranch: input.collabBranch,
          workspaceId: branchCwd,
        })

        setBranchConflict(null)
        await refreshGitState()
        await input.onLaneStateChange?.()
        appToast.success({
          title: "Branch switched",
          description: `Now working on ${nextBranch}.`,
        })
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : "Failed to switch branches"
        const friendlyMessage = humanizeGitError(rawMessage)
        setLastError(friendlyMessage)
        appToast.error({ title: "Failed to switch branches", description: friendlyMessage })
      } finally {
        setIsSwitching(false)
      }
    },
    [branchCwd, input.collabBranch, input.onLaneStateChange, input.projectId, isSwitching, refreshGitState],
  )

  const handleStashAndSwitch = useCallback(async () => {
    if (!branchConflict) return
    const target = branchConflict.targetBranch
    const targetBranchObj: NativeGitBranch = {
      name: target,
      current: false,
      isRemote: false,
      isDefault: false,
      worktreePath: null,
    }
    await handleBranchSelect(targetBranchObj, { stash: true })
  }, [branchConflict, handleBranchSelect])

  const dismissBranchConflict = useCallback(() => {
    setBranchConflict(null)
  }, [])

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
      const items = buildMenuItems({
        snapshot,
        collabBranch: input.collabBranch,
        activeLane: input.activeLane,
        priorPanelError,
        collabLiveAvailable,
      })
      const action = await showDesktopContextMenu(items, menuPosition)
      if (!action) return

      const branchIndex = parseBranchIndex(action)
      if (branchIndex === null) return

      const branch = snapshot.branches[branchIndex]
      if (branch) {
        void handleBranchSelect(branch)
      }
    },
    [
      applyGitToolbarSnapshot,
      branchCwd,
      collabLiveAvailable,
      handleBranchSelect,
      input.activeLane,
      input.collabBranch,
      lastError,
      loadGitToolbarSnapshot,
    ],
  )

  const chromeLabel = useMemo(
    () =>
      resolveWorkbenchBranchChromeLabel({
        isRepo: isGitRepo,
        collabBranch: input.collabBranch,
        activeLaneBranch: input.activeLane?.branch,
        currentGitBranch,
        gitStatusFresh: hasVerifiedGitStatus,
        isLoading,
      }),
    [
      currentGitBranch,
      hasVerifiedGitStatus,
      input.activeLane?.branch,
      input.collabBranch,
      isGitRepo,
      isLoading,
    ],
  )

  const branchAriaLabel = useMemo(
    () =>
      resolveWorkbenchBranchAriaLabel({
        isRepo: isGitRepo,
        displayedBranch,
        gitStatusFresh: hasVerifiedGitStatus,
        isLoading,
      }),
    [displayedBranch, hasVerifiedGitStatus, isGitRepo, isLoading],
  )

  const branchTooltipDetail = useMemo(
    () =>
      resolveWorkbenchBranchTooltipDetail({
        isRepo: isGitRepo,
        gitStatusFresh: hasVerifiedGitStatus,
        isLoading,
        displayedBranch,
      }),
    [displayedBranch, hasVerifiedGitStatus, isGitRepo, isLoading],
  )

  const currentBranch = useMemo(() => {
    return (
      branches.find((b) => b.name === displayedBranch || (b.current && !displayedBranch)) ?? null
    )
  }, [branches, displayedBranch])

  const isWorktree = Boolean(currentBranch?.worktreePath)
  const branchPr: WorkbenchBranchPrInfo | null = useMemo(() => {
    const rawPr = (gitStatus as Record<string, unknown> | null)?.pr as
      | WorkbenchBranchPrInfo
      | undefined
    if (!rawPr || typeof rawPr.number !== "number") return null
    return {
      number: rawPr.number,
      title: rawPr.title,
      url: rawPr.url,
      state: rawPr.state,
      isDraft: rawPr.isDraft,
    }
  }, [gitStatus])

  return {
    branchCwd,
    chromeLabel,
    branchAriaLabel,
    branchTooltipDetail,
    isRepo: Boolean(isGitRepo),
    isWorktree,
    branchPr,
    isBusy: isLoading || isSwitching,
    showActionSpinner: isSwitching,
    handleOpenNativeBranchMenu,
    branchConflict,
    dismissBranchConflict,
    handleStashAndSwitch,
  }
}
