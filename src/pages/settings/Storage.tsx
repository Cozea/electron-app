import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { getDefaultFolderIcon } from '../../lib/fileExplorer'
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
import {
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileText,
  Package,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import type { LocalProject, StorageProjectsPage, StorageSnapshot, StorageUsage } from '../../types/electron'

interface StorageProps {
  surface?: 'page' | 'drawer'
}

const PROJECTS_PAGE_SIZE = 10
let cachedStorageSnapshot: StorageSnapshot | null = null

// Format bytes to human readable size
function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// Convert bytes to GB for display
function bytesToGB(bytes: number): number {
  return bytes / (1024 * 1024 * 1024)
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

export function Storage({ surface = 'page' }: StorageProps) {
  const { user, logout } = useAuth()
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

  const loadStorageSnapshot = useCallback(
    async (options?: {
      forceRefresh?: boolean
      page?: number
      silent?: boolean
      mode?: 'all' | 'projects'
    }) => {
      if (!window.electronAPI?.storage?.getSnapshot) return

      const mode = options?.mode ?? 'all'
      if (!options?.silent) {
        if (mode === 'all') {
          setIsLoadingStorage(true)
        }
        setIsLoadingProjects(true)
      }

      try {
        const snapshot = await window.electronAPI.storage.getSnapshot({
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
    if (!window.electronAPI?.dialog) return
    await window.electronAPI.dialog.showMessageBox({
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
    if (!window.electronAPI?.dialog || !window.electronAPI?.settings) return

    const result = await window.electronAPI.dialog.selectDirectory()
    if (!result.success || !result.path) return

    setPendingAction('change-directory')
    try {
      await window.electronAPI.settings.set({ projectsDirectory: result.path })
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
    if (!window.electronAPI?.storage?.openProjectsDirectory) return

    setPendingAction('open-folder')
    try {
      const result = await window.electronAPI.storage.openProjectsDirectory()
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
    if (!window.electronAPI?.storage?.clearCache) return

    setPendingAction('clear-cache')
    try {
      const result = await window.electronAPI.storage.clearCache()
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
    if (!window.electronAPI?.storage?.clearLogs) return

    setPendingAction('clear-logs')
    try {
      const result = await window.electronAPI.storage.clearLogs()
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
      if (!window.electronAPI?.dialog || !window.electronAPI?.storage?.deleteProject) return

      const confirmation = await window.electronAPI.dialog.showMessageBox({
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
        const result = await window.electronAPI.storage.deleteProject({
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

        await refreshSnapshot(nextPage, 'all')
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to delete the local project.'
        setActionError(message)
        await showErrorDialog('Delete Project Failed', message)
      } finally {
        setPendingAction(null)
      }
    },
    [currentPage, refreshSnapshot, showErrorDialog, storageSnapshot]
  )

  const handleClearAll = useCallback(async () => {
    if (!window.electronAPI?.storage?.clearAll) return

    setPendingAction('clear-all')
    try {
      const result = await window.electronAPI.storage.clearAll()
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
  const localProjects = projectsPage?.items ?? []

  // Calculate segments from real data
  const segments = storageUsage ? [
    { label: 'Projects', value: bytesToGB(storageUsage.projects), bytes: storageUsage.projects, color: 'bg-blue-500' },
    { label: 'Dependencies', value: bytesToGB(storageUsage.dependencies), bytes: storageUsage.dependencies, color: 'bg-emerald-500' },
    { label: 'Build Cache', value: bytesToGB(storageUsage.buildCache), bytes: storageUsage.buildCache, color: 'bg-amber-500' },
    { label: 'Logs', value: bytesToGB(storageUsage.logs), bytes: storageUsage.logs, color: 'bg-purple-500' },
  ] : []

  // Use actual disk total, fallback to dynamic if disk info unavailable
  const diskTotal = storageUsage?.diskTotal || 0
  const diskFree = storageUsage?.diskFree || 0
  const total = diskTotal > 0 ? bytesToGB(diskTotal) : 100 // Use actual disk size or default to 100 GB
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
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-6xl space-y-6 px-6 py-6'
          : 'space-y-6'
      }
    >
        {/* Storage Usage */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Local Storage</CardTitle>
            <CardDescription>Storage usage on this device</CardDescription>
          </CardHeader>
          <CardContent>
            {actionError && (
              <div className="mb-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {actionError}
              </div>
            )}
            {isLoadingStorage && (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Refreshing storage usage...</span>
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Using{' '}
              <span className="font-semibold tabular-nums text-foreground">
                {storageUsage ? formatBytes(storageUsage.total) : '0 B'}
              </span>
              {diskTotal > 0 && (
                <> of <span className="tabular-nums">{formatBytes(diskTotal)}</span></>
              )}
            </p>

            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {segments.map((segment) => {
                const percentage = (segment.value / total) * 100
                return (
                  <div
                    aria-label={segment.label}
                    aria-valuemax={total}
                    aria-valuemin={0}
                    aria-valuenow={segment.value}
                    className={cn('h-full transition-all', segment.color)}
                    key={segment.label}
                    role="progressbar"
                    style={{ width: `${percentage}%` }}
                  />
                )
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
              {segments.map((segment) => (
                <div className="flex items-center gap-2" key={segment.label}>
                  <span
                    aria-hidden="true"
                    className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', segment.color)}
                  />
                  <span className="text-sm text-muted-foreground">{segment.label}</span>
                  <span className="text-sm tabular-nums text-foreground">
                    {formatBytes(segment.bytes)}
                  </span>
                </div>
              ))}
              {diskFree > 0 && (
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-sm bg-muted"
                  />
                  <span className="text-sm text-muted-foreground">Free</span>
                  <span className="text-sm tabular-nums text-foreground">
                    {formatBytes(diskFree)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <Dialog open={isClearCacheDialogOpen} onOpenChange={setIsClearCacheDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2" disabled={isLoadingStorage || Boolean(pendingAction)}>
                    <Package className="h-4 w-4" />
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
                      {pendingAction === 'clear-cache' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear Cache
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={isClearLogsDialogOpen} onOpenChange={setIsClearLogsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2" disabled={isLoadingStorage || Boolean(pendingAction)}>
                    <FileText className="h-4 w-4" />
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
                      {pendingAction === 'clear-logs' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear Logs
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => void handleRefresh()}
                disabled={isLoadingStorage || Boolean(pendingAction)}
              >
                <RefreshCw className={cn("h-4 w-4", pendingAction === 'refresh' && "animate-spin")} />
                Refresh
              </Button>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => void handleOpenProjectsDirectory()}
                disabled={Boolean(pendingAction)}
              >
                {getDefaultFolderIcon(true, { width: 16, height: 16 })}
                View Folder
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Projects Directory */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Projects Directory</CardTitle>
            <CardDescription>
              Where new projects are created on your computer
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 rounded-3xl bg-secondary/80 p-4 dark:bg-secondary/40">
              {getDefaultFolderIcon(true, { width: 32, height: 32 })}
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{projectsDirectory}</p>
                <p className="text-xs text-muted-foreground">
                  New projects will be created in this directory
                </p>
              </div>
              <Button variant="outline" onClick={() => void handleChangeDirectory()} disabled={Boolean(pendingAction)}>
                {pendingAction === 'change-directory' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Change
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Local Projects */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Local Projects</CardTitle>
            <CardDescription>
              Projects stored on this device
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
              <Table className="[&_th]:px-4 [&_td]:px-4">
                <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Last Modified</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                  {localProjects.length > 0 ? (
                    localProjects.map((project) => (
                      <TableRow key={project.path}>
                        <TableCell className="font-medium">{project.name}</TableCell>
                        <TableCell>{formatBytes(project.size)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatRelativeTime(project.lastModified)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => void handleDeleteProject(project)}
                            disabled={pendingAction === `delete:${project.path}`}
                          >
                            {pendingAction === `delete:${project.path}` ? (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            ) : (
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} className="h-20 text-center text-muted-foreground">
                        {isLoadingProjects
                          ? 'Loading projects...'
                          : 'No projects found in this directory'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {projectsPage && projectsPage.total > projectsPage.pageSize && (
              <div className="mt-4 flex items-center justify-between px-4 py-3">
                <p className="text-sm text-muted-foreground">
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
                    <ChevronLeft className="h-4 w-4" />
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
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle className="text-destructive">Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between rounded-2xl bg-destructive/5 p-5">
              <div>
                <h4 className="font-medium">Clear All Local Data</h4>
                <p className="text-sm text-muted-foreground">
                  Remove all local projects, cache, and settings from this device
                </p>
              </div>
              <Dialog open={isClearAllDialogOpen} onOpenChange={setIsClearAllDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="gap-2" disabled={Boolean(pendingAction)}>
                    <Trash2 className="h-4 w-4" />
                    Clear All
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear All Local Data</DialogTitle>
                    <DialogDescription>
                      This will remove all local projects, build cache, logs, and settings.
                      Cloud-synced data will not be affected. This action cannot be undone.
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
                      {pendingAction === 'clear-all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Clear Everything
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
  )

  if (surface === 'drawer') {
    return content
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Storage' }]}
    >
      {content}
    </DashboardLayout>
  )
}
