import { useEffect, useMemo } from 'react'
import * as monaco from 'monaco-editor'
import { useProblemsStore, selectProjectProblems } from '@/stores/useProblemsStore'

const normalizePath = (value: string) => value.replace(/^file:\/\//i, '').replace(/\\/g, '/')

const toMarkerSeverity = (severity: 'error' | 'warning' | 'info') => {
  switch (severity) {
    case 'warning':
      return monaco.MarkerSeverity.Warning
    case 'info':
      return monaco.MarkerSeverity.Info
    default:
      return monaco.MarkerSeverity.Error
  }
}

interface UseMonacoDiagnosticsOptions {
  projectPath?: string
  filePath: string
}

export function useMonacoDiagnostics({ projectPath, filePath }: UseMonacoDiagnosticsOptions) {
  const problemsSelector = useMemo(
    () => selectProjectProblems(projectPath ?? null),
    [projectPath]
  )
  const problems = useProblemsStore(problemsSelector)

  const markers = useMemo(() => {
    const normalizedFile = normalizePath(filePath)
    return problems
      .filter((problem) => !problem.dismissed && problem.file && normalizePath(problem.file) === normalizedFile)
      .map((problem) => {
        const startLine = problem.line ?? 1
        const startColumn = problem.column ?? 1
        const endLine = problem.endLine ?? startLine
        const endColumn = problem.endColumn ?? (problem.column ? problem.column + 1 : startColumn + 1)
        return {
          severity: toMarkerSeverity(problem.severity),
          message: problem.message,
          startLineNumber: startLine,
          startColumn,
          endLineNumber: endLine,
          endColumn,
          source: problem.source,
          code: problem.code,
        } satisfies monaco.editor.IMarkerData
      })
  }, [problems, filePath])

  useEffect(() => {
    if (!filePath) return
    const uri = monaco.Uri.file(filePath)
    const model = monaco.editor.getModel(uri)
    if (!model) return
    monaco.editor.setModelMarkers(model, 'problems', markers)
  }, [filePath, markers])
}
