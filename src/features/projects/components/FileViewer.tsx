import { useEffect, useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as monaco from 'monaco-editor'
import { MonacoEditor } from '@/components/editor/MonacoEditor'
import { EditorBreadcrumb } from '@/components/editor/EditorBreadcrumb'
import { useEditorStore } from '@/stores/useEditorStore'
import { Loader2, AlertCircle, FileX } from 'lucide-react'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { useAccessibleProject } from '@/features/projects/hooks/useAccessibleProject'

interface FileViewerProps {
  path: string
}

export function FileViewer({ path }: FileViewerProps) {
  const { project, slugParam } = useAccessibleProject()
  const [searchParams] = useSearchParams()
  const editorActions = useEditorStore((state) => state.actions)
  const model = useEditorStore((state) => state.models[path])
  const syncContext = useOptionalProjectSyncContext()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [minimapEnabled, setMinimapEnabled] = useState(true)
  const [displayPath, setDisplayPath] = useState(path)
  const [reloadToken, setReloadToken] = useState(0)
  const loadRequestIdRef = useRef(0)
  const displayModel = useEditorStore((state) => state.models[displayPath])
  const projectSlug = project?.slug ?? slugParam ?? null

  // Callback when editor is ready
  const handleEditorReady = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor
    setEditorReady(true)
  }, [])

  // Reveal position from URL params (line/column)
  useEffect(() => {
    if (!editorReady || !editorRef.current) return
    const lineParam = searchParams.get('line')
    if (!lineParam) return
    const line = Number(lineParam)
    if (!Number.isFinite(line) || line <= 0) return
    const columnParam = searchParams.get('column')
    const column = columnParam ? Number(columnParam) : 1
    const safeColumn = Number.isFinite(column) && column > 0 ? column : 1
    editorRef.current.setPosition({ lineNumber: line, column: safeColumn })
    editorRef.current.revealPositionInCenter({ lineNumber: line, column: safeColumn })
    editorRef.current.focus()
  }, [displayPath, editorReady, searchParams])

  // Always get projectPath for breadcrumb (even if model exists)
  useEffect(() => {
    const getProjectPath = async () => {
      const localPath =
        syncContext?.projectPath ??
        (projectSlug ? await window.electronAPI.project.getLocalPath(projectSlug) : null)
      if (localPath) {
        setProjectPath(localPath)
      }
    }
    getProjectPath()
  }, [projectSlug, syncContext?.projectPath])

  // Load file content when path changes and model doesn't exist
  useEffect(() => {
    const requestId = ++loadRequestIdRef.current

    const loadFile = async () => {
      if (model) {
        setDisplayPath(path)
        setError(null)
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        setError(null)

        const localPath =
          syncContext?.projectPath ??
          (projectSlug ? await window.electronAPI.project.getLocalPath(projectSlug) : null)
        if (!localPath) {
          if (requestId === loadRequestIdRef.current) {
            setError('Project folder not found')
          }
          return
        }

        // Store project path for breadcrumb
        if (requestId === loadRequestIdRef.current) {
          setProjectPath(localPath)
        }

        // Convert absolute path to relative path by removing the project folder prefix
        // path is absolute (e.g., /Users/foo/CrozCode Projects/my-project/src/App.tsx)
        // We need relative (e.g., src/App.tsx)
        const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
        const normalizedLocalPath = normalize(localPath)
        const normalizedInputPath = normalize(path)
        const isAbsolutePath =
          normalizedInputPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedInputPath)

        let relativePath = path
        if (normalizedInputPath === normalizedLocalPath) {
          relativePath = ''
        } else if (normalizedInputPath.startsWith(`${normalizedLocalPath}/`)) {
          relativePath = normalizedInputPath.slice(normalizedLocalPath.length + 1)
        } else if (isAbsolutePath) {
          setError('File path is outside the current project directory')
          return
        }

        console.log('[FileViewer] Loading file:', { localPath, path, relativePath })

        const result = await window.electronAPI.project.readFile({
          projectPath: localPath,
          filePath: relativePath,
        })

        if (requestId !== loadRequestIdRef.current) return

        if (!result.success) {
          setError(result.error || 'Failed to read file')
          return
        }

        if (typeof result.content === 'string') {
          editorActions.openFile(path, result.content, localPath)
          setDisplayPath(path)
        }
      } catch (err) {
        if (requestId === loadRequestIdRef.current) {
          setError(err instanceof Error ? err.message : 'Failed to load file')
        }
      } finally {
        if (requestId === loadRequestIdRef.current) {
          setIsLoading(false)
        }
      }
    }

    loadFile()

    return () => {
      // Guard state updates from stale async responses when rapidly switching files.
      if (loadRequestIdRef.current === requestId) {
        loadRequestIdRef.current += 1
      }
    }
  }, [path, projectSlug, syncContext?.projectPath, model, editorActions, reloadToken])

  const handleRetry = () => {
    setError(null)
    // Force re-load by clearing any existing model and bumping reload token.
    editorActions.closeFile(path)
    setReloadToken((value) => value + 1)
  }

  // Cold-start loading state (no existing editor model to keep rendered yet)
  if ((!displayModel && !error) || (isLoading && !displayModel)) {
    return (
      <Empty className="h-full bg-background">
        <EmptyHeader>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <EmptyDescription>Loading file...</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Error state
  if (error) {
    const isNotFound = error.toLowerCase().includes('not found')
    return (
      <Empty className="h-full bg-background">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-destructive/10">
            {isNotFound ? (
              <FileX className="h-8 w-8 text-destructive" />
            ) : (
              <AlertCircle className="h-8 w-8 text-destructive" />
            )}
          </EmptyMedia>
          <EmptyTitle>{isNotFound ? 'File not found' : 'Error loading file'}</EmptyTitle>
          <EmptyDescription>
            {isNotFound
              ? `The file "${path.split('/').pop()}" could not be found in the project folder.`
              : error}
          </EmptyDescription>
          <Button variant="outline" size="sm" onClick={handleRetry} className="mt-4">
            Try again
          </Button>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <EditorBreadcrumb
        path={displayPath}
        editorRef={editorRef}
        projectPath={projectPath}
        editorReady={editorReady}
        minimapEnabled={minimapEnabled}
        onToggleMinimap={() => setMinimapEnabled((prev) => !prev)}
      />
      <div className="relative flex-1 min-h-0">
        <MonacoEditor
          path={displayPath}
          onEditorReady={handleEditorReady}
          minimapEnabled={minimapEnabled}
        />
        {isLoading && displayPath !== path && (
          <div className="pointer-events-none absolute inset-x-4 top-3 z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/85 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>
                Loading {path.split('/').pop() || 'file'}...
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
