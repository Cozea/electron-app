import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from 'convex/react'
import * as Y from 'yjs'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { DashboardLayout } from '@/components/layouts/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Progress } from '@/components/ui/progress'
import xxhashInit, { type XXHashAPI } from 'xxhash-wasm'
import { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

import {
  Check,
  Circle,
  Loader2,
  AlertCircle,
  Square,
  RotateCcw,
  FolderOpen,
  Download,
  Sparkles,
  Trash,
} from 'lucide-react'
import type { BuildTask } from '@/components/builder/BuildTaskList'
import { BuilderConversation } from '@/components/builder/BuilderConversation'

// MIME type mapping for file extensions
const MIME_TYPES: Record<string, string> = {
  ts: 'text/typescript',
  tsx: 'text/typescript',
  js: 'application/javascript',
  jsx: 'application/javascript',
  json: 'application/json',
  css: 'text/css',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return MIME_TYPES[ext] || 'text/plain'
}

// Compute xxhash of content (same algorithm as electron main process)
async function computeHash(content: string, hasher: XXHashAPI): Promise<string> {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(content)
  return hasher.h64Raw(bytes).toString(16).padStart(16, '0')
}

export function ProjectBuild() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { user, logout, convexUserId } = useAuth()

  // Load project from Convex
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as Id<'projects'> } : 'skip'
  )

  // Cloud files for this project
  const projectFiles = useQuery(
    api.projectFiles.listForProject,
    project?._id ? { projectId: project._id } : 'skip'
  )

  const latestBuilderRun = useQuery(
    api.builderRuns.getLatestForProject,
    project?._id ? { projectId: project._id } : 'skip'
  )

  // Mutations
  const updateLocalPath = useMutation(api.projects.updateLocalPath)
  const updateStatus = useMutation(api.projects.updateStatus)
  const generateUploadUrl = useMutation(api.projectFiles.generateUploadUrl)
  const saveFile = useMutation(api.projectFiles.saveFile)
  const startBuilderRun = useMutation(api.builderRuns.startRun)
  const checkpointBuilderRun = useMutation(api.builderRuns.checkpointRun)
  const updateBuilderRunStatus = useMutation(api.builderRuns.updateRunStatus)
  const deleteProject = useMutation(api.projects.deleteProject)
  const saveYjsSnapshot = useMutation(api.yjs.saveSnapshot)

  // Build state
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Preparing to build...')
  const [hasError, setHasError] = useState(false)
  const [logs, setLogs] = useState<string[]>([])

  // Pull state
  const [isPulling, setIsPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState(0)
  const autoPullTriggeredRef = useRef(false)

  // AI Generation state
  const [isAIGenerating, setIsAIGenerating] = useState(false)
  const [buildTasks, setBuildTasks] = useState<BuildTask[]>([])
  const [localPath, setLocalPath] = useState<string | null>(project?.localPath || null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'failed' | 'completed' | 'interrupted'>('idle')
  const [runAttempt, setRunAttempt] = useState(0)
  const [hasHydratedRemote, setHasHydratedRemote] = useState(false)
  const runIdRef = useRef<string | null>(null)

  const isAIComplete = runStatus === 'completed' || (buildTasks.length > 0 && buildTasks.every(t => t.status === 'completed'))
  const runStorageKey = projectId ? `builderRun:${projectId}` : null

  // Track files created during build for Yjs initialization
  const createdFilesRef = useRef<Array<{ path: string; content: string }>>([])

  // xxhash for computing file checksums (same algorithm as electron main process)
  // Using state instead of ref so we can block builds until hasher is ready
  const [xxhasher, setXxhasher] = useState<XXHashAPI | null>(null)
  useEffect(() => {
    xxhashInit().then(setXxhasher)
  }, [])

  useEffect(() => {
    runIdRef.current = runId
  }, [runId])

  useEffect(() => {
    if (!runStorageKey) return
    const stored = localStorage.getItem(runStorageKey)
    if (!stored) return
    try {
      const parsed = JSON.parse(stored) as {
        runId?: string
        runStatus?: 'idle' | 'running' | 'failed' | 'completed' | 'interrupted'
        runAttempt?: number
        buildTasks?: BuildTask[]
        progress?: number
        statusMessage?: string
        logs?: string[]
      }
      if (parsed.runId) setRunId(parsed.runId)
      if (parsed.runAttempt) setRunAttempt(parsed.runAttempt)
      if (parsed.runStatus) {
        const status = parsed.runStatus === 'running' ? 'interrupted' : parsed.runStatus
        setRunStatus(status)
        if (status === 'interrupted') {
          setStatusMessage('Build interrupted. You can retry to continue.')
        }
      }
      if (parsed.buildTasks) setBuildTasks(parsed.buildTasks)
      if (typeof parsed.progress === 'number') setProgress(parsed.progress)
      if (parsed.statusMessage && parsed.runStatus !== 'running') setStatusMessage(parsed.statusMessage)
      if (parsed.logs) setLogs(parsed.logs)
    } catch {
      // ignore malformed state
    }
  }, [runStorageKey])

  useEffect(() => {
    if (hasHydratedRemote) return
    if (!latestBuilderRun) return
    if (runId) {
      setHasHydratedRemote(true)
      return
    }

    setRunId(latestBuilderRun.runId ?? null)
    setRunAttempt(latestBuilderRun.attempt ?? 0)
    const status = latestBuilderRun.status === 'running' ? 'interrupted' : latestBuilderRun.status
    setRunStatus(status ?? 'idle')
    if (status === 'interrupted') {
      setStatusMessage('Build interrupted. You can retry to continue.')
    } else if (latestBuilderRun.statusMessage) {
      setStatusMessage(latestBuilderRun.statusMessage)
    }
    if (latestBuilderRun.tasks) setBuildTasks(latestBuilderRun.tasks as BuildTask[])
    if (typeof latestBuilderRun.progress === 'number') setProgress(latestBuilderRun.progress)
    if (latestBuilderRun.logs) setLogs(latestBuilderRun.logs)
    setHasHydratedRemote(true)
  }, [hasHydratedRemote, latestBuilderRun, runId])

  useEffect(() => {
    if (!runStorageKey) return
    const payload = {
      runId,
      runStatus,
      runAttempt,
      buildTasks,
      progress,
      statusMessage,
      logs,
      updatedAt: Date.now(),
    }
    localStorage.setItem(runStorageKey, JSON.stringify(payload))
  }, [runStorageKey, runId, runStatus, runAttempt, buildTasks, progress, statusMessage, logs])

  // Check if we need to auto-pull (cloud files exist, no local folder)
  useEffect(() => {
    if (!project || projectFiles === undefined || autoPullTriggeredRef.current) return
    if (isAIGenerating || isPulling) return

    const checkAndAutoPull = async () => {
      const hasCloudFiles = projectFiles && projectFiles.length > 0
      if (!hasCloudFiles) return

      // Check if local folder exists
      const folderExists = await window.electronAPI.project.exists(project.slug)

      if (!folderExists) {
        addLog('Cloud files found but no local folder - auto-pulling...')
        autoPullTriggeredRef.current = true
        await pullFilesFromCloud()
      }
    }

    checkAndAutoPull()
  }, [project, projectFiles])

  // Start build automatically when project loads (only if no cloud files to pull)
  useEffect(() => {
    // Wait for hasher to be ready before starting build (needed for checksums)
    if (project && !isPulling && !isAIGenerating && runStatus === 'idle' && xxhasher) {
      // Only auto-start if there are no cloud files (otherwise auto-pull handles it)
      if (projectFiles !== undefined && projectFiles.length === 0) {
        // Always use AI build - the AI will handle file generation
        startAIBuild()
      }
    }
  }, [project, projectFiles, isAIGenerating, runStatus, isPulling, xxhasher])

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, `[${timestamp}] ${message}`])
  }

  // AI Generation handlers
  const handleTasksUpdate = useCallback((tasks: BuildTask[]) => {
    setBuildTasks(tasks)

    // Calculate progress from task completion
    const completed = tasks.filter(t => t.status === 'completed').length
    const total = tasks.length
    const newProgress = total > 0 ? Math.round((completed / total) * 100) : 0
    setProgress(newProgress)

    // Update status message based on current task
    const inProgress = tasks.find(t => t.status === 'in_progress')
    if (inProgress) {
      setStatusMessage(inProgress.activeForm)
    }

    if (!project?._id || !runIdRef.current) return
    void checkpointBuilderRun({
      projectId: project._id,
      runId: runIdRef.current,
      tasks,
      progress: newProgress,
      statusMessage: inProgress?.activeForm,
    })
  }, [checkpointBuilderRun, project?._id])

  const handleAIComplete = useCallback(async () => {
    addLog('AI generation complete!')
    setIsAIGenerating(false)
    setStatusMessage('Build complete!')
    setRunStatus('completed')

    if (project?._id && runIdRef.current) {
      try {
        await updateBuilderRunStatus({
          projectId: project._id,
          runId: runIdRef.current,
          status: 'completed',
          statusMessage: 'Build complete!',
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Failed to update run status: ${message}`)
      }
    }

    // Initialize Yjs document with created files and save snapshot
    if (project?._id && createdFilesRef.current.length > 0) {
      try {
        addLog('Initializing Yjs document...')
        const yjsDoc = new YjsProjectDoc(project._id)

        for (const file of createdFilesRef.current) {
          yjsDoc.initializeFile(file.path, file.content)
        }

        // Save snapshot
        const snapshot = Y.encodeStateAsUpdate(yjsDoc.doc)
        // Create a clean ArrayBuffer copy to avoid SharedArrayBuffer type issues
        const snapshotBuffer = new ArrayBuffer(snapshot.byteLength)
        new Uint8Array(snapshotBuffer).set(snapshot)
        await saveYjsSnapshot({
          projectId: project._id,
          snapshot: snapshotBuffer,
          version: 1,
        })

        yjsDoc.destroy()
        addLog(`Yjs snapshot saved with ${createdFilesRef.current.length} files`)
        createdFilesRef.current = [] // Clear for next build
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Failed to save Yjs snapshot: ${message}`)
      }
    }

    // Update project status to active
    if (project?._id) {
      await updateStatus({ projectId: project._id, status: 'active' })
      addLog('Project status updated to active')
    }
  }, [project?._id, updateStatus, updateBuilderRunStatus, saveYjsSnapshot])

  const handleAIError = useCallback((error: string) => {
    addLog(`AI Error: ${error}`)
    setHasError(true)
    setStatusMessage(`Generation failed: ${error}`)
    setIsAIGenerating(false)
    setRunStatus('failed')
    if (project?._id && runIdRef.current) {
      void updateBuilderRunStatus({
        projectId: project._id,
        runId: runIdRef.current,
        status: 'failed',
        errorMessage: error,
        statusMessage: `Generation failed: ${error}`,
      })
    }
  }, [project?._id, updateBuilderRunStatus])

  const handleAIStop = useCallback(() => {
    setIsAIGenerating(false)
    setHasError(true)
    setRunStatus('interrupted')
    setStatusMessage('Build stopped')
    addLog('Build stopped by user')
    if (project?._id && runIdRef.current) {
      void updateBuilderRunStatus({
        projectId: project._id,
        runId: runIdRef.current,
        status: 'interrupted',
        statusMessage: 'Build stopped',
      })
    }
  }, [addLog, project?._id, updateBuilderRunStatus])

  // Start AI-powered build
  const startAIBuild = async () => {
    if (!project || !convexUserId) return

    const newRunId = crypto.randomUUID()
    const nextAttempt = runAttempt + 1
    setRunId(newRunId)
    setRunStatus('running')
    setRunAttempt(nextAttempt)
    runIdRef.current = newRunId
    // Note: setIsAIGenerating is called AFTER startBuilderRun completes
    // to avoid race condition where checkpointBuilderRun is called before the run exists
    setHasError(false)
    setBuildTasks([])
    setProgress(0)
    createdFilesRef.current = [] // Clear tracked files for fresh build
    addLog(`Starting AI build for project: ${project.name}`)
    addLog(`Template: ${project.template || 'custom'}`)
    addLog(`Pages: ${project.generatedPlan?.pages?.length || 0}`)
    addLog(`Entities: ${project.generatedPlan?.entities?.length || 0}`)
    setStatusMessage('AI is analyzing your project plan...')

    try {
      await updateStatus({ projectId: project._id, status: 'building' })
      addLog('Project status updated to building')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Failed to set status to building: ${message}`)
    }

    // Ensure local folder exists
    let path = project.localPath
    if (!path) {
      addLog('Creating local project folder...')
      try {
        const result = await window.electronAPI.project.createFolder({
          slug: project.slug,
          initGit: true,
        })

        if (!result.success || !result.localPath) {
          throw new Error(result.error || 'Failed to create project folder')
        }

        path = result.localPath
        setLocalPath(path)
        addLog(`Created folder at: ${path}`)

        // Save the local path to Convex
        await updateLocalPath({
          projectId: project._id,
          localPath: path,
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Error: ${errorMessage}`)
        setHasError(true)
        setIsAIGenerating(false)
        setStatusMessage('Setup failed')
        return
      }
    } else {
      setLocalPath(path)
      addLog(`Using existing folder: ${path}`)
    }

    try {
      await startBuilderRun({
        projectId: project._id,
        userId: convexUserId,
        runId: newRunId,
        attempt: nextAttempt,
        localPath: path ?? undefined,
      })
      addLog('Builder run initialized in Convex')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Failed to persist builder run: ${message}`)
      // Continue anyway - checkpointing will silently fail but build will work
    }

    // BuilderConversation component will handle the rest
    addLog('Starting AI code generation...')

    // Set AI generating state AFTER run is created to avoid race condition
    // where checkpointBuilderRun is called before the run exists
    setIsAIGenerating(true)
  }

  const uploadFileToCloud = useCallback(async (
    file: { path: string; content: string }
  ) => {
    if (!project || !convexUserId) return

    try {
      // Compute checksum using same algorithm as electron main process
      // Hasher should always be available since build waits for it
      if (!xxhasher) {
        addLog(`Warning: Hasher not ready for ${file.path}, checksum will be empty`)
      }
      const checksum = xxhasher ? await computeHash(file.content, xxhasher) : undefined

      // Determine correct MIME type based on file extension
      const mimeType = getMimeType(file.path)

      const uploadUrl = await generateUploadUrl({ projectId: project._id })
      const blob = new Blob([file.content], { type: mimeType })
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: blob,
      })
      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }
      const { storageId } = await response.json()

      const fileName = file.path.split('/').pop() || file.path
      await saveFile({
        projectId: project._id,
        userId: convexUserId,
        storageId,
        fileName,
        filePath: file.path,
        fileType: mimeType,
        sizeBytes: blob.size,
        checksum,
      })
      addLog(`Uploaded to cloud: ${file.path}`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Upload failed for ${file.path}: ${msg}`)
    }
  }, [project, convexUserId, generateUploadUrl, saveFile, addLog, xxhasher])

  const handleFileCreated = useCallback((file: { path: string; content: string }) => {
    addLog(`Created: ${file.path}`)
    // Track created files for Yjs initialization
    createdFilesRef.current.push(file)
    void uploadFileToCloud(file)
  }, [addLog, uploadFileToCloud])

  // Pull files from cloud to local folder
  const pullFilesFromCloud = async () => {
    if (!project || !projectFiles || projectFiles.length === 0) return

    setIsPulling(true)
    setPullProgress(0)
    addLog('Starting pull from cloud...')

    try {
      // 1. Create local folder if doesn't exist
      let localPath = project.localPath
      const folderExists = await window.electronAPI.project.exists(project.slug)

      if (!folderExists) {
        addLog('Creating local project folder...')
        const result = await window.electronAPI.project.createFolder({
          slug: project.slug,
          initGit: true,
        })
        if (!result.success || !result.localPath) {
          throw new Error(result.error || 'Failed to create folder')
        }

        localPath = result.localPath
        await updateLocalPath({ projectId: project._id, localPath })
        addLog(`Created folder at: ${localPath}`)
      } else if (!localPath) {
        // Folder exists but path not in DB - get it
        const fetchedPath = await window.electronAPI.project.getLocalPath(project.slug)
        if (fetchedPath) {
          localPath = fetchedPath
          await updateLocalPath({ projectId: project._id, localPath: fetchedPath })
        }
      }

      if (!localPath) {
        throw new Error('Could not determine local path')
      }

      // 2. Download and write each file
      const totalFiles = projectFiles.length
      for (let i = 0; i < projectFiles.length; i++) {
        const file = projectFiles[i]
        if (!file.url) {
          addLog(`Skipping ${file.filePath} - no download URL`)
          continue
        }

        addLog(`Pulling: ${file.filePath}`)

        // Download file content from Convex storage URL
        const response = await fetch(file.url)
        if (!response.ok) throw new Error(`Failed to download ${file.filePath}`)
        const content = await response.text()

        // Write to local folder
        await window.electronAPI.project.writeFile({
          projectPath: localPath,
          filePath: file.filePath,
          content,
        })

        addLog(`Saved: ${file.filePath}`)
        setPullProgress(Math.round(((i + 1) / totalFiles) * 100))
      }

      addLog(`Pull complete! ${totalFiles} files synced.`)
      setStatusMessage('Files synced from cloud')
      setRunStatus('completed')
      setProgress(100)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Pull failed: ${msg}`)
      setHasError(true)
      setStatusMessage('Pull failed')
    } finally {
      setIsPulling(false)
    }
  }

  const handleRetry = () => {
    setHasError(false)
    setBuildTasks([])
    setProgress(0)
    setLogs([])
    setRunStatus('idle')
    // Always use AI build
    startAIBuild()
  }

  const handleOpenProject = async () => {
    if (!project?.localPath) {
      addLog('Error: Project folder path not set')
      return
    }
    addLog('Opening project folder...')
    // Open folder in system file manager
    await window.electronAPI.shell.openExternal(`file://${project.localPath}`)
  }

  const handleCancelProject = async () => {
    if (!project?._id || !convexUserId || !window.confirm('Are you sure you want to cancel and delete this project? This action cannot be undone.')) return

    try {
      await deleteProject({
        projectId: project._id,
        userId: convexUserId,
        confirmName: project.name
      })
      navigate('/projects')
    } catch (error) {
      console.error('Failed to delete project:', error)
      setStatusMessage('Failed to delete project')
    }
  }

  // Loading state
  if (project === undefined) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: 'Loading...' },
        ]}
      >
        <div className="h-full flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  // Project not found
  if (project === null) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[
          { label: 'Projects', href: '/projects' },
          { label: 'Not Found' },
        ]}
      >
        <div className="h-full flex flex-col items-center justify-center gap-4">
          <div className="text-foreground text-lg">Project not found</div>
          <Button variant="outline" onClick={() => navigate('/projects')}>
            Back to Projects
          </Button>
        </div>
      </DashboardLayout>
    )
  }

  const headerContent = (
    <div className="flex items-center justify-between gap-4 w-full">
      {/* Left Side: Icon + Status Message */}
      <div className="flex items-center gap-3">
        {/* Status Icon */}
        <div className="shrink-0">
          {isPulling ? (
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Download className="h-4 w-4 text-blue-500 animate-pulse" />
            </div>
          ) : hasError ? (
            <div className="w-8 h-8 rounded-full bg-destructive/20 flex items-center justify-center">
              <AlertCircle className="h-4 w-4 text-destructive" />
            </div>
          ) : isAIComplete ? (
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Check className="h-4 w-4 text-emerald-500" />
            </div>
          ) : isAIGenerating ? (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <Circle className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>

        {/* Status Message */}
        <h2 className="text-sm font-semibold truncate">
          {isPulling ? 'Syncing from cloud...' : statusMessage}
        </h2>
      </div>

      {/* Right Side: Actions */}
      <div className="flex items-center gap-2">
        {isAIGenerating && !hasError && !isPulling && (
          <Button variant="outline" size="sm" onClick={handleAIStop} className="h-8 gap-2">
            <Square className="h-3.5 w-3.5" />
            Stop
          </Button>
        )}

        {isAIComplete && !isPulling && !isAIGenerating && (
          <ButtonGroup>
            <Button
              variant="outline"
              size="sm"
              onClick={pullFilesFromCloud}
              className="h-8 gap-2 rounded-r-none border-r-0 focus:z-10"
            >
              <Download className="h-3.5 w-3.5" />
              Pull
            </Button>
            <Button
              size="sm"
              onClick={handleOpenProject}
              className="h-8 gap-2 rounded-l-none focus:z-10"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Open Project
            </Button>
          </ButtonGroup>
        )}

        {hasError && !isPulling && (
          <ButtonGroup>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
              className="h-8 gap-2 rounded-r-none border-r-0 focus:z-10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCancelProject}
              className="h-8 gap-2 rounded-l-none focus:z-10"
            >
              <Trash className="h-3.5 w-3.5" />
              Cancel Project
            </Button>
          </ButtonGroup>
        )}

        {!isAIGenerating && !isAIComplete && !hasError && !isPulling && (
          <Button size="sm" onClick={startAIBuild} className="h-8 gap-2">
            <Sparkles className="h-3.5 w-3.5" />
            Start AI Build
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: project.name },
        { label: 'Build' },
      ]}
      header={headerContent}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Progress Bar - Pulling (Moved from header) */}
        {isPulling && (
          <div className="px-6 py-4 border-b">
            <div className="max-w-md">
              <Progress value={pullProgress} className="h-1.5" />
              <p className="text-xs text-muted-foreground mt-1.5">{pullProgress}% synced</p>
            </div>
          </div>
        )}

        {/* Logs and Files Section */}
        <div className="flex-1 flex overflow-hidden">
          {/* Logs Panel / AI Conversation */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {localPath && project && (
              <div className="flex-1 overflow-hidden">
                <BuilderConversation
                  project={project}
                  localPath={localPath}
                  onTasksUpdate={handleTasksUpdate}
                  onFileCreated={handleFileCreated}
                  onComplete={handleAIComplete}
                  onError={handleAIError}
                  className="h-full"
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </DashboardLayout>
  )
}
