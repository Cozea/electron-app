import { useEffect } from 'react'
import * as monaco from 'monaco-editor'
import { getService, IMarkerService } from '@codingame/monaco-vscode-api/services'
import { useProblemsStore } from '@/stores/useProblemsStore'
import { ensureVscodeServicesInitialized } from '@/lib/editor/vscodeServices'

const DIAGNOSTICS_REFRESH_EVENT_NAME = 'vscode-diagnostics:refresh'

function isDiagnosticsDebugEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.localStorage?.getItem('vscodeDiagnosticsDebug') === '1'
}

export function requestEditorDiagnosticsRefresh(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.dispatchEvent(new Event(DIAGNOSTICS_REFRESH_EVENT_NAME))
}

export function useDiagnosticsBridge(projectPath: string | null) {
  const replaceDiagnostics = useProblemsStore((state) => state.actions.replaceDiagnostics)

  useEffect(() => {
    if (!projectPath) return

    const normalizePath = (value: string) => value.replace(/^file:\/\//i, '').replace(/\\/g, '/')
    const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, '')
    let frame: number | null = null
    let lastLogAt = 0
    let disposed = false
    const markerOwner = 'vscode-semantic'

    const mirrorVscodeMarkers = async () => {
      await ensureVscodeServicesInitialized()
      if (disposed) return

      const markerService = await getService(IMarkerService)
      if (disposed) return

      const applyForModel = (model: monaco.editor.ITextModel) => {
        if (model.uri.scheme !== 'file') return
        const filePath = normalizePath(model.uri.fsPath)
        if (!(filePath === normalizedProjectPath || filePath.startsWith(`${normalizedProjectPath}/`))) return

        const resource = model.uri.toString()
        const markers = markerService
          .read()
          .filter((entry) => entry.resource.toString() === resource)
          .map((entry) => ({
            startLineNumber: entry.startLineNumber,
            startColumn: entry.startColumn,
            endLineNumber: entry.endLineNumber,
            endColumn: entry.endColumn,
            message: entry.message,
            source: entry.source,
            code: entry.code,
            severity:
              entry.severity >= 8
                ? monaco.MarkerSeverity.Error
                : entry.severity >= 4
                  ? monaco.MarkerSeverity.Warning
                  : entry.severity >= 2
                    ? monaco.MarkerSeverity.Info
                    : monaco.MarkerSeverity.Hint,
          }))

        monaco.editor.setModelMarkers(model, markerOwner, markers)
      }

      const applyAllModels = () => {
        for (const model of monaco.editor.getModels()) {
          applyForModel(model)
        }
      }

      applyAllModels()

      const markerServiceDisposable = markerService.onMarkerChanged(() => {
        applyAllModels()
        scheduleMarkerPublish()
      })

      const modelCreateDisposable = monaco.editor.onDidCreateModel((model) => {
        applyForModel(model)
        scheduleMarkerPublish()
      })

      cleanupDisposables.push(markerServiceDisposable, modelCreateDisposable)
    }

    const cleanupDisposables: Array<{ dispose: () => void }> = []

    const publishMonacoMarkers = () => {
      const diagnostics = monaco.editor
        .getModels()
        .filter((model) => {
          if (model.uri.scheme !== 'file') return false
          const filePath = normalizePath(model.uri.fsPath)
          return filePath === normalizedProjectPath || filePath.startsWith(`${normalizedProjectPath}/`)
        })
        .flatMap((model) => {
          const filePath = normalizePath(model.uri.fsPath)
          const markers = monaco.editor.getModelMarkers({ resource: model.uri })

          return markers.map((marker) => {
            const markerSource = typeof marker.source === 'string' ? marker.source.toLowerCase() : ''
            const source = markerSource.includes('eslint') ? 'eslint' : 'tsserver'
            const code = typeof marker.code === 'string'
              ? marker.code
              : typeof marker.code === 'number'
                ? String(marker.code)
                : marker.code && typeof marker.code === 'object' && 'value' in marker.code
                  ? String(marker.code.value)
                  : undefined

            return {
              source,
              severity:
                marker.severity === monaco.MarkerSeverity.Warning
                  ? 'warning'
                  : marker.severity === monaco.MarkerSeverity.Info || marker.severity === monaco.MarkerSeverity.Hint
                    ? 'info'
                    : 'error',
              message: marker.message,
              file: filePath,
              line: marker.startLineNumber,
              column: marker.startColumn,
              endLine: marker.endLineNumber,
              endColumn: marker.endColumn,
              code,
            } as const
          })
        })

      replaceDiagnostics(
        projectPath,
        'tsserver',
        diagnostics.filter((diagnostic) => diagnostic.source === 'tsserver')
      )
      replaceDiagnostics(
        projectPath,
        'eslint',
        diagnostics.filter((diagnostic) => diagnostic.source === 'eslint')
      )

      if (isDiagnosticsDebugEnabled()) {
        const now = Date.now()
        if (now - lastLogAt > 1000) {
          lastLogAt = now
          const tsCount = diagnostics.filter((diagnostic) => diagnostic.source === 'tsserver').length
          const eslintCount = diagnostics.filter((diagnostic) => diagnostic.source === 'eslint').length
          console.debug('[VSCode] Diagnostics markers', { tsCount, eslintCount })
        }
      }
    }

    const scheduleMarkerPublish = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      frame = window.requestAnimationFrame(() => {
        frame = null
        publishMonacoMarkers()
      })
    }

    const markerDisposable = monaco.editor.onDidChangeMarkers(scheduleMarkerPublish)
    const modelAddDisposable = monaco.editor.onDidCreateModel(scheduleMarkerPublish)
    const modelRemoveDisposable = monaco.editor.onWillDisposeModel(scheduleMarkerPublish)
    const refreshHandler = () => {
      scheduleMarkerPublish()
    }

    window.addEventListener(DIAGNOSTICS_REFRESH_EVENT_NAME, refreshHandler)
    void mirrorVscodeMarkers()
    scheduleMarkerPublish()

    return () => {
      disposed = true
      markerDisposable.dispose()
      modelAddDisposable.dispose()
      modelRemoveDisposable.dispose()
      for (const disposable of cleanupDisposables) {
        disposable.dispose()
      }
      for (const model of monaco.editor.getModels()) {
        monaco.editor.setModelMarkers(model, markerOwner, [])
      }
      window.removeEventListener(DIAGNOSTICS_REFRESH_EVENT_NAME, refreshHandler)
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
      }
      replaceDiagnostics(projectPath, 'tsserver', [])
      replaceDiagnostics(projectPath, 'eslint', [])
    }
  }, [projectPath, replaceDiagnostics])
}
