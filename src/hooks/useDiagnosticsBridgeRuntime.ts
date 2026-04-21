import * as monaco from "monaco-editor"
import { getService, IMarkerService } from "@codingame/monaco-vscode-api/services"

import { ensureVscodeServicesInitialized } from "@/lib/editor/vscodeServices"
import { DIAGNOSTICS_REFRESH_EVENT_NAME } from "@/lib/editor/diagnosticsRefresh"

interface PublishedDiagnostic {
  source: "tsserver" | "eslint" | "runtime" | "build"
  severity: "error" | "warning" | "info"
  message: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  code?: string
  related?: Array<{ message: string; file?: string; line?: number; column?: number }>
}

interface CreateDiagnosticsBridgeRuntimeOptions {
  projectPath: string
  replaceDiagnostics: (
    projectPath: string,
    source: "tsserver" | "eslint",
    diagnostics: PublishedDiagnostic[],
  ) => void
}

function isDiagnosticsDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return window.localStorage?.getItem("vscodeDiagnosticsDebug") === "1"
}

export async function createDiagnosticsBridgeRuntime({
  projectPath,
  replaceDiagnostics,
}: CreateDiagnosticsBridgeRuntimeOptions): Promise<() => void> {
  const normalizePath = (value: string) => value.replace(/^file:\/\//i, "").replace(/\\/g, "/")
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, "")
  let frame: number | null = null
  let diagnosticsRefreshSeq = 0
  let lastLogAt = 0
  let disposed = false
  const markerOwner = "vscode-semantic"
  const cleanupDisposables: Array<{ dispose: () => void }> = []

  const getTrackedFilePaths = () =>
    monaco.editor
      .getModels()
      .filter((model) => {
        if (model.uri.scheme !== "file") return false
        const filePath = normalizePath(model.uri.fsPath)
        return filePath === normalizedProjectPath || filePath.startsWith(`${normalizedProjectPath}/`)
      })
      .map((model) => normalizePath(model.uri.fsPath))

  const refreshServiceDiagnostics = async (restart = false) => {
    if (!window.electronAPI?.diagnostics) return

    const seq = ++diagnosticsRefreshSeq

    if (restart) {
      await window.electronAPI.diagnostics.stop({ projectPath })
      if (disposed || seq !== diagnosticsRefreshSeq) return
      await window.electronAPI.diagnostics.start({ projectPath })
      if (disposed || seq !== diagnosticsRefreshSeq) return
    }

    const filePaths = getTrackedFilePaths()
    if (filePaths.length === 0) {
      return
    }

    const result = await window.electronAPI.diagnostics.checkFiles({
      projectPath,
      filePaths,
      timeoutMs: 1200,
    })
    if (
      disposed ||
      seq !== diagnosticsRefreshSeq ||
      !result.success ||
      !Array.isArray(result.diagnostics)
    ) {
      return
    }

    const diagnostics = result.diagnostics as PublishedDiagnostic[]

    replaceDiagnostics(
      projectPath,
      "tsserver",
      diagnostics.filter((diagnostic) => diagnostic.source === "tsserver"),
    )
    replaceDiagnostics(
      projectPath,
      "eslint",
      diagnostics.filter((diagnostic) => diagnostic.source === "eslint"),
    )
  }

  const publishMonacoMarkers = () => {
    const diagnostics = monaco.editor
      .getModels()
      .filter((model) => {
        if (model.uri.scheme !== "file") return false
        const filePath = normalizePath(model.uri.fsPath)
        return filePath === normalizedProjectPath || filePath.startsWith(`${normalizedProjectPath}/`)
      })
      .flatMap((model) => {
        const filePath = normalizePath(model.uri.fsPath)
        const markers = monaco.editor.getModelMarkers({ resource: model.uri })

        return markers.map((marker) => {
          const markerSource =
            typeof marker.source === "string" ? marker.source.toLowerCase() : ""
          const source = markerSource.includes("eslint") ? "eslint" : "tsserver"
          const code =
            typeof marker.code === "string"
              ? marker.code
              : typeof marker.code === "number"
                ? String(marker.code)
                : marker.code && typeof marker.code === "object" && "value" in marker.code
                  ? String(marker.code.value)
                  : undefined

          return {
            source,
            severity:
              marker.severity === monaco.MarkerSeverity.Warning
                ? "warning"
                : marker.severity === monaco.MarkerSeverity.Info ||
                    marker.severity === monaco.MarkerSeverity.Hint
                  ? "info"
                  : "error",
            message: marker.message,
            file: filePath,
            line: marker.startLineNumber,
            column: marker.startColumn,
            endLine: marker.endLineNumber,
            endColumn: marker.endColumn,
            code,
          } satisfies PublishedDiagnostic
        })
      })

    replaceDiagnostics(
      projectPath,
      "tsserver",
      diagnostics.filter((diagnostic) => diagnostic.source === "tsserver"),
    )
    replaceDiagnostics(
      projectPath,
      "eslint",
      diagnostics.filter((diagnostic) => diagnostic.source === "eslint"),
    )

    if (isDiagnosticsDebugEnabled()) {
      const now = Date.now()
      if (now - lastLogAt > 1000) {
        lastLogAt = now
        const tsCount = diagnostics.filter((diagnostic) => diagnostic.source === "tsserver").length
        const eslintCount = diagnostics.filter((diagnostic) => diagnostic.source === "eslint").length
        console.debug("[VSCode] Diagnostics markers", { tsCount, eslintCount })
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

  const mirrorVscodeMarkers = async () => {
    await ensureVscodeServicesInitialized()
    if (disposed) return

    const markerService = await getService(IMarkerService)
    if (disposed) return

    const applyForModel = (model: monaco.editor.ITextModel) => {
      if (model.uri.scheme !== "file") return
      const filePath = normalizePath(model.uri.fsPath)
      if (!(filePath === normalizedProjectPath || filePath.startsWith(`${normalizedProjectPath}/`))) {
        return
      }

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

  const markerDisposable = monaco.editor.onDidChangeMarkers(scheduleMarkerPublish)
  const modelAddDisposable = monaco.editor.onDidCreateModel(scheduleMarkerPublish)
  const modelRemoveDisposable = monaco.editor.onWillDisposeModel(scheduleMarkerPublish)
  const diagnosticsPublishCleanup = window.electronAPI?.diagnostics?.onPublish?.((payload) => {
    if (payload.projectPath !== projectPath) return
    if (payload.source !== "tsserver" && payload.source !== "eslint") return
    replaceDiagnostics(projectPath, payload.source, payload.diagnostics)
  })
  const refreshHandler = () => {
    scheduleMarkerPublish()
    void refreshServiceDiagnostics(true)
  }

  window.addEventListener(DIAGNOSTICS_REFRESH_EVENT_NAME, refreshHandler)
  await window.electronAPI?.diagnostics?.start({ projectPath })
  await mirrorVscodeMarkers()
  scheduleMarkerPublish()
  await refreshServiceDiagnostics(true)

  return () => {
    disposed = true
    markerDisposable.dispose()
    modelAddDisposable.dispose()
    modelRemoveDisposable.dispose()
    diagnosticsPublishCleanup?.()
    for (const disposable of cleanupDisposables) {
      disposable.dispose()
    }
    for (const model of monaco.editor.getModels()) {
      monaco.editor.setModelMarkers(model, markerOwner, [])
    }
    window.removeEventListener(DIAGNOSTICS_REFRESH_EVENT_NAME, refreshHandler)
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
      frame = null
    }
    replaceDiagnostics(projectPath, "tsserver", [])
    replaceDiagnostics(projectPath, "eslint", [])
    void window.electronAPI?.diagnostics?.stop({ projectPath })
  }
}
