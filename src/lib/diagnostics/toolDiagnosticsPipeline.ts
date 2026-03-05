import { requestEditorDiagnosticsRefresh } from '@/lib/editor/diagnosticsRefresh'
import { getMutatingToolFilePaths, isFileMutatingTool } from '@/lib/diagnostics/mutatingTools'

type DiagnosticSource = 'tsserver' | 'eslint' | 'runtime' | 'build'
type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface PipelineDiagnostic {
  source: DiagnosticSource
  severity: DiagnosticSeverity
  message: string
  file?: string
  line?: number
  column?: number
  code?: string
}

export interface ToolDiagnosticItem {
  source: 'tsserver' | 'eslint'
  severity: DiagnosticSeverity
  message: string
  file: string
  line?: number
  column?: number
  code?: string
}

export interface ToolDiagnosticsSummary {
  checkedFiles: string[]
  total: number
  errors: number
  warnings: number
  infos: number
  items: ToolDiagnosticItem[]
  truncated: boolean
}

interface CollectToolDiagnosticsOptions {
  projectPath?: string | null
  filePaths: string[]
  timeoutMs?: number
  maxItems?: number
}

interface CollectMutatingToolDiagnosticsOptions {
  projectPath?: string | null
  toolName: string
  toolInput?: Record<string, unknown> | null
  timeoutMs?: number
  maxItems?: number
  debounceMs?: number
}

interface SummarizeLintDiagnosticsOptions {
  projectPath: string
  diagnostics: PipelineDiagnostic[]
  filePaths?: string[]
  maxItems?: number
}

interface PendingDiagnosticsRequest {
  filePaths: string[]
  timeoutMs: number
  maxItems: number
  resolve: (value: ToolDiagnosticsSummary | null) => void
}

interface DiagnosticsQueueState {
  timer: ReturnType<typeof setTimeout> | null
  flushing: boolean
  requests: PendingDiagnosticsRequest[]
}

const LINT_SOURCES = new Set<DiagnosticSource>(['tsserver', 'eslint'])
const DIAGNOSTICS_DEBOUNCE_MS = 400
const diagnosticsQueueByProject = new Map<string, DiagnosticsQueueState>()

const SEVERITY_ORDER: Record<DiagnosticSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizePath = (value: string) => value.replace(/\\/g, '/')

function toAbsoluteProjectPath(projectPath: string, filePath: string): string {
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, '')
  const normalizedFilePath = normalizePath(filePath).trim()
  if (!normalizedFilePath) return normalizedFilePath
  if (/^[A-Za-z]:\//.test(normalizedFilePath) || normalizedFilePath.startsWith('/')) {
    return normalizedFilePath
  }
  return `${normalizedProjectPath}/${normalizedFilePath}`.replace(/\/+/g, '/')
}

function toProjectRelativePath(projectPath: string, filePath: string): string {
  const normalizedProjectPath = normalizePath(projectPath).replace(/\/+$/, '')
  const normalizedFilePath = normalizePath(filePath)
  if (!normalizedProjectPath) return normalizedFilePath
  if (normalizedFilePath.startsWith(`${normalizedProjectPath}/`)) {
    return normalizedFilePath.slice(normalizedProjectPath.length + 1)
  }
  if (normalizedFilePath === normalizedProjectPath) {
    return '.'
  }
  return normalizedFilePath
}

export function summarizeLintDiagnostics({
  projectPath,
  diagnostics,
  filePaths,
  maxItems = 8,
}: SummarizeLintDiagnosticsOptions): ToolDiagnosticsSummary | null {
  const normalizedDiagnostics = Array.isArray(diagnostics) ? diagnostics : []
  if (normalizedDiagnostics.length === 0) return null

  const checkedPaths = filePaths && filePaths.length > 0
    ? Array.from(
        new Set(
          filePaths
            .filter((filePath): filePath is string => typeof filePath === 'string')
            .map((filePath) => filePath.trim())
            .filter(Boolean)
        )
      )
    : []

  const absolutePathSet = checkedPaths.length > 0
    ? new Set(checkedPaths.map((filePath) => toAbsoluteProjectPath(projectPath, filePath)))
    : null

  const lintDiagnostics = normalizedDiagnostics
    .filter((item) => LINT_SOURCES.has(item.source))
    .filter((item) => {
      if (!item.file) return false
      if (!absolutePathSet) return true
      const normalized = normalizePath(item.file)
      return absolutePathSet.has(normalized)
    })
    .sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      if (severityDiff !== 0) return severityDiff
      const fileA = a.file ?? ''
      const fileB = b.file ?? ''
      if (fileA !== fileB) return fileA.localeCompare(fileB)
      const lineA = a.line ?? 0
      const lineB = b.line ?? 0
      if (lineA !== lineB) return lineA - lineB
      return a.message.localeCompare(b.message)
    })

  if (lintDiagnostics.length === 0) return null

  const errors = lintDiagnostics.filter((item) => item.severity === 'error').length
  const warnings = lintDiagnostics.filter((item) => item.severity === 'warning').length
  const infos = lintDiagnostics.filter((item) => item.severity === 'info').length

  const items = lintDiagnostics.slice(0, Math.max(1, maxItems)).map((item) => ({
    source: item.source as 'tsserver' | 'eslint',
    severity: item.severity,
    message: item.message,
    file: toProjectRelativePath(projectPath, item.file || ''),
    line: item.line,
    column: item.column,
    code: item.code,
  }))

  return {
    checkedFiles: checkedPaths,
    total: lintDiagnostics.length,
    errors,
    warnings,
    infos,
    items,
    truncated: lintDiagnostics.length > items.length,
  }
}

function normalizeCheckedPaths(filePaths: string[]): string[] {
  return Array.from(
    new Set(
      filePaths
        .filter((filePath): filePath is string => typeof filePath === 'string')
        .map((filePath) => filePath.trim())
        .filter(Boolean)
    )
  )
}

async function getDiagnosticsForPaths(
  projectPath: string,
  filePaths: string[],
  timeoutMs: number
): Promise<PipelineDiagnostic[]> {
  if (typeof window === 'undefined' || !window.electronAPI?.diagnostics) {
    return []
  }

  const response = await window.electronAPI.diagnostics.checkFiles({
    projectPath,
    filePaths,
    timeoutMs,
  })

  if (!response.success) {
    return []
  }

  return Array.isArray(response.diagnostics)
    ? response.diagnostics as PipelineDiagnostic[]
    : []
}

function getOrCreateDiagnosticsQueue(projectPath: string): DiagnosticsQueueState {
  const existing = diagnosticsQueueByProject.get(projectPath)
  if (existing) {
    return existing
  }

  const created: DiagnosticsQueueState = {
    timer: null,
    flushing: false,
    requests: [],
  }
  diagnosticsQueueByProject.set(projectPath, created)
  return created
}

function scheduleDiagnosticsQueueFlush(projectPath: string, debounceMs: number): void {
  const queue = getOrCreateDiagnosticsQueue(projectPath)
  if (queue.timer) {
    clearTimeout(queue.timer)
  }

  queue.timer = setTimeout(() => {
    queue.timer = null
    void flushDiagnosticsQueue(projectPath)
  }, Math.max(0, debounceMs))
}

async function flushDiagnosticsQueue(projectPath: string): Promise<void> {
  const queue = diagnosticsQueueByProject.get(projectPath)
  if (!queue || queue.flushing) {
    return
  }

  if (queue.requests.length === 0) {
    diagnosticsQueueByProject.delete(projectPath)
    return
  }

  queue.flushing = true
  const pending = queue.requests.splice(0)

  try {
    const mergedPaths = normalizeCheckedPaths(pending.flatMap((entry) => entry.filePaths))
    const timeoutMs = pending.reduce((maxTimeout, entry) => Math.max(maxTimeout, entry.timeoutMs), 900)

    requestEditorDiagnosticsRefresh()

    const diagnostics = mergedPaths.length > 0
      ? await getDiagnosticsForPaths(projectPath, mergedPaths, timeoutMs)
      : []

    for (const entry of pending) {
      entry.resolve(
        summarizeLintDiagnostics({
          projectPath,
          diagnostics,
          filePaths: entry.filePaths,
          maxItems: entry.maxItems,
        })
      )
    }
  } catch (error) {
    console.warn('[Diagnostics] Failed to collect debounced diagnostics summary', error)
    for (const entry of pending) {
      entry.resolve(null)
    }
  } finally {
    queue.flushing = false

    if (queue.requests.length > 0) {
      scheduleDiagnosticsQueueFlush(projectPath, 0)
    } else if (!queue.timer) {
      diagnosticsQueueByProject.delete(projectPath)
    }
  }
}

function enqueueDebouncedDiagnosticsSummary(args: {
  projectPath: string
  filePaths: string[]
  timeoutMs: number
  maxItems: number
  debounceMs: number
}): Promise<ToolDiagnosticsSummary | null> {
  const { projectPath, filePaths, timeoutMs, maxItems, debounceMs } = args

  return new Promise<ToolDiagnosticsSummary | null>((resolve) => {
    const queue = getOrCreateDiagnosticsQueue(projectPath)
    queue.requests.push({
      filePaths,
      timeoutMs,
      maxItems,
      resolve,
    })
    scheduleDiagnosticsQueueFlush(projectPath, debounceMs)
  })
}

export async function collectToolDiagnosticsSummary({
  projectPath,
  filePaths,
  timeoutMs = 900,
  maxItems = 8,
}: CollectToolDiagnosticsOptions): Promise<ToolDiagnosticsSummary | null> {
  if (!projectPath || typeof window === 'undefined' || !window.electronAPI?.diagnostics) return null

  const checkedPaths = normalizeCheckedPaths(filePaths)

  if (checkedPaths.length === 0) return null

  const diagnostics = await getDiagnosticsForPaths(projectPath, checkedPaths, timeoutMs)

  return summarizeLintDiagnostics({
    projectPath,
    diagnostics,
    filePaths: checkedPaths,
    maxItems,
  })
}

export async function collectMutatingToolDiagnosticsSummary({
  projectPath,
  toolName,
  toolInput,
  timeoutMs = 900,
  maxItems = 8,
  debounceMs = DIAGNOSTICS_DEBOUNCE_MS,
}: CollectMutatingToolDiagnosticsOptions): Promise<ToolDiagnosticsSummary | null> {
  if (!projectPath || typeof window === 'undefined') {
    return null
  }

  if (!isFileMutatingTool(toolName)) {
    return null
  }

  const filePaths = normalizeCheckedPaths(getMutatingToolFilePaths(toolName, toolInput))
  if (filePaths.length === 0) {
    return null
  }

  return enqueueDebouncedDiagnosticsSummary({
    projectPath,
    filePaths,
    timeoutMs,
    maxItems,
    debounceMs,
  })
}

export function attachToolDiagnosticsToOutput(
  output: unknown,
  summary: ToolDiagnosticsSummary | null
): unknown {
  if (!summary) return output

  if (isRecord(output)) {
    return {
      ...output,
      diagnostics: summary,
    }
  }

  return {
    output,
    diagnostics: summary,
  }
}
