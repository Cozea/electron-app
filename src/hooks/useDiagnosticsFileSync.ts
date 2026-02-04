import { useEffect, useRef } from 'react'

interface UseDiagnosticsFileSyncOptions {
  projectPath?: string
  filePath: string
  content: string
  debounceMs?: number
}

export function useDiagnosticsFileSync({
  projectPath,
  filePath,
  content,
  debounceMs = 400,
}: UseDiagnosticsFileSyncOptions) {
  const openedRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastContentRef = useRef<string | null>(null)
  const latestContentRef = useRef(content)

  useEffect(() => {
    latestContentRef.current = content
  }, [content])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.diagnostics) return
    if (!openedRef.current) {
      const initialContent = latestContentRef.current
      window.electronAPI.diagnostics.openFile({ projectPath, filePath, content: initialContent })
      openedRef.current = true
      lastContentRef.current = initialContent
    }

    return () => {
      if (!projectPath || !window.electronAPI?.diagnostics) return
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      if (openedRef.current) {
        window.electronAPI.diagnostics.closeFile({ projectPath, filePath })
        openedRef.current = false
      }
    }
  }, [projectPath, filePath])

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.diagnostics) return
    if (!openedRef.current) return
    if (lastContentRef.current === content) return

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    debounceRef.current = setTimeout(() => {
      if (!projectPath || !window.electronAPI?.diagnostics) return
      window.electronAPI.diagnostics.updateFile({ projectPath, filePath, content })
      lastContentRef.current = content
    }, debounceMs)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [content, projectPath, filePath, debounceMs])
}
