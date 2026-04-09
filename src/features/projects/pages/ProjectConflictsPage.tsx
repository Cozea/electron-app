import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon as ArrowLeft, ArrowPathIcon as Loader2, ArrowPathIcon as RefreshCw, ArrowsRightLeftIcon as GitMerge, CheckIcon as Check, FolderOpenIcon as FolderOpen } from "@heroicons/react/24/outline"

import { useViewTransitionNavigate } from '@/lib/navigation'
import { useLocation } from '@/lib/router'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { buildProjectPath } from '@/features/projects/lib/projectRoutes'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'
import { useLocalProjectPath } from '@/features/projects/hooks/useLocalProjectPath'
import { useOptionalProjectSyncContext } from '@/features/projects/contexts/ProjectSyncContext'
import { CodeMirrorMergeViewer } from '@/features/projects/components/changes/CodeMirrorMergeViewer'

interface ConflictFileState {
  baseContent: string | null
  localContent: string | null
  cloudContent: string | null
  currentContent: string
}

export function ProjectConflictsPage() {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { project, projectIdParam } = useAccessibleProject()
  const syncContext = useOptionalProjectSyncContext()
  const projectId = project?._id ? String(project._id) : projectIdParam
  const navigationLocalPath =
    typeof location.state === 'object' &&
    location.state !== null &&
    'localPath' in location.state &&
    typeof (location.state as { localPath?: unknown }).localPath === 'string'
      ? (location.state as { localPath: string }).localPath
      : null
  const { localPath: resolvedLocalPath } = useLocalProjectPath({
    initialPath: navigationLocalPath,
    preferInitialPath: Boolean(navigationLocalPath),
    projectId,
    projectSlug: project?.slug ?? null,
  })
  const projectPath = syncContext?.projectPath ?? resolvedLocalPath
  const projectName = project?.name ?? project?.slug ?? 'Project'

  const [conflictedPaths, setConflictedPaths] = useState<string[]>([])
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [conflictFile, setConflictFile] = useState<ConflictFileState | null>(null)
  const [resolvedContent, setResolvedContent] = useState('')
  const [statusLoading, setStatusLoading] = useState(false)
  const [fileLoading, setFileLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async (preferredPath?: string | null) => {
    if (!projectPath) {
      setConflictedPaths([])
      setSelectedPath(null)
      return []
    }

    setStatusLoading(true)
    setError(null)
    try {
      const statusResult = await window.electronAPI.sync.gitStatus({ projectPath })
      if (!statusResult.success || !statusResult.isRepo) {
        throw new Error(statusResult.error || 'Failed to inspect git conflicts')
      }

      const nextPaths = statusResult.conflictedPaths ?? []
      setConflictedPaths(nextPaths)
      setSelectedPath((currentPath) => {
        if (preferredPath && nextPaths.includes(preferredPath)) {
          return preferredPath
        }
        if (currentPath && nextPaths.includes(currentPath)) {
          return currentPath
        }
        return nextPaths[0] ?? null
      })
      if (nextPaths.length === 0) {
        setConflictFile(null)
        setResolvedContent('')
      }
      return nextPaths
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to inspect git conflicts')
      return []
    } finally {
      setStatusLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!projectPath || !selectedPath) {
      setConflictFile(null)
      return
    }

    let cancelled = false
    setFileLoading(true)
    setError(null)

    void window.electronAPI.sync.gitReadConflictFile({
      projectPath,
      filePath: selectedPath,
    }).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setConflictFile(null)
        setError(result.error || 'Failed to load conflicted file')
        return
      }

      const nextConflictFile: ConflictFileState = {
        baseContent: result.baseContent ?? null,
        localContent: result.localContent ?? null,
        cloudContent: result.cloudContent ?? null,
        currentContent: result.currentContent ?? '',
      }

      setConflictFile(nextConflictFile)
      setResolvedContent(
        result.currentContent ??
          result.localContent ??
          result.cloudContent ??
          '',
      )
    }).finally(() => {
      if (!cancelled) {
        setFileLoading(false)
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectPath, selectedPath])

  const remainingCount = conflictedPaths.length
  const selectedIndex = useMemo(
    () => conflictedPaths.findIndex((filePath) => filePath === selectedPath),
    [conflictedPaths, selectedPath],
  )

  const handleOpenFolder = useCallback(async () => {
    if (!projectPath) return
    const result = await window.electronAPI.project.openFolder({ projectPath })
    if (!result.success) {
      setError(result.error || 'Failed to open project folder')
    }
  }, [projectPath])

  const handleResolve = useCallback(async () => {
    if (!projectPath || !selectedPath) return

    setSaveLoading(true)
    setError(null)
    try {
      const resolveResult = await window.electronAPI.sync.gitResolveConflictFile({
        projectPath,
        filePath: selectedPath,
        resolvedContent,
      })

      if (!resolveResult.success) {
        throw new Error(resolveResult.error || 'Failed to save conflict resolution')
      }

      if (resolveResult.mergeCompleted && projectId) {
        navigate(buildProjectPath(projectId, 'workbench'), { replace: true })
        return
      }

      const nextPaths =
        resolveResult.remainingConflictedPaths ??
        await refreshStatus(selectedPath)

      if (nextPaths.length === 0) {
        if (projectId) {
          navigate(buildProjectPath(projectId, 'workbench'), { replace: true })
        }
        return
      }

      const currentIndex = nextPaths.findIndex((filePath) => filePath === selectedPath)
      const fallbackIndex = currentIndex >= 0 ? currentIndex : Math.min(selectedIndex, nextPaths.length - 1)
      setSelectedPath(nextPaths[Math.max(0, fallbackIndex)] ?? nextPaths[0] ?? null)
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : 'Failed to save conflict resolution')
    } finally {
      setSaveLoading(false)
    }
  }, [navigate, projectId, projectPath, refreshStatus, resolvedContent, selectedIndex, selectedPath])

  if (project === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading conflicts…
      </div>
    )
  }

  if (project === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">Project not found.</p>
        <Button onClick={() => navigate('/projects')}>Back to Projects</Button>
      </div>
    )
  }

  if (!projectPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">
          Local project files are not available for conflict resolution yet.
        </p>
        <Button onClick={() => navigate('/projects')}>Back to Projects</Button>
      </div>
    )
  }

  if (!statusLoading && conflictedPaths.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>No unresolved conflicts</CardTitle>
            <CardDescription>
              This project does not have any active Git conflicts.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button onClick={() => projectId && navigate(buildProjectPath(projectId), { replace: true })}>
              Open Project
            </Button>
            <Button variant="outline" onClick={() => void refreshStatus()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <div className="flex w-72 shrink-0 flex-col border-r bg-muted/20">
        <div className="border-b px-4 py-4">
          <div className="mb-2 flex items-center gap-2">
            <GitMerge className="h-4 w-4" />
            <h1 className="text-sm font-semibold">Conflict Resolver</h1>
          </div>
          <p className="text-xs text-muted-foreground">{projectName}</p>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant="secondary">
              {remainingCount} file{remainingCount === 1 ? '' : 's'}
            </Badge>
            {statusLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-1 p-2">
            {conflictedPaths.map((filePath) => (
              <button
                key={filePath}
                type="button"
                onClick={() => setSelectedPath(filePath)}
                className={cn(
                  'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                  selectedPath === filePath
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted'
                )}
              >
                <div className="truncate font-medium">{filePath.split('/').pop()}</div>
                <div
                  className={cn(
                    'truncate text-xs',
                    selectedPath === filePath ? 'text-primary-foreground/80' : 'text-muted-foreground',
                  )}
                >
                  {filePath}
                </div>
              </button>
            ))}
          </div>
        </ScrollArea>

        <div className="flex flex-col gap-2 border-t p-3">
          <Button variant="outline" onClick={handleOpenFolder}>
            <FolderOpen className="mr-2 h-4 w-4" />
            Open Folder
          </Button>
          <Button
            variant="ghost"
            onClick={() => projectId && navigate(buildProjectPath(projectId), { replace: true })}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{selectedPath ?? 'Select a conflicted file'}</div>
            <div className="text-xs text-muted-foreground">
              Review both sides, edit the resolved result, then save.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void refreshStatus(selectedPath)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={handleResolve} disabled={!selectedPath || saveLoading}>
              {saveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Save Resolution
            </Button>
          </div>
        </div>

        {error ? (
          <div className="border-b bg-destructive/10 px-5 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!selectedPath ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conflicted file to start resolving it.
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(260px,42%)]">
            <div className="min-h-0 border-b p-4">
              <Card className="flex h-full min-h-0 flex-col">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Your changes vs incoming changes</CardTitle>
                  <CardDescription>
                    Reviewing your local version against the incoming cloud version.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">Local</Badge>
                    <Badge variant="outline">Incoming</Badge>
                    {fileLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden rounded-md border">
                    <CodeMirrorMergeViewer
                      original={conflictFile?.localContent ?? ''}
                      modified={conflictFile?.cloudContent ?? ''}
                      filePath={selectedPath}
                      className="h-full"
                    />
                  </div>

                  {conflictFile?.baseContent ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-muted-foreground">Merge base</div>
                      <Textarea
                        readOnly
                        value={conflictFile.baseContent}
                        className="min-h-24 resize-none font-mono text-xs"
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>

            <div className="min-h-0 p-4">
              <Card className="flex h-full min-h-0 flex-col">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Resolved result</CardTitle>
                      <CardDescription>
                        Edit the final content you want to keep, then save it back into Git.
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResolvedContent(conflictFile?.localContent ?? '')}
                        disabled={fileLoading}
                      >
                        Use Local
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResolvedContent(conflictFile?.cloudContent ?? '')}
                        disabled={fileLoading}
                      >
                        Use Incoming
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setResolvedContent(conflictFile?.currentContent ?? '')}
                        disabled={fileLoading}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex min-h-0 flex-1">
                  <Textarea
                    value={resolvedContent}
                    onChange={(event) => setResolvedContent(event.target.value)}
                    spellCheck={false}
                    className="h-full min-h-0 flex-1 resize-none font-mono text-xs leading-6"
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
