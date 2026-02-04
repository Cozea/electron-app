import { useEffect, useRef } from 'react'
import { useProblemsStore } from '@/stores/useProblemsStore'

interface DiagnosticsPayload {
  projectPath: string
  source: 'tsserver' | 'eslint' | 'runtime' | 'build'
  diagnostics: Array<{
    id?: string
    source: 'tsserver' | 'eslint' | 'runtime' | 'build'
    severity: 'error' | 'warning' | 'info'
    message: string
    file?: string
    line?: number
    column?: number
    endLine?: number
    endColumn?: number
    code?: string
    related?: Array<{ message: string; file?: string; line?: number; column?: number }>
  }>
}

export function useDiagnosticsBridge(projectPath: string | null) {
  const replaceDiagnostics = useProblemsStore((state) => state.actions.replaceDiagnostics)
  const currentPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!projectPath || !window.electronAPI?.diagnostics) return

    currentPathRef.current = projectPath
    void window.electronAPI.diagnostics.start({ projectPath })

    const unsubscribe = window.electronAPI.diagnostics.onDiagnostics((payload: DiagnosticsPayload) => {
      if (payload.projectPath !== currentPathRef.current) return
      replaceDiagnostics(payload.projectPath, payload.source, payload.diagnostics)
    })

    return () => {
      unsubscribe?.()
      void window.electronAPI.diagnostics.stop({ projectPath })
      currentPathRef.current = null
    }
  }, [projectPath, replaceDiagnostics])
}
