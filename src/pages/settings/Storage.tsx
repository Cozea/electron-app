import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
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
  Folder,
  Trash2,
  FileText,
  Package,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import type { StorageUsage, LocalProject } from '../../types/electron'

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

export function Storage() {
  const { user, logout } = useAuth()
  const [projectsDirectory, setProjectsDirectory] = useState<string>('~/Developer/Cozea')
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([])
  const [isLoadingStorage, setIsLoadingStorage] = useState(true)
  const [isLoadingProjects, setIsLoadingProjects] = useState(true)

  // Load storage usage
  const loadStorageUsage = useCallback(async () => {
    if (!window.electronAPI?.storage) return
    setIsLoadingStorage(true)
    try {
      const usage = await window.electronAPI.storage.getUsage()
      setStorageUsage(usage)
    } catch (err) {
      console.error('Failed to load storage usage:', err)
    } finally {
      setIsLoadingStorage(false)
    }
  }, [])

  // Load local projects
  const loadLocalProjects = useCallback(async () => {
    if (!window.electronAPI?.storage) return
    setIsLoadingProjects(true)
    try {
      const projects = await window.electronAPI.storage.listProjects()
      setLocalProjects(projects)
    } catch (err) {
      console.error('Failed to load local projects:', err)
    } finally {
      setIsLoadingProjects(false)
    }
  }, [])

  // Load settings and storage on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (window.electronAPI?.settings) {
        const settings = await window.electronAPI.settings.get()
        setProjectsDirectory(settings.projectsDirectory)
      }
    }
    loadSettings()
    loadStorageUsage()
    loadLocalProjects()
  }, [loadStorageUsage, loadLocalProjects])

  // Handle directory change
  const handleChangeDirectory = async () => {
    if (!window.electronAPI?.dialog) return

    const result = await window.electronAPI.dialog.selectDirectory()
    if (result.success && result.path) {
      setProjectsDirectory(result.path)
      await window.electronAPI.settings.set({ projectsDirectory: result.path })
      // Refresh storage usage after changing directory
      loadStorageUsage()
    }
  }

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

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Storage' }]}
    >
      <div className="space-y-6">
        {/* Storage Usage */}
        <Card className="border-none shadow-none bg-transparent">
          <CardHeader>
            <CardTitle>Local Storage</CardTitle>
            <CardDescription>Storage usage on this device</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingStorage ? (
              <div className="flex items-center gap-2 py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Calculating storage usage...</span>
              </div>
            ) : (
              <>
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
              </>
            )}

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2" disabled={isLoadingStorage}>
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
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Cache</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2" disabled={isLoadingStorage}>
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
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Logs</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={loadStorageUsage}
                disabled={isLoadingStorage}
              >
                <RefreshCw className={cn("h-4 w-4", isLoadingStorage && "animate-spin")} />
                Refresh
              </Button>

              <Button variant="outline" className="w-full gap-2">
                <Folder className="h-4 w-4" />
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
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <Folder className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{projectsDirectory}</p>
                <p className="text-xs text-muted-foreground">
                  New projects will be created in this directory
                </p>
              </div>
              <Button variant="outline" onClick={handleChangeDirectory}>Change</Button>
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
            {isLoadingProjects ? (
              <div className="flex items-center gap-2 py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Loading projects...</span>
              </div>
            ) : localProjects.length === 0 ? (
              <div className="flex items-center justify-center py-12 border-2 border-dashed border-muted rounded-lg">
                <p className="text-sm text-muted-foreground">
                  No projects found in this directory
                </p>
              </div>
            ) : (
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
                    {localProjects.map((project) => (
                      <TableRow key={project.path}>
                        <TableCell className="font-medium">{project.name}</TableCell>
                        <TableCell>{formatBytes(project.size)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatRelativeTime(project.lastModified)}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
            <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
              <div>
                <h4 className="font-medium">Clear All Local Data</h4>
                <p className="text-sm text-muted-foreground">
                  Remove all local projects, cache, and settings from this device
                </p>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="gap-2">
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
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Everything</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
