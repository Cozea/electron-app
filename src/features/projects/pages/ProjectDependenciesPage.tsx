import { useState, useCallback, useMemo, useEffect } from 'react'
import { useProjectHeader } from '@/hooks/useProjectHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { DependenciesAddDialog } from '../components/DependenciesAddDialog'
import { useDependenciesStore, selectDependenciesSnapshot, selectDependencyJobs } from '@/stores/useDependenciesStore'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Package,
  RefreshCw,
  Plus,
  Loader2,
  ArrowUp,
  Trash2,
  MoreHorizontal,
  List,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'


export function ProjectDependenciesPage() {
  const { project } = useAccessibleProject()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const [filter, setFilter] = useState<'all' | 'dependencies' | 'devDependencies'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'outdated' | 'missing'>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const ITEMS_PER_PAGE = 10

  const snapshot = useDependenciesStore(selectDependenciesSnapshot(projectPath))
  const jobs = useDependenciesStore(selectDependencyJobs(projectPath))
  const setSnapshot = useDependenciesStore((state) => state.actions.setSnapshot)
  const setError = useDependenciesStore((state) => state.actions.setError)
  const dependencies = useMemo(() => snapshot?.items ?? [], [snapshot?.items])
  const error = snapshot?.error ?? null
  const runningJobs = jobs.filter((job) => job.status === 'running')

  const sortedDeps = useMemo(() => {
    return [...dependencies].sort((a, b) => a.name.localeCompare(b.name))
  }, [dependencies])

  const filteredDeps = sortedDeps.filter((dep) => {
    if (filter === 'dependencies' && dep.type !== 'dependency') return false
    if (filter === 'devDependencies' && dep.type !== 'devDependency') return false
    if (statusFilter === 'outdated' && dep.status !== 'outdated') return false
    if (statusFilter === 'missing' && dep.status !== 'missing') return false
    return true
  })

  const prodCount = dependencies.filter(d => d.type === 'dependency').length
  const devCount = dependencies.filter(d => d.type === 'devDependency').length

  // Pagination
  const totalPages = Math.ceil(filteredDeps.length / ITEMS_PER_PAGE)
  const paginatedDeps = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
    return filteredDeps.slice(startIndex, startIndex + ITEMS_PER_PAGE)
  }, [filteredDeps, currentPage])

  // Reset page when filter changes
  useEffect(() => {
    setCurrentPage(1)
  }, [filter, statusFilter])

  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const inspectNow = useCallback(async () => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    try {
      const result = await window.electronAPI.dependencies.inspect({ projectPath })
      if (result.success && result.snapshot) {
        setSnapshot(projectPath, result.snapshot)
      } else if (result.error) {
        setError(projectPath, result.error)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to inspect dependencies'
      setError(projectPath, message)
    }
  }, [projectPath, setError, setSnapshot])

  // Generate page numbers with ellipsis
  const getPageNumbers = () => {
    const pages: (number | 'ellipsis')[] = []
    if (totalPages <= 5) {
      for (let i = 1; i <= totalPages; i++) pages.push(i)
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 'ellipsis', totalPages)
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, 'ellipsis', totalPages - 2, totalPages - 1, totalPages)
      } else {
        pages.push(1, 'ellipsis', currentPage, 'ellipsis', totalPages)
      }
    }
    return pages
  }

  const handleRefresh = useCallback(() => {
    void inspectNow()
  }, [inspectNow])

  const handleAdd = useCallback(async (name: string, options: { dev?: boolean; version?: string }) => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    const result = await window.electronAPI.dependencies.run({
      projectPath,
      action: 'add',
      packageName: name,
      version: options.version,
      dev: options.dev,
    })
    if (!result.success && result.error) {
      setError(projectPath, result.error)
    }
  }, [projectPath, setError])

  const handleUpdate = useCallback(async (name: string, updateMode: 'latest' | 'range') => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    const result = await window.electronAPI.dependencies.run({
      projectPath,
      action: 'update',
      packageName: name,
      updateMode,
    })
    if (!result.success && result.error) {
      setError(projectPath, result.error)
    }
  }, [projectPath, setError])

  const handleRemove = useCallback(async (name: string) => {
    if (!projectPath || !window.electronAPI?.dependencies) return
    const result = await window.electronAPI.dependencies.run({
      projectPath,
      action: 'remove',
      packageName: name,
    })
    if (!result.success && result.error) {
      setError(projectPath, result.error)
    }
  }, [projectPath, setError])

  const headerControls = useMemo(
    () => (
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" className="h-7 gap-1.5 rounded-full px-2.5 text-xs">
              <Package className="h-3 w-3" />
              {filter === 'all' ? `All (${dependencies.length})` : filter === 'dependencies' ? `Dependencies (${prodCount})` : `Dev (${devCount})`}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setFilter('all')}>All ({dependencies.length})</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('dependencies')}>Dependencies ({prodCount})</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setFilter('devDependencies')}>Dev ({devCount})</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRefresh}
                className="h-7 rounded-full px-2"
                disabled={!projectPath}
                aria-label="Refresh dependencies"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">Refresh dependencies</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 gap-1.5 rounded-full px-2.5 text-xs">
              <List className="h-3 w-3" />
              {statusFilter === 'all' ? 'All statuses' : statusFilter === 'outdated' ? 'Outdated' : 'Missing'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setStatusFilter('all')}>All statuses</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('outdated')}>Outdated</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('missing')}>Missing</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" className="h-7 gap-1.5 rounded-full px-2.5 text-xs" onClick={() => setAddDialogOpen(true)} disabled={!projectPath}>
          <Plus className="h-3.5 w-3.5" />
          Add Package
        </Button>
      </div>
    ),
    [
      dependencies.length,
      devCount,
      filter,
      handleRefresh,
      projectPath,
      prodCount,
      statusFilter,
    ]
  )

  useProjectHeader(headerControls)

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-content-surface">
      {/* Scrollable Content */}
      <div className="app-scrollbar flex-1 overflow-auto min-h-0">
        <div className="px-6 pt-2 pb-4 space-y-2">
          {runningJobs.length > 0 && (
            <Card className="p-3 text-xs flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <div>
                Running {runningJobs.length} task{runningJobs.length > 1 ? 's' : ''}…
              </div>
            </Card>
          )}
        </div>

        {/* Error State */}
        {error && (
          <Card className="p-4 mx-6 mt-2 mb-6 border-destructive/50 bg-destructive/10 text-destructive text-sm text-center">
            {error}
          </Card>
        )}

        {/* Dependencies Table */}
        {filteredDeps.length === 0 ? (
          <Card className="p-12 m-6 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No packages found</h3>
            <p className="text-sm text-muted-foreground">
              No dependencies found in package.json.
            </p>
          </Card>
        ) : (
          <div className="px-4 pb-4">
            <Card className="border-0 shadow-none bg-transparent">
              <div className="relative w-full">
                <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
                  <table className="w-full caption-bottom text-sm [&_th]:px-4 [&_td]:px-4">
                    <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[280px]">Package</TableHead>
                        <TableHead>Declared</TableHead>
                        <TableHead>Installed</TableHead>
                        <TableHead>Latest</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right w-[80px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                      {paginatedDeps.map((dep) => (
                        <TableRow key={dep.name}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <Package className="h-4 w-4 text-muted-foreground" />
                              {dep.name}
                            </div>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {dep.declared}
                            </code>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {dep.installed ?? '—'}
                            </code>
                          </TableCell>
                          <TableCell>
                            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                              {dep.latest ?? '—'}
                            </code>
                          </TableCell>
                          <TableCell>
                            <Badge variant={dep.status === 'outdated' ? 'destructive' : dep.status === 'missing' ? 'secondary' : 'default'}>
                              {dep.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={dep.type === 'dependency' ? 'default' : 'secondary'}>
                              {dep.type === 'dependency'
                                ? 'prod'
                                : dep.type === 'devDependency'
                                  ? 'dev'
                                  : dep.type}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleUpdate(dep.name, 'latest')}>
                                  <ArrowUp className="h-4 w-4 mr-2" />
                                  Update to Latest
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleUpdate(dep.name, 'range')}>
                                  <ArrowUp className="h-4 w-4 mr-2" />
                                  Update within range
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive" onClick={() => handleRemove(dep.name)}>
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Uninstall
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </table>
                </div>
              </div>
              {filteredDeps.length > ITEMS_PER_PAGE && (
                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    Showing <span className="font-medium">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, filteredDeps.length)}</span> of <span className="font-medium">{filteredDeps.length}</span> entries
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {getPageNumbers().map((page, i) => (
                      typeof page === 'number' ? (
                        <Button
                          key={i}
                          variant={currentPage === page ? 'default' : 'secondary'}
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </Button>
                      ) : (
                        <span key={i} className="px-2 text-muted-foreground">...</span>
                      )
                    ))}
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 rounded-full"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages || totalPages === 0}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>

      {projectPath && (
        <DependenciesAddDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          projectPath={projectPath}
          onAdd={handleAdd}
        />
      )}
    </div>
  )
}
