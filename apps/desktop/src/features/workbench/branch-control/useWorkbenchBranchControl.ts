import type { GitBranch as NativeGitBranch } from "@cozea/assistant-contracts"
import type { ContextMenuItem } from "@cozea/assistant-contracts"
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"

import {
  getWorkspaceGitStatusSummary,
  resolveDisplayedWorkbenchBranch,
  resolveWorkbenchBranchAriaLabel,
  resolveWorkbenchBranchChromeLabel,
  resolveWorkbenchBranchTooltipDetail,
} from "./workbenchBranchDisplay"
import { checkoutGitBranchCompat, loadGitBranchesCompat } from "./workbenchBranchCompat"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { deriveLocalBranchNameFromRemoteRef } from "@/lib/git/projectBranchToolbar"
import { rememberProjectBranchSession } from "@/features/source-control/model/projectBranchSessionStore"
import type { ProjectLaneDescriptor, ProjectLaneState } from "@shared/electronApiTypes"
import { useYjsProject } from "@/contexts/YjsProjectContextValue"
import {
  useOptionalProjectSyncContext,
  type CollabEncryptionStatus,
  type CollabSessionStatus,
} from "@/features/projects/contexts/ProjectSyncContext"

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
  isTransportConnected: boolean
  encryptionStatus: CollabEncryptionStatus | null
}): boolean {
  if (input.sessionStatus !== "ready") return false
  if (!input.isTransportConnected) return false
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
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitching, setIsSwitching] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [currentGitBranch, setCurrentGitBranch] = useState<string | null>(null)
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
  const [hasVerifiedGitStatus, setHasVerifiedGitStatus] = useState(false)
  const syncContext = useOptionalProjectSyncContext()
  const { isConnected } = useYjsProject()

  const collabLiveAvailable = useMemo(
    () =>
      isCollabLiveAvailable({
        sessionStatus: syncContext?.collabSessionStatus ?? "idle",
        isTransportConnected: isConnected,
        encryptionStatus: syncContext?.collabEncryptionStatus ?? null,
      }),
    [isConnected, syncContext?.collabEncryptionStatus, syncContext?.collabSessionStatus],
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
  }, [])

  const refreshGitState = useCallback(async () => {
    if (!branchCwd) {
      setCurrentGitBranch(null)
      setLastError(null)
      setIsGitRepo(null)
      setHasVerifiedGitStatus(false)
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
    void refreshGitState()
  }, [refreshGitState])

  const handleBranchSelect = useCallback(
    async (branch: NativeGitBranch) => {
      if (!input.projectId || !branchCwd || isSwitching) return

      setIsSwitching(true)
      setLastError(null)

      try {
        const checkoutTarget = branch.name
        const checkoutResult = await checkoutGitBranchCompat(branchCwd, checkoutTarget)
        if (!checkoutResult.success) {
          throw new Error(checkoutResult.error || "Failed to switch branches")
        }

        const statusResult = await window.electronAPI.workspaceSync
          .gitStatus({ workspaceId: branchCwd })
          .catch(() => null)
        const nextBranch =
          statusResult?.currentBranch ??
          checkoutResult.branch ??
          (branch.isRemote ? deriveLocalBranchNameFromRemoteRef(branch.name) : branch.name)

        rememberProjectBranchSession({
          projectId: input.projectId,
          branch: nextBranch,
          collabBranch: input.collabBranch,
          workspaceId: branchCwd,
        })

        await refreshGitState()
        await input.onLaneStateChange?.()
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to switch branches"
        setLastError(message)
      } finally {
        setIsSwitching(false)
      }
    },
    [branchCwd, input.collabBranch, input.onLaneStateChange, input.projectId, isSwitching, refreshGitState],
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

  return {
    branchCwd,
    chromeLabel,
    branchAriaLabel,
    branchTooltipDetail,
    isBusy: isLoading || isSwitching,
    showActionSpinner: isSwitching,
    handleOpenNativeBranchMenu,
  }
}
