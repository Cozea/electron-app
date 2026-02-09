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

interface EnrichToolOutputWithLintDiagnosticsOptions {
  projectPath?: string | null
  toolName: string
  input: Record<string, unknown> | null
  output: unknown
  timeoutMs?: number
  maxItems?: number
}

interface SummarizeLintDiagnosticsOptions {
  projectPath: string
  diagnostics: PipelineDiagnostic[]
  filePaths?: string[]
  maxItems?: number
}

const LINT_SOURCES = new Set<DiagnosticSource>(['tsserver', 'eslint'])

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

function readToolFilePath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseApplyPatchFilePaths(patch: string): string[] {
  const paths = new Set<string>()
  const lines = patch.split(/\r?\n/)

  for (const line of lines) {
    const updateMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)
    if (updateMatch?.[1]) {
      const filePath = updateMatch[1].trim()
      if (filePath) {
        paths.add(filePath)
      }
      continue
    }

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/)
    if (moveMatch?.[1]) {
      const filePath = moveMatch[1].trim()
      if (filePath) {
        paths.add(filePath)
      }
    }
  }

  return Array.from(paths)
}

function getApplyPatchFilePaths(input: Record<string, unknown>): string[] {
  const candidates: unknown[] = [input.input, input.patch]

  const operation = input.operation
  if (typeof operation === 'string') {
    candidates.push(operation)
  } else if (isRecord(operation)) {
    candidates.push(operation.input, operation.patch)
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const parsed = parseApplyPatchFilePaths(candidate)
    if (parsed.length > 0) {
      return parsed
    }
  }

  return []
}

export function extractToolFilePaths(
  toolName: string,
  input: Record<string, unknown> | null | undefined
): string[] {
  if (!input) return []

  if (
    toolName === 'create_file' ||
    toolName === 'replace_string_in_file' ||
    toolName === 'read_file'
  ) {
    const filePath = readToolFilePath(input.filePath ?? input.file_path)
    return filePath ? [filePath] : []
  }

  if (toolName === 'multi_replace_string_in_file') {
    const replacements = Array.isArray(input.replacements) ? input.replacements : []
    const paths = replacements
      .filter(isRecord)
      .map((replacement) => readToolFilePath(replacement.filePath ?? replacement.file_path))
      .filter((filePath): filePath is string => Boolean(filePath))
    return Array.from(new Set(paths))
  }

  if (toolName === 'apply_patch') {
    return getApplyPatchFilePaths(input)
  }

  return []
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

export async function collectToolDiagnosticsSummary({
  projectPath,
  filePaths,
  timeoutMs = 900,
  maxItems = 8,
}: CollectToolDiagnosticsOptions): Promise<ToolDiagnosticsSummary | null> {
  if (!projectPath || !window.electronAPI?.diagnostics) return null

  const checkedPaths = Array.from(
    new Set(
      filePaths
        .filter((filePath): filePath is string => typeof filePath === 'string')
        .map((filePath) => filePath.trim())
        .filter(Boolean)
    )
  )

  if (checkedPaths.length === 0) return null

  const response = await window.electronAPI.diagnostics.checkFiles({
    projectPath,
    filePaths: checkedPaths,
    timeoutMs,
  })

  if (!response.success) return null

  const diagnostics = Array.isArray(response.diagnostics)
    ? response.diagnostics as PipelineDiagnostic[]
    : []

  return summarizeLintDiagnostics({
    projectPath,
    diagnostics,
    filePaths: checkedPaths,
    maxItems,
  })
}

export async function enrichToolOutputWithLintDiagnostics({
  projectPath,
  toolName,
  input,
  output,
  timeoutMs,
  maxItems,
}: EnrichToolOutputWithLintDiagnosticsOptions): Promise<unknown> {
  if (!projectPath || !window.electronAPI?.diagnostics) return output

  const filePaths = extractToolFilePaths(toolName, input)
  if (filePaths.length === 0) return output

  const summary = await collectToolDiagnosticsSummary({
    projectPath,
    filePaths,
    timeoutMs,
    maxItems,
  })

  return attachToolDiagnosticsToOutput(output, summary)
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
