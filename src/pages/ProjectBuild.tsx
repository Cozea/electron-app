import { useParams } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useQuery, useMutation } from 'convex/react'
import * as Y from 'yjs'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { DashboardLayout } from '@/components/layouts/DashboardLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable'
import { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

import {
  Monitor,
  MonitorOff,
} from 'lucide-react'
import type { BuildTask } from '@/components/builder/BuildTaskList'
import { BuilderConversation } from '@/components/builder/BuilderConversation'
import { BuildPreviewPanel } from '@/components/builder/BuildPreviewPanel'
import { BuilderControlsPill } from '@/components/builder/BuilderControlsPill'
import { BillingError, type BillingErrorData } from '@/components/assistant/BillingError'
import { useDevServerManager } from '@/hooks/useDevServerManager'
import {
  summarizeLintDiagnostics,
  type PipelineDiagnostic,
  type ToolDiagnosticsSummary,
} from '@/lib/diagnostics/toolDiagnosticsPipeline'
import { ensureProjectRuntimeToolchains, runtimeLabel } from '@/lib/runtime/projectRuntimePreflight'

function formatCount(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function formatLintSummary(summary: ToolDiagnosticsSummary): string {
  const parts: string[] = []
  if (summary.errors > 0) parts.push(formatCount(summary.errors, 'error'))
  if (summary.warnings > 0) parts.push(formatCount(summary.warnings, 'warning'))
  if (summary.infos > 0) parts.push(formatCount(summary.infos, 'info'))
  return parts.length > 0 ? parts.join(', ') : 'no issues'
}

function formatDiagnosticLocation(file: string, line?: number, column?: number): string {
  if (line && column) return `${file}:${line}:${column}`
  if (line) return `${file}:${line}`
  return file
}

export function ProjectBuild() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useViewTransitionNavigate()
  const { user, logout, convexUserId } = useAuth()

  // Load project from Convex
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId: projectId as Id<'projects'> } : 'skip'
  )

  const memberLocalPath = useQuery(
    api.projectMembers.getMemberLocalPath,
    project?._id && convexUserId ? { projectId: project._id, userId: convexUserId } : 'skip'
  )

  const latestBuilderRun = useQuery(
    api.builderRuns.getLatestForProject,
    project?._id ? { projectId: project._id } : 'skip'
  )

  // Mutations
  const updateStatus = useMutation(api.projects.updateStatus)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)
  const startBuilderRun = useMutation(api.builderRuns.startRun)
  const checkpointBuilderRun = useMutation(api.builderRuns.checkpointRun)
  const updateBuilderRunStatus = useMutation(api.builderRuns.updateRunStatus)
  const deleteProject = useMutation(api.projects.deleteProject)
  const saveYjsSnapshot = useMutation(api.yjs.saveSnapshot)
  const generatePreviewUploadUrl = useMutation(api.projects.generatePreviewUploadUrl)
  const updatePreviewImage = useMutation(api.projects.updatePreviewImage)

  // Build state
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('Preparing to build...')
  const [hasError, setHasError] = useState(false)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [logs, setLogs] = useState<string[]>([])

  // Pull state
  const [isPulling, setIsPulling] = useState(false)
  const [pullProgress, setPullProgress] = useState(0)
  const autoPullTriggeredRef = useRef(false)

  // AI Generation state
  const [isAIGenerating, setIsAIGenerating] = useState(false)
  const [buildTasks, setBuildTasks] = useState<BuildTask[]>([])
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'failed' | 'completed' | 'interrupted'>('idle')
  const [runAttempt, setRunAttempt] = useState(0)
  const [stopRequestCount, setStopRequestCount] = useState(0)
  const [hasHydratedRemote, setHasHydratedRemote] = useState(false)
  const runIdRef = useRef<string | null>(null)

  const isAIComplete = runStatus === 'completed' || (buildTasks.length > 0 && buildTasks.every(t => t.status === 'completed'))
  const runStorageKey = projectId ? `builderRun:${projectId}` : null

  // Track files created during build for Yjs initialization
  const createdFilesRef = useRef<Array<{ path: string; content: string }>>([])

  // Preview panel state
  const [showPreview, setShowPreview] = useState(true)

  // Detect when dependency installation completes by checking build tasks.
  const dependencyInstallComplete = useMemo(() => {
    if (buildTasks.length === 0) return false
    return buildTasks.some(
      (task) =>
        task.status === 'completed' &&
        (task.content.toLowerCase().includes('install') ||
          task.content.toLowerCase().includes('dependencies'))
    )
  }, [buildTasks])

  // Dev server manager starts after dependency installation completes.
  const devServer = useDevServerManager({
    projectPath: dependencyInstallComplete ? localPath : null,
    autoStart: dependencyInstallComplete && isAIGenerating,
  })

  useEffect(() => {
    if (memberLocalPath && memberLocalPath !== localPath) {
      setLocalPath(memberLocalPath)
    }
  }, [memberLocalPath, localPath])

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

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    setLogs(prev => [...prev, `[${timestamp}] ${message}`])
  }, [])

  // Log dev server status changes
  useEffect(() => {
    if (devServer.status === 'ready' && devServer.url) {
      addLog(`Dev server ready at ${devServer.url}`)
    } else if (devServer.status === 'error' && devServer.error) {
      addLog(`Dev server error: ${devServer.error}`)
    } else if (devServer.status === 'starting') {
      addLog('Starting dev server...')
    }
  }, [addLog, devServer.status, devServer.url, devServer.error])

  // Capture and upload preview screenshot
  const capturePreviewScreenshot = useCallback(async () => {
    if (!devServer.url || !project?._id) return

    addLog('Capturing preview screenshot...')

    try {
      // Capture screenshot via Electron IPC
      const result = await window.electronAPI.preview.captureScreenshot({
        url: devServer.url,
        width: 1280,
        height: 800,
      })

      if (!result.success || !result.base64) {
        throw new Error(result.error || 'Screenshot capture failed')
      }

      addLog('Screenshot captured, uploading...')

      // Convert base64 to blob
      const byteString = atob(result.base64)
      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
      }
      const blob = new Blob([ab], { type: 'image/png' })

      // Upload to Convex
      const uploadUrl = await generatePreviewUploadUrl({ projectId: project._id })
      const uploadResponse = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: blob,
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload screenshot')
      }

      const { storageId } = await uploadResponse.json()

      // Update project with preview image
      await updatePreviewImage({
        projectId: project._id,
        storageId,
      })

      addLog('Preview screenshot saved!')
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Screenshot capture failed: ${msg}`)
    }
  }, [devServer.url, project?._id, generatePreviewUploadUrl, updatePreviewImage, addLog])

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
    setHasError(false) // Clear any stale error state from recovered errors
    let completionStatusMessage = 'Build complete!'

    if (localPath && window.electronAPI?.diagnostics) {
      try {
        const snapshot = await window.electronAPI.diagnostics.getSnapshot({ projectPath: localPath })
        if (!snapshot.success) {
          if (snapshot.error) {
            addLog(`Final diagnostics unavailable: ${snapshot.error}`)
          }
        } else {
          const diagnostics = Array.isArray(snapshot.diagnostics)
            ? snapshot.diagnostics as PipelineDiagnostic[]
            : []
          const summary = summarizeLintDiagnostics({
            projectPath: localPath,
            diagnostics,
            maxItems: 8,
          })

          if (summary) {
            const summaryText = formatLintSummary(summary)
            addLog(`Final diagnostics: ${summaryText}`)
            summary.items.forEach((item) => {
              const location = formatDiagnosticLocation(item.file, item.line, item.column)
              const code = item.code ? ` (${item.code})` : ''
              addLog(`- [${item.source}] ${item.severity.toUpperCase()} ${location}: ${item.message}${code}`)
            })
            if (summary.truncated) {
              addLog(`...and ${summary.total - summary.items.length} more diagnostics`)
            }
            if (summary.errors > 0 || summary.warnings > 0) {
              completionStatusMessage = `Build complete with ${summaryText}`
            }
          } else {
            addLog('Final diagnostics: no TypeScript or ESLint issues detected')
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Final diagnostics check failed: ${message}`)
      }
    }

    setStatusMessage(completionStatusMessage)
    setRunStatus('completed')

    if (project?._id && runIdRef.current) {
      try {
        await updateBuilderRunStatus({
          projectId: project._id,
          runId: runIdRef.current,
          status: 'completed',
          statusMessage: completionStatusMessage,
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

    // Capture preview screenshot if dev server is ready
    // Use a small delay to ensure the app has rendered
    if (devServer.status === 'ready' && devServer.url) {
      setTimeout(() => {
        capturePreviewScreenshot()
      }, 2000)
    }
  }, [addLog, localPath, project?._id, updateStatus, updateBuilderRunStatus, saveYjsSnapshot, devServer.status, devServer.url, capturePreviewScreenshot])

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
  }, [addLog, project?._id, updateBuilderRunStatus])

  const handleAIStop = useCallback(() => {
    setStopRequestCount((prev) => prev + 1)
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
  const startAIBuild = useCallback(async () => {
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
    setStatusMessage('Preparing build environment...')

    try {
      await updateStatus({ projectId: project._id, status: 'building' })
      addLog('Project status updated to building')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Failed to set status to building: ${message}`)
    }

    // Ensure local folder exists
    let path = localPath
    try {
      const folderExists = await window.electronAPI.project.exists(project.slug)

      if (!folderExists) {
        addLog('Creating local project folder...')
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

        // Save the local path to Convex (per-user, per-machine)
        await updateMemberLocalPath({
          projectId: project._id,
          userId: convexUserId,
          localPath: path,
        })
      } else if (!path) {
        const fetchedPath = await window.electronAPI.project.getLocalPath(project.slug)
        if (fetchedPath) {
          path = fetchedPath
          setLocalPath(path)
          await updateMemberLocalPath({
            projectId: project._id,
            userId: convexUserId,
            localPath: fetchedPath,
          })
        }
      }

      if (!path) {
        throw new Error('Could not determine local path')
      }

      addLog(`Using folder: ${path}`)

      const preflight = await ensureProjectRuntimeToolchains(path, (progress) => {
        setStatusMessage(progress.message)
      })

      if (!preflight.success) {
        const failedLabel = preflight.failedRuntime ? runtimeLabel(preflight.failedRuntime) : 'required'
        throw new Error(preflight.error || `${failedLabel} runtime is unavailable.`)
      }

      if (preflight.required.length > 0) {
        const installedNames = preflight.installed.map(runtimeLabel)
        if (installedNames.length > 0) {
          addLog(`Installed runtimes: ${installedNames.join(', ')}`)
        } else {
          addLog('Runtime check passed (already available).')
        }
      }

      setStatusMessage('AI is analyzing your project plan...')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      addLog(`Error: ${errorMessage}`)
      setHasError(true)
      setIsAIGenerating(false)
      setStatusMessage('Setup failed')
      return
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
  }, [
    addLog,
    convexUserId,
    localPath,
    project,
    runAttempt,
    startBuilderRun,
    updateMemberLocalPath,
    updateStatus,
  ])

  const enqueueReplicaSnapshot = useCallback(
    async (reason: string, source: 'agent' | 'user' | 'external' = 'agent') => {
      if (!project?._id || !localPath) return
      try {
        const result = await window.electronAPI.sync.gitReplicaEnqueueSnapshot({
          projectId: String(project._id),
          projectPath: localPath,
          source,
          reason,
        })
        if (result.success) {
          addLog(`Replica snapshot queued (${result.queued} pending)`)
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Replica snapshot enqueue failed: ${msg}`)
      }
    },
    [addLog, localPath, project?._id]
  )

  const handleFileCreated = useCallback((file: { path: string; content: string }) => {
    addLog(`Created: ${file.path}`)
    // Track created files for Yjs initialization
    createdFilesRef.current.push(file)
    void enqueueReplicaSnapshot(`builder-created:${file.path}`, 'agent')
  }, [addLog, enqueueReplicaSnapshot])

  // Pull files from canonical Git replica to local folder
  const pullFilesFromCloud = useCallback(async () => {
    if (!project || !convexUserId) return

    setIsPulling(true)
    setPullProgress(0)
    addLog('Starting pull from canonical replica...')

    try {
      // 1. Ensure local folder exists.
      let targetPath = localPath
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

        targetPath = result.localPath
        setLocalPath(targetPath)
        await updateMemberLocalPath({
          projectId: project._id,
          userId: convexUserId,
          localPath: targetPath,
        })
        addLog(`Created folder at: ${targetPath}`)
      } else if (!targetPath) {
        // Folder exists but path not in DB - get it
        const fetchedPath = await window.electronAPI.project.getLocalPath(project.slug)
        if (fetchedPath) {
          targetPath = fetchedPath
          setLocalPath(targetPath)
          await updateMemberLocalPath({
            projectId: project._id,
            userId: convexUserId,
            localPath: fetchedPath,
          })
        }
      }

      if (!targetPath) {
        throw new Error('Could not determine local path')
      }

      setPullProgress(20)
      const bootstrap = await window.electronAPI.sync.gitReplicaBootstrap({
        projectId: String(project._id),
        projectPath: targetPath,
      })
      if (!bootstrap.success) {
        throw new Error(bootstrap.error || 'Failed to bootstrap replica')
      }

      setPullProgress(45)
      const plan = await window.electronAPI.sync.gitReplicaPlan({
        projectId: String(project._id),
        projectPath: targetPath,
      })
      if (!plan.success) {
        throw new Error(plan.error || 'Failed to plan replica sync')
      }

      const totalChanges =
        plan.downloads.length +
        plan.uploads.length +
        plan.localDeletes.length +
        plan.cloudDeletes.length +
        plan.autoMerged.length +
        plan.conflicts.length

      if (totalChanges === 0) {
        setPullProgress(100)
        addLog('Replica already up to date.')
        setStatusMessage('Files synced from replica')
        setRunStatus('completed')
        setProgress(100)
        return
      }

      const conflictDecisions = Object.fromEntries(
        plan.conflicts.map((conflict) => [conflict.path, 'cloud' as const])
      )

      setPullProgress(75)
      const execute = await window.electronAPI.sync.gitReplicaExecute({
        projectId: String(project._id),
        projectPath: targetPath,
        sessionId: plan.sessionId,
        conflictDecisions,
      })
      if (!execute.success) {
        throw new Error(execute.error || 'Replica apply failed')
      }
      if (execute.requiresConflictResolution) {
        throw new Error('Replica pull requires conflict resolution')
      }
      if (!execute.applied) {
        throw new Error('Replica pull did not apply changes')
      }

      setPullProgress(100)
      addLog(`Pull complete from replica (${totalChanges} change(s)).`)
      setStatusMessage('Files synced from replica')
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
  }, [
    addLog,
    convexUserId,
    localPath,
    project,
    updateMemberLocalPath,
  ])

  // Resolve initial flow: pull existing replica state if needed, otherwise start AI build.
  useEffect(() => {
    if (!project || autoPullTriggeredRef.current) return
    if (!convexUserId) return
    if (isAIGenerating || isPulling || runStatus !== 'idle') return

    let cancelled = false

    const resolveInitialAction = async () => {
      try {
        const folderExists = await window.electronAPI.project.exists(project.slug)
        if (cancelled) return

        const status = await window.electronAPI.sync.gitReplicaStatus({
          projectId: String(project._id),
        })
        if (cancelled) return

        const hasCanonicalReplica = Boolean(status.success && status.canonicalHeadCommit)
        if (hasCanonicalReplica && !folderExists) {
          addLog('Replica state found but no local folder - auto-pulling...')
          autoPullTriggeredRef.current = true
          await pullFilesFromCloud()
          return
        }

        if (!hasCanonicalReplica) {
          addLog('No canonical replica state found - starting new build...')
          autoPullTriggeredRef.current = true
          await startAIBuild()
        }
      } catch (error) {
        if (cancelled) return
        const msg = error instanceof Error ? error.message : 'Unknown error'
        addLog(`Initial replica check failed (${msg}) - starting build...`)
        autoPullTriggeredRef.current = true
        await startAIBuild()
      }
    }

    void resolveInitialAction()
    return () => {
      cancelled = true
    }
  }, [project, convexUserId, isAIGenerating, isPulling, runStatus, addLog, pullFilesFromCloud, startAIBuild])

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
    if (!project) return

    // Stop the dev server before navigating away
    if (devServer.isRunning) {
      addLog('Stopping dev server...')
      await devServer.stop()
    }

    // Navigate to the project page (same as clicking a project card)
    navigate(`/projects/${project.slug}`)
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

  const isProjectLoading = project === undefined
  const isProjectMissing = project === null

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Projects', href: '/projects' },
        { label: isProjectLoading ? 'Loading...' : isProjectMissing || !project ? 'Not Found' : project.name },
        ...(isProjectLoading || isProjectMissing || !project ? [] : [{ label: 'Build' }]),
      ]}
      header={!isProjectLoading && !isProjectMissing ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPreview((prev) => !prev)}
          className="h-8 gap-2 text-xs"
        >
          {showPreview ? (
            <>
              <MonitorOff className="h-3.5 w-3.5" />
              Hide Preview
            </>
          ) : (
            <>
              <Monitor className="h-3.5 w-3.5" />
              Show Preview
            </>
          )}
        </Button>
      ) : undefined}
      headerContentInsetClassName="pt-11"
      contentMode="fixed"
    >
      {isProjectLoading ? (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          Loading project...
        </div>
      ) : isProjectMissing || !project ? (
        <div className="h-full flex flex-col items-center justify-center gap-4">
          <div className="text-foreground text-lg">Project not found</div>
          <Button variant="outline" onClick={() => navigate('/projects')}>
            Back to Projects
          </Button>
        </div>
      ) : (
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

        {/* Split Pane Layout: Builder Conversation + Live Preview */}
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup orientation="horizontal" className="h-full w-full" id="builder-panels">
            {/* Builder Conversation Panel - Left Side */}
            <ResizablePanel defaultSize={showPreview ? 40 : 100} minSize={25} id="builder-conversation" className="min-w-0">
              <div className="h-full w-full flex flex-col overflow-hidden bg-background">
                <div className="flex-1 min-h-0 relative">
                  {localPath && project ? (
                    <BuilderConversation
                      project={project}
                      localPath={localPath}
                      stopRequestCount={stopRequestCount}
                      onTasksUpdate={handleTasksUpdate}
                      onFileCreated={handleFileCreated}
                      onComplete={handleAIComplete}
                      onError={handleAIError}
                      onBillingError={setBillingError}
                      className="h-full"
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      <p>Loading project...</p>
                    </div>
                  )}
                  {/* Floating Controls Pill */}
                  <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-col gap-2">
                    {billingError && (
                      <BillingError
                        error={billingError}
                        className="mx-auto w-full max-w-2xl"
                      />
                    )}
                    <BuilderControlsPill
                      statusMessage={statusMessage}
                      isAIGenerating={isAIGenerating}
                      isAIComplete={isAIComplete}
                      hasError={hasError}
                      isPulling={isPulling}
                      buildTasks={buildTasks}
                      onStop={handleAIStop}
                      onRetry={handleRetry}
                      onPull={pullFilesFromCloud}
                      onOpenProject={handleOpenProject}
                      onStartBuild={startAIBuild}
                      onCancelProject={handleCancelProject}
                    />
                  </div>
                </div>
              </div>
            </ResizablePanel>

            {/* Resize Handle and Preview Panel (hidden if not showPreview) */}
            {showPreview && (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={60} minSize={30} id="builder-preview" className="min-w-0">
                  <BuildPreviewPanel
                    status={devServer.status}
                    url={devServer.url}
                    error={devServer.error}
                    onRefresh={devServer.restart}
                    onCapture={capturePreviewScreenshot}
                    className="h-full relative sidebar-fade-border sidebar-fade-border-left"
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
        </div>
      )}
    </DashboardLayout>
  )
}
