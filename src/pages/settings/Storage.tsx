import { useState, useEffect, useCallback, useMemo } from 'react'
import { settingsDesktopClient } from '@/lib/settings/settingsDesktopClient'
import { storageSettingsClient } from '@/lib/settings/storageSettingsClient'
import {

  SettingsDangerGroup,
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/components/settings/SettingsChrome'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { cn } from '../../lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import type { LocalProject, StorageProjectsPage, StorageSnapshot, StorageUsage } from '../../types/electron'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Archive01Icon as __PackageHugeIcon, ChevronDoubleCloseIcon as __ChevronLeftHugeIcon, ChevronDoubleCloseIcon as __ChevronRightHugeIcon, Delete02Icon as __Trash2HugeIcon, DocumentAttachmentIcon as __FileTextHugeIcon, Folder01Icon as __FolderIconHugeIcon, Refresh01Icon as __Loader2HugeIcon, Refresh01Icon as __RefreshCwHugeIcon } from '@hugeicons/core-free-icons'

interface StorageProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const PROJECTS_PAGE_SIZE = 10
let cachedStorageSnapshot: StorageSnapshot | null = null
let storageSnapshotPrewarmPromise: Promise<void> | null = null

interface StorageUsageSegment {
  label: string
  bytes: number
  colorClassName: string
}

function buildSnapshotAfterProjectDeletion(
  snapshot: StorageSnapshot,
  projectPath: string
): StorageSnapshot {
  return buildSnapshotAfterProjectDeletions(snapshot, [projectPath])
}

function buildSnapshotAfterProjectDeletions(
  snapshot: StorageSnapshot,
  projectPaths: string[]
): StorageSnapshot {
  if (projectPaths.length === 0) {
    return snapshot
  }

  const removedPaths = new Set(projectPaths)
  const nextItems = snapshot.projects.items.filter((project) => !removedPaths.has(project.path))
  if (nextItems.length === snapshot.projects.items.length) {
    return snapshot
  }

  const removedCount = snapshot.projects.items.length - nextItems.length
  const nextTotal = Math.max(0, snapshot.projects.total - removedCount)
  const nextTotalPages = Math.max(1, Math.ceil(nextTotal / snapshot.projects.pageSize))
  const nextPage = Math.min(snapshot.projects.page, nextTotalPages)

  return {
    ...snapshot,
    projects: {
      ...snapshot.projects,
      items: nextPage === snapshot.projects.page ? nextItems : [],
      total: nextTotal,
      totalPages: nextTotalPages,
      page: nextPage,
    },
  }
}

// Format bytes to human readable size
function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 B'
  // Use decimal disk units so values line up with macOS Storage/Finder.
  const k = 1000
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatPercentage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  if (value >= 99.95) return '100%'
  if (value >= 10) return `${value.toFixed(0)}%`
  return `${value.toFixed(1)}%`
}

// Format relative time
function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'Just now'
}

function getPageNumbers(currentPage: number, totalPages: number): Array<number | '...'> {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  if (currentPage <= 3) {
    return [1, 2, 3, '...', totalPages]
  }

  if (currentPage >= totalPages - 2) {
    return [1, '...', totalPages - 2, totalPages - 1, totalPages]
  }

  return [1, '...', currentPage, '...', totalPages]
}

export async function prewarmStorageSettings(): Promise<void> {
  if (!storageSettingsClient.isAvailable()) return
  if (cachedStorageSnapshot) return
  if (storageSnapshotPrewarmPromise) {
    await storageSnapshotPrewarmPromise
    return
  }

  storageSnapshotPrewarmPromise = storageSettingsClient
    .getSnapshot({
      page: 1,
      pageSize: PROJECTS_PAGE_SIZE,
    })
    .then((snapshot) => {
      cachedStorageSnapshot = snapshot
    })
    .catch(() => undefined)
    .finally(() => {
      storageSnapshotPrewarmPromise = null
    })

  await storageSnapshotPrewarmPromise
}

export function Storage({ surface = 'page', route: _route }: StorageProps) {
  const [projectsDirectory, setProjectsDirectory] = useState<string>(
    cachedStorageSnapshot?.projectsDirectory ?? '~/Developer/Cozea'
  )
  const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot | null>(cachedStorageSnapshot)
  const [currentPage, setCurrentPage] = useState<number>(cachedStorageSnapshot?.projects.page ?? 1)
  const [isLoadingStorage, setIsLoadingStorage] = useState(!cachedStorageSnapshot)
  const [isLoadingProjects, setIsLoadingProjects] = useState(!cachedStorageSnapshot)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isClearCacheDialogOpen, setIsClearCacheDialogOpen] = useState(false)
  const [isClearLogsDialogOpen, setIsClearLogsDialogOpen] = useState(false)
  const [isClearAllDialogOpen, setIsClearAllDialogOpen] = useState(false)
  const [selectedProjectPaths, setSelectedProjectPaths] = useState<string[]>([])

  const loadStorageSnapshot = useCallback(
    async (options?: {
      forceRefresh?: boolean
      page?: number
      silent?: boolean
      mode?: 'all' | 'projects'
    }) => {
      if (!storageSettingsClient.isAvailable()) return

      const mode = options?.mode ?? 'all'
      if (!options?.silent) {
        if (mode === 'all') {
          setIsLoadingStorage(true)
        }
        setIsLoadingProjects(true)
      }

      try {
        const snapshot = await storageSettingsClient.getSnapshot({
          page: options?.page ?? 1,
          pageSize: PROJECTS_PAGE_SIZE,
          forceRefresh: options?.forceRefresh,
        })

        cachedStorageSnapshot = snapshot
        setStorageSnapshot(snapshot)
        setProjectsDirectory(snapshot.projectsDirectory)
        setCurrentPage(snapshot.projects.page)
        setActionError(null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load storage overview.'
        console.error('Failed to load storage overview:', error)
        setActionError(message)
      } finally {
        if (!options?.silent) {
          if (mode === 'all') {
            setIsLoadingStorage(false)
          }
          setIsLoadingProjects(false)
        }
      }
    },
    []
  )

  useEffect(() => {
    void loadStorageSnapshot({
      page: cachedStorageSnapshot?.projects.page ?? 1,
      silent: Boolean(cachedStorageSnapshot),
      mode: 'all',
    })
  }, [loadStorageSnapshot])

  const showErrorDialog = useCallback(async (title: string, detail: string) => {
    if (!settingsDesktopClient.hasDialog()) return
    await settingsDesktopClient.showMessageBox({
      type: 'error',
      title,
      message: title,
      detail,
    })
  }, [])

  const refreshSnapshot = useCallback(
    async (page: number, mode: 'all' | 'projects' = 'all') => {
      await loadStorageSnapshot({ page, forceRefresh: mode === 'all', mode })
    },
    [loadStorageSnapshot]
  )

  const handleChangeDirectory = useCallback(async () => {
    if (!settingsDesktopClient.hasDialog() || !settingsDesktopClient.hasSettings()) return

    const result = await settingsDesktopClient.selectDirectory()
    if (!result.success || !result.path) return

    setPendingAction('change-directory')
    try {
      await settingsDesktopClient.set({ projectsDirectory: result.path })
      cachedStorageSnapshot = null
      await loadStorageSnapshot({ page: 1, forceRefresh: true, mode: 'all' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to update the projects directory.'
      setActionError(message)
      await showErrorDialog('Directory Change Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [loadStorageSnapshot, showErrorDialog])

  const handleOpenProjectsDirectory = useCallback(async () => {
    if (!storageSettingsClient.isAvailable()) return

    setPendingAction('open-folder')
    try {
      const result = await storageSettingsClient.openProjectsDirectory()
      if (!result.success) {
        throw new Error(result.error || 'Failed to open the projects directory.')
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to open the projects directory.'
      setActionError(message)
      await showErrorDialog('Open Folder Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [showErrorDialog])

  const handleClearCache = useCallback(async () => {
    if (!storageSettingsClient.isAvailable()) return

    setPendingAction('clear-cache')
    try {
      const result = await storageSettingsClient.clearCache()
      if (!result.success) {
        throw new Error(result.error || 'Failed to clear build cache.')
      }

      setIsClearCacheDialogOpen(false)
      await refreshSnapshot(currentPage, 'all')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to clear build cache.'
      setActionError(message)
      await showErrorDialog('Clear Cache Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [currentPage, refreshSnapshot, showErrorDialog])

  const handleClearLogs = useCallback(async () => {
    if (!storageSettingsClient.isAvailable()) return

    setPendingAction('clear-logs')
    try {
      const result = await storageSettingsClient.clearLogs()
      if (!result.success) {
        throw new Error(result.error || 'Failed to clear logs.')
      }

      setIsClearLogsDialogOpen(false)
      await refreshSnapshot(currentPage, 'all')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to clear logs.'
      setActionError(message)
      await showErrorDialog('Clear Logs Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [currentPage, refreshSnapshot, showErrorDialog])

  const handleRefresh = useCallback(async () => {
    setPendingAction('refresh')
    try {
      await refreshSnapshot(currentPage, 'all')
    } finally {
      setPendingAction(null)
    }
  }, [currentPage, refreshSnapshot])

  const handleDeleteProject = useCallback(
    async (project: LocalProject) => {
      if (!settingsDesktopClient.hasDialog() || !storageSettingsClient.isAvailable()) return

      const confirmation = await settingsDesktopClient.showMessageBox({
        type: 'warning',
        buttons: ['Cancel', 'Delete Project'],
        defaultId: 0,
        cancelId: 0,
        title: 'Delete Local Project',
        message: `Delete ${project.name}?`,
        detail:
          'This removes the local project folder from your device. Cloud-synced data is not affected.',
      })

      if (confirmation.response !== 1) return

      const actionKey = `delete:${project.path}`
      setPendingAction(actionKey)

      try {
        const result = await storageSettingsClient.deleteProject({
          projectPath: project.path,
        })
        if (!result.success) {
          throw new Error(result.error || 'Failed to delete the local project.')
        }

        const nextPage =
          storageSnapshot?.projects.page === currentPage &&
          storageSnapshot.projects.items.length === 1 &&
          currentPage > 1
            ? currentPage - 1
            : currentPage
        if (storageSnapshot) {
          const nextSnapshot = buildSnapshotAfterProjectDeletion(storageSnapshot, project.path)
          cachedStorageSnapshot = nextSnapshot
          setStorageSnapshot(nextSnapshot)
          setCurrentPage(nextSnapshot.projects.page)
        }

        void loadStorageSnapshot({
          page: nextPage,
          forceRefresh: true,
          mode: 'all',
          silent: true,
        })
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to delete the local project.'
        setActionError(message)
        await showErrorDialog('Delete Project Failed', message)
      } finally {
        setPendingAction(null)
      }
    },
    [currentPage, loadStorageSnapshot, showErrorDialog, storageSnapshot]
  )

  const handleBulkDeleteProjects = useCallback(async () => {
    if (
      !settingsDesktopClient.hasDialog() ||
      !storageSettingsClient.isAvailable() ||
      selectedProjectPaths.length === 0
    ) {
      return
    }

    const selectedProjects = (storageSnapshot?.projects.items ?? []).filter((project) =>
      selectedProjectPaths.includes(project.path)
    )
    if (selectedProjects.length === 0) {
      return
    }

    const confirmation = await settingsDesktopClient.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Delete Projects'],
      defaultId: 0,
      cancelId: 0,
      title: 'Delete Local Projects',
      message: `Delete ${selectedProjects.length} local project${selectedProjects.length === 1 ? '' : 's'}?`,
      detail:
        'This removes the selected local project folders from your device. Cloud-synced data is not affected.',
    })

    if (confirmation.response !== 1) return

    setPendingAction('delete:selected')

    const deletedPaths: string[] = []
    const failedProjects: string[] = []

    try {
      for (const project of selectedProjects) {
        const result = await storageSettingsClient.deleteProject({
          projectPath: project.path,
        })

        if (result.success) {
          deletedPaths.push(project.path)
        } else {
          failedProjects.push(project.name)
        }
      }

      if (deletedPaths.length > 0 && storageSnapshot) {
        const nextSnapshot = buildSnapshotAfterProjectDeletions(storageSnapshot, deletedPaths)
        cachedStorageSnapshot = nextSnapshot
        setStorageSnapshot(nextSnapshot)
        setCurrentPage(nextSnapshot.projects.page)
      }

      setSelectedProjectPaths((current) => current.filter((path) => !deletedPaths.includes(path)))

      const nextPage =
        storageSnapshot
          ? buildSnapshotAfterProjectDeletions(storageSnapshot, deletedPaths).projects.page
          : currentPage

      void loadStorageSnapshot({
        page: nextPage,
        forceRefresh: true,
        mode: 'all',
        silent: true,
      })

      if (failedProjects.length > 0) {
        const detail =
          failedProjects.length === 1
            ? `Failed to delete ${failedProjects[0]}.`
            : `Failed to delete ${failedProjects.length} selected projects.`
        setActionError(detail)
        await showErrorDialog('Delete Projects Failed', detail)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete the selected local projects.'
      setActionError(message)
      await showErrorDialog('Delete Projects Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [currentPage, loadStorageSnapshot, selectedProjectPaths, showErrorDialog, storageSnapshot])

  const handleClearAll = useCallback(async () => {
    if (!storageSettingsClient.isAvailable()) return

    setPendingAction('clear-all')
    try {
      const result = await storageSettingsClient.clearAll()
      if (!result.success) {
        throw new Error(result.error || 'Failed to clear local data.')
      }

      cachedStorageSnapshot = null
      setIsClearAllDialogOpen(false)
      await loadStorageSnapshot({ page: 1, forceRefresh: true, mode: 'all' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to clear local data.'
      setActionError(message)
      await showErrorDialog('Clear Local Data Failed', message)
    } finally {
      setPendingAction(null)
    }
  }, [loadStorageSnapshot, showErrorDialog])

  const handleProjectPageChange = useCallback(
    async (page: number) => {
      setCurrentPage(page)
      await loadStorageSnapshot({ page, mode: 'projects' })
    },
    [loadStorageSnapshot]
  )

  const storageUsage: StorageUsage | null = storageSnapshot?.usage ?? null
  const projectsPage: StorageProjectsPage | null = storageSnapshot?.projects ?? null
  const localProjects = useMemo(
    () => projectsPage?.items ?? [],
    [projectsPage?.items]
  )
  const allVisibleProjectPaths = useMemo(
    () => localProjects.map((project) => project.path),
    [localProjects]
  )
  const selectedVisibleProjectCount = allVisibleProjectPaths.filter((path) =>
    selectedProjectPaths.includes(path)
  ).length
  const areAllVisibleProjectsSelected =
    localProjects.length > 0 && selectedVisibleProjectCount === localProjects.length

  useEffect(() => {
    setSelectedProjectPaths((current) =>
      current.filter((path) => allVisibleProjectPaths.includes(path))
    )
  }, [allVisibleProjectPaths])

  const toggleAllVisibleProjects = useCallback(() => {
    setSelectedProjectPaths(areAllVisibleProjectsSelected ? [] : allVisibleProjectPaths)
  }, [allVisibleProjectPaths, areAllVisibleProjectsSelected])

  const toggleProjectSelection = useCallback((projectPath: string) => {
    setSelectedProjectPaths((current) =>
      current.includes(projectPath)
        ? current.filter((path) => path !== projectPath)
        : [...current, projectPath]
    )
  }, [])

  // Use actual disk total, fallback to dynamic if disk info unavailable
  const diskTotal = storageUsage?.diskTotal || 0
  const diskFree = storageUsage?.diskFree || 0
  const cozeaTotal = storageUsage?.total ?? 0
  const systemDataBytes =
    diskTotal > 0 ? Math.max(0, diskTotal - diskFree - cozeaTotal) : 0
  const segments: StorageUsageSegment[] = storageUsage
    ? [
        {
          label: 'Projects',
          bytes: storageUsage.projects,
          colorClassName: 'bg-blue-500',
        },
        {
          label: 'Dependencies',
          bytes: storageUsage.dependencies,
          colorClassName: 'bg-emerald-500',
        },
        {
          label: 'Build Cache',
          bytes: storageUsage.buildCache,
          colorClassName: 'bg-amber-500',
        },
        {
          label: 'Logs',
          bytes: storageUsage.logs,
          colorClassName: 'bg-purple-500',
        },
        ...(systemDataBytes > 0
          ? [
              {
                label: 'System Data',
                bytes: systemDataBytes,
                colorClassName: 'bg-border',
              } satisfies StorageUsageSegment,
            ]
          : []),
      ]
    : []
  const total = diskTotal > 0 ? diskTotal : Math.max(cozeaTotal, 1)
  const barSegments = segments.filter((segment) => segment.bytes > 0)
  const projectPageNumbers = getPageNumbers(projectsPage?.page ?? 1, projectsPage?.totalPages ?? 1)
  const showingStart =
    projectsPage && projectsPage.total > 0
      ? (projectsPage.page - 1) * projectsPage.pageSize + 1
      : 0
  const showingEnd =
    projectsPage && projectsPage.total > 0
      ? Math.min(projectsPage.page * projectsPage.pageSize, projectsPage.total)
      : 0

  const content = (
    <SettingsPageBody
      surface={surface}
      className={surface === 'drawer' ? '!max-w-6xl' : undefined}
    >
      <section>
        <div className="space-y-4 px-1 pt-1">
          {actionError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{actionError}</div>
          ) : null}
          <div className="space-y-4">
            <p className="text-[11px] text-muted-foreground">
              Cozea is using{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {storageUsage ? formatBytes(storageUsage.total) : '0 B'}
              </span>
              {diskTotal > 0 && (
                <> of <span className="tabular-nums">{formatBytes(diskTotal)}</span></>
              )}
            </p>

            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
              {barSegments.map((segment) => {
                const percentage = total > 0 ? (segment.bytes / total) * 100 : 0
                const percentLabel = formatPercentage(percentage)
                return (
                  <Tooltip key={segment.label}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`${segment.label}: ${formatBytes(segment.bytes)} (${percentLabel})`}
                        aria-valuemax={total}
                        aria-valuemin={0}
                        aria-valuenow={segment.bytes}
                        className={cn(
                          'h-full shrink-0 cursor-default border-0 p-0 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                          segment.colorClassName
                        )}
                        role="progressbar"
                        style={{ width: `${percentage}%` }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="flex flex-col gap-0.5">
                      <span className="font-medium">{segment.label}</span>
                      <span>{formatBytes(segment.bytes)}</span>
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {segments.map((segment) => (
                <div className="flex items-center gap-2" key={segment.label}>
                  <span
                    aria-hidden="true"
                    className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', segment.colorClassName)}
                  />
                  <span className="text-[11px] text-muted-foreground">{segment.label}</span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
              <Dialog open={isClearCacheDialogOpen} onOpenChange={setIsClearCacheDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2 font-normal" disabled={isLoadingStorage || Boolean(pendingAction)}>
                    <HugeiconsIcon icon={__PackageHugeIcon} className="h-4 w-4" />
                    Clear Cache
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear Build Cache</DialogTitle>
                    <DialogDescription>
                      This will remove {storageUsage ? formatBytes(storageUsage.buildCache) : '0 B'} of cached build artifacts. Projects may take longer to build next time.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsClearCacheDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleClearCache()}
                      disabled={pendingAction === 'clear-cache'}
                    >
                      {pendingAction === 'clear-cache' ? <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear Cache
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isClearLogsDialogOpen} onOpenChange={setIsClearLogsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2 font-normal" disabled={isLoadingStorage || Boolean(pendingAction)}>
                    <HugeiconsIcon icon={__FileTextHugeIcon} className="h-4 w-4" />
                    Clear Logs
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear Logs</DialogTitle>
                    <DialogDescription>
                      This will remove {storageUsage ? formatBytes(storageUsage.logs) : '0 B'} of log files. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsClearLogsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleClearLogs()}
                      disabled={pendingAction === 'clear-logs'}
                    >
                      {pendingAction === 'clear-logs' ? <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear Logs
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                className="w-full gap-2 font-normal"
                onClick={() => void handleRefresh()}
                disabled={isLoadingStorage || Boolean(pendingAction)}
              >
                <HugeiconsIcon icon={__RefreshCwHugeIcon} className={cn("h-4 w-4", pendingAction === 'refresh' && "animate-spin")} />
                Refresh
              </Button>

              <Button
                variant="outline"
                className="w-full gap-2 font-normal"
                onClick={() => void handleOpenProjectsDirectory()}
                disabled={Boolean(pendingAction)}
              >
                <HugeiconsIcon icon={__FolderIconHugeIcon} className="h-4 w-4" />
                View Folder
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SettingsSectionTitle>Projects directory</SettingsSectionTitle>
        <SettingsSectionDescription>Where new projects are created on your computer.</SettingsSectionDescription>
        <SettingsGroup>
          <div className="flex items-center gap-4 px-4 py-3">
            <HugeiconsIcon icon={__FolderIconHugeIcon} className="h-4 w-4 shrink-0 text-muted-foreground/75" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-foreground">{projectsDirectory}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => void handleChangeDirectory()}
              disabled={Boolean(pendingAction)}
            >
              {pendingAction === 'change-directory' ? <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Change
            </Button>
          </div>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>Local projects</SettingsSectionTitle>
        <SettingsSectionDescription>Projects stored on this device.</SettingsSectionDescription>
        <SettingsGroup>
          {selectedProjectPaths.length > 0 ? (
            <div className="flex justify-end border-b border-border/40 px-4 py-2">
              <Button
                variant="destructive"
                size="sm"
                className="h-7 gap-1.5 rounded-full text-[11px]"
                onClick={() => void handleBulkDeleteProjects()}
                disabled={pendingAction === 'delete:selected'}
              >
                {pendingAction === 'delete:selected' ? (
                  <HugeiconsIcon icon={__Loader2HugeIcon} className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                )}
                Delete ({selectedProjectPaths.length})
              </Button>
            </div>
          ) : null}
          <div className="overflow-hidden">
              <Table className="[&_th]:px-4 [&_th]:font-normal [&_th]:text-muted-foreground [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={areAllVisibleProjectsSelected}
                        onCheckedChange={toggleAllVisibleProjects}
                        disabled={localProjects.length === 0 || pendingAction === 'delete:selected'}
                        aria-label="Select all local projects on this page"
                      />
                    </TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last Modified</TableHead>
                    <TableHead className="w-[72px] pr-6"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {localProjects.length > 0 ? (
                    localProjects.map((project) => (
                      <TableRow key={project.path}>
                        <TableCell>
                          <Checkbox
                            checked={selectedProjectPaths.includes(project.path)}
                            onCheckedChange={() => toggleProjectSelection(project.path)}
                            disabled={pendingAction === 'delete:selected'}
                            aria-label={`Select ${project.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-foreground">{project.name}</TableCell>
                        <TableCell>{formatBytes(project.size)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatRelativeTime(project.lastModified)}
                        </TableCell>
                        <TableCell className="pr-6">
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void handleDeleteProject(project)}
                              disabled={Boolean(pendingAction)}
                            >
                              {pendingAction === `delete:${project.path}` ? (
                                <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 animate-spin text-muted-foreground" />
                              ) : (
                                <HugeiconsIcon icon={__Trash2HugeIcon} className="h-4 w-4 text-muted-foreground" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        {isLoadingProjects
                          ? 'Projects in this directory will appear here.'
                          : 'No projects found in this directory'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {projectsPage && projectsPage.total > projectsPage.pageSize ? (
              <div className="flex items-center justify-between border-t border-border/40 px-4 py-3">
                <p className="text-[11px] text-muted-foreground">
                  Showing <span className="font-medium">{showingStart}-{showingEnd}</span> of <span className="font-medium">{projectsPage.total}</span> entries
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => void handleProjectPageChange((projectsPage.page ?? 1) - 1)}
                    disabled={projectsPage.page === 1 || isLoadingProjects}
                  >
                    <HugeiconsIcon icon={__ChevronLeftHugeIcon} className="h-4 w-4" />
                  </Button>
                  {projectPageNumbers.map((pageNumber, index) => (
                    typeof pageNumber === 'number' ? (
                      <Button
                        key={index}
                        variant={projectsPage.page === pageNumber ? 'default' : 'secondary'}
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => void handleProjectPageChange(pageNumber)}
                        disabled={isLoadingProjects}
                      >
                        {pageNumber}
                      </Button>
                    ) : (
                      <span key={index} className="px-2 text-muted-foreground">
                        {pageNumber}
                      </span>
                    )
                  ))}
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => void handleProjectPageChange((projectsPage.page ?? 1) + 1)}
                    disabled={projectsPage.page >= projectsPage.totalPages || isLoadingProjects}
                  >
                    <HugeiconsIcon icon={__ChevronRightHugeIcon} className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : null}
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle variant="danger">
          <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="size-3.5" aria-hidden />
          Danger zone
        </SettingsSectionTitle>
        <SettingsDangerGroup>
          <SettingsRow isFirst borderClassName="border-destructive/20">
            <SettingsRowLabel
              title="Clear all local data"
              description="Remove local projects, cache, and settings from this device."
              descriptionClassName="truncate"
            />
            <SettingsRowControl>
              <Dialog open={isClearAllDialogOpen} onOpenChange={setIsClearAllDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 gap-1.5 text-[11px]"
                    disabled={Boolean(pendingAction)}
                  >
                    <HugeiconsIcon icon={__Trash2HugeIcon} className="h-3.5 w-3.5" />
                    Clear all
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear all local data</DialogTitle>
                    <DialogDescription>
                      This will remove all local projects, build cache, logs, and settings. Cloud-synced data will
                      not be affected. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsClearAllDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleClearAll()}
                      disabled={pendingAction === 'clear-all'}
                    >
                      {pendingAction === 'clear-all' ? <HugeiconsIcon icon={__Loader2HugeIcon} className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear everything
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsDangerGroup>
      </section>
    </SettingsPageBody>
  )

  if (surface === 'drawer') {
    return content
  }

  return content
}

