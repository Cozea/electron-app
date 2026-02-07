import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
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

interface FileViewerProps {
  path: string
}

export function FileViewer({ path }: FileViewerProps) {
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const editorActions = useEditorStore((state) => state.actions)
  const model = useEditorStore((state) => state.models[path])
  const syncContext = useOptionalProjectSyncContext()

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [projectPath, setProjectPath] = useState<string | null>(null)
  const [editorReady, setEditorReady] = useState(false)

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
  }, [editorReady, searchParams, path])

  // Always get projectPath for breadcrumb (even if model exists)
  useEffect(() => {
    const getProjectPath = async () => {
      const localPath =
        syncContext?.projectPath ??
        (slug ? await window.electronAPI.project.getLocalPath(slug) : null)
      if (localPath) {
        setProjectPath(localPath)
      }
    }
    getProjectPath()
  }, [syncContext?.projectPath, slug])

  // Load file content when path changes and model doesn't exist
  useEffect(() => {
    let mounted = true

    const loadFile = async () => {
      if (model) return

      try {
        setIsLoading(true)
        setError(null)

        const localPath =
          syncContext?.projectPath ??
          (slug ? await window.electronAPI.project.getLocalPath(slug) : null)
        if (!localPath) {
          if (mounted) setError('Project folder not found')
          return
        }

        // Store project path for breadcrumb
        if (mounted) setProjectPath(localPath)

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

        if (!mounted) return

        if (!result.success) {
          setError(result.error || 'Failed to read file')
          return
        }

        if (typeof result.content === 'string') {
          editorActions.openFile(path, result.content, localPath)
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load file')
        }
      } finally {
        if (mounted) {
          setIsLoading(false)
        }
      }
    }

    loadFile()

    return () => {
      mounted = false
    }
  }, [path, syncContext?.projectPath, slug, model, editorActions])

  const handleRetry = () => {
    setError(null)
    // Force re-load by clearing any existing model
    editorActions.closeFile(path)
  }

  // Loading state
  if (isLoading || (!model && !error)) {
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
        path={path}
        editorRef={editorRef}
        projectPath={projectPath}
        editorReady={editorReady}
      />
      <div className="flex-1 min-h-0">
        <MonacoEditor path={path} onEditorReady={handleEditorReady} />
      </div>
    </div>
  )
}
