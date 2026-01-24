import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { MonacoEditor } from '@/components/editor/MonacoEditor'
import { useEditorStore } from '@/stores/useEditorStore'
import { Loader2, AlertCircle, FileX } from 'lucide-react'
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
  const { currentOrganization } = useAuth()
  const editorActions = useEditorStore((state) => state.actions)
  const model = useEditorStore((state) => state.models[path])

  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  // Load file content when path changes and model doesn't exist
  useEffect(() => {
    let mounted = true

    const loadFile = async () => {
      if (!project?.localPath || model) return

      try {
        setIsLoading(true)
        setError(null)

        const localPath = project.localPath || await window.electronAPI.project.getLocalPath(project.slug)
        if (!localPath) {
          if (mounted) setError('Project folder not found')
          return
        }

        // Convert absolute path to relative path by removing the project folder prefix
        // path is absolute (e.g., /Users/foo/CrozCode Projects/my-project/src/App.tsx)
        // We need relative (e.g., src/App.tsx)
        let relativePath = path
        if (path.startsWith(localPath)) {
          relativePath = path.slice(localPath.length)
          // Remove leading slash if present
          if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
            relativePath = relativePath.slice(1)
          }
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
  }, [path, project?.localPath, model])

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

  return <MonacoEditor path={path} />
}
