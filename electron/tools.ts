import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { notifyFileChanged, notifyFileMetaChanged } from './yjsNotify'
import { markInternalFsChange } from './projectWatcher'
import { ensureRuntimeInstalled } from './runtime/runtimeInstaller'
import { resolveCommandWithRuntime } from './runtime/runtimeResolver'
import { LocalMcpToolRuntime } from './services/LocalMcpToolRuntime'
import { DiagnosticsService } from './services/DiagnosticsService'

export interface ToolRequest {
  name: string
  input: Record<string, unknown>
  projectPath?: string
  runId?: string
  toolCallId?: string
}

export interface ToolResult {
  success: boolean
  output?: unknown
  error?: string
}

// Tool input types
interface ReadFileInput {
  filePath: string
  offset?: number
  limit?: number
}

interface ListDirInput {
  path?: string
  ignore?: string[]
}

interface FindFilesInput {
  pattern: string
  path?: string
}

interface GrepSearchInput {
  pattern: string
  path?: string
  include?: string
}

interface CreateFileInput {
  filePath: string
  content: string
}

interface ReplaceStringInput {
  filePath: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

interface MultiReplaceInput {
  filePath: string
  edits: Array<{
    filePath?: string
    oldString: string
    newString: string
    replaceAll?: boolean
  }>
}

interface RunInTerminalInput {
  command: string
  description: string
  timeout?: number
  workdir?: string
}

interface PreviewBrowserInput {
  action?: string
  currentUrl?: string
  url?: string
  path?: string
  element?: string
  ref?: string
  text?: string
  textGone?: string
  time?: number
  key?: string
  submit?: boolean
  slowly?: boolean
  filename?: string
  fullPage?: boolean
  type?: string
  doubleClick?: boolean
  button?: string
  modifiers?: string[]
}

const WORKSPACE_ROOT = path.resolve(
  process.env.COZEA_WORKSPACE_ROOT || process.env.APP_ROOT || process.cwd()
)
const DEFAULT_SAFE_READ_PARENT = process.platform === 'win32'
  ? process.env.USERPROFILE || process.cwd()
  : process.env.HOME || process.cwd()
const SAFE_READ_ROOT = path.resolve(
  process.env.COZEA_SAFE_READ_ROOT || path.join(DEFAULT_SAFE_READ_PARENT, 'Cozea', 'assistant-readonly')
)
const SAFE_READ_FALLBACK = path.resolve(path.join(os.tmpdir(), 'cozea-assistant-readonly'))

const UNSUPPORTED_NATIVE_COMMAND_PATTERNS: RegExp[] = [
  /\belectron\b/i,
  /\belectron-builder\b/i,
  /\breact-native\b/i,
  /\bexpo\b/i,
  /\bxcodebuild\b/i,
  /\bfastlane\b/i,
  /\bandroid\b/i,
  /\bgradle\b/i,
  /\bflutter\b/i,
  /\bswift\b/i,
]

const TOOLS_REQUIRING_PROJECT_CONTEXT = new Set<string>([
  'write',
  'edit',
  'multiedit',
  'bash',
  'preview_browser',
])
const READ_ONLY_TOOLS_WITHOUT_PROJECT = new Set<string>([
  'read',
  'list',
  'glob',
  'grep',
])

type TerminalExecutionStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'

const localMcpToolRuntime = LocalMcpToolRuntime.getInstance()

function getTerminalExecutionState(args: {
  running: boolean
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
}): { success: boolean; status: TerminalExecutionStatus; error?: string } {
  if (args.running) {
    return { success: true, status: 'running' }
  }
  if (args.cancelled) {
    return { success: false, status: 'cancelled', error: 'Command was cancelled by user.' }
  }
  if (args.timedOut) {
    return { success: false, status: 'timed_out', error: 'Command timed out before completion.' }
  }
  if (typeof args.exitCode === 'number' && args.exitCode !== 0) {
    return { success: false, status: 'failed', error: `Command exited with code ${args.exitCode}.` }
  }
  return { success: true, status: 'completed' }
}

function resolveToolPath(inputPath: string, workingDir: string): string {
  const resolved = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(workingDir, inputPath)
  )
  const relative = path.relative(workingDir, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside of the workspace')
  }
  return resolved
}

function resolveOutsideProjectReadRoot(): string {
  const candidates = [SAFE_READ_ROOT, SAFE_READ_FALLBACK]
  for (const candidate of candidates) {
    try {
      fs.mkdirSync(candidate, { recursive: true })
      return candidate
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error('Unable to initialize a safe read-only workspace for assistant tools.')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseFilesystemListingText(text: string): Array<{ name: string; type: 'directory' | 'file' }> {
  const entries: Array<{ name: string; type: 'directory' | 'file' }> = []
  const lines = text.split(/\r?\n/g)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    const tagged = line.match(/^\[(FILE|DIR)\]\s+(.+)$/i)
    if (tagged) {
      const kind = tagged[1].toUpperCase()
      const name = tagged[2].trim()
      if (!name) continue
      entries.push({
        name,
        type: kind === 'DIR' ? 'directory' : 'file',
      })
      continue
    }

    const fallbackName = line.replace(/\/$/, '')
    if (!fallbackName) continue
    entries.push({
      name: fallbackName,
      type: line.endsWith('/') ? 'directory' : 'file',
    })
  }
  return entries
}

function buildReadFileOutput(args: {
  filePath: string
  content: string
  offset?: number
  limit?: number
}) {
  const lines = args.content.split(/\r?\n/)
  const totalLines = lines.length
  const maxLines = 2000

  const offset = Math.max(1, args.offset ?? 1)
  const limit = args.limit ? Math.max(1, args.limit) : totalLines

  const startIndex = Math.min(totalLines, offset) - 1
  const boundedLimit = Math.min(limit, maxLines)
  const endIndex = Math.min(totalLines, startIndex + boundedLimit)

  const slice = lines.slice(startIndex, endIndex)
  const endLine = Math.min(totalLines, offset + boundedLimit - 1)

  return {
    filePath: args.filePath,
    content: slice.join('\n'),
    offset,
    limit: boundedLimit,
    startLine: offset,
    endLine,
    totalLines,
    truncated: endIndex < totalLines || boundedLimit < limit,
  }
}

function extractStructuredOrText(value: unknown): unknown {
  const structured = LocalMcpToolRuntime.extractStructuredFromToolResult(value)
  if (structured !== null && structured !== undefined) {
    return structured
  }

  const text = LocalMcpToolRuntime.extractTextFromToolResult(value)
  if (typeof text !== 'string') return null
  return parseJsonValue(text) ?? text
}

function normalizeListEntries(value: unknown): Array<{ name: string; type: 'directory' | 'file' }> | null {
  if (typeof value === 'string') {
    const parsed = parseFilesystemListingText(value)
    return parsed.length > 0 ? parsed : null
  }

  if (!Array.isArray(value)) return null

  const result: Array<{ name: string; type: 'directory' | 'file' }> = []
  for (const entry of value) {
    if (typeof entry === 'string') {
      result.push({ name: entry, type: 'file' })
      continue
    }

    const record = asRecord(entry)
    if (!record) continue

    const nameRaw = typeof record.name === 'string'
      ? record.name
      : typeof record.path === 'string'
        ? path.basename(record.path)
        : null
    if (!nameRaw || nameRaw.trim().length === 0) continue

    const isDir =
      record.type === 'directory' ||
      record.isDirectory === true ||
      record.directory === true

    result.push({
      name: nameRaw.trim(),
      type: isDir ? 'directory' : 'file',
    })
  }

  return result
}

function normalizeSearchPaths(value: unknown, fallbackRoot: string): string[] | null {
  if (typeof value === 'string') {
    const lines = value
      .split(/\r?\n/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => entry.replace(/^\[[A-Z]+\]\s+/i, ''))
      .map((entry) => path.isAbsolute(entry) ? entry : path.resolve(fallbackRoot, entry))
    return lines.length > 0 ? lines : null
  }

  if (Array.isArray(value)) {
    const paths = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => path.isAbsolute(entry) ? entry : path.resolve(fallbackRoot, entry))
    return paths
  }

  const record = asRecord(value)
  if (!record) return null
  const listCandidate = record.results ?? record.matches ?? record.files ?? record.paths
  if (typeof listCandidate === 'string') {
    return normalizeSearchPaths(listCandidate, fallbackRoot)
  }
  if (Array.isArray(listCandidate)) {
    return normalizeSearchPaths(listCandidate, fallbackRoot)
  }
  if (typeof record.content === 'string') {
    return normalizeSearchPaths(record.content, fallbackRoot)
  }
  return null
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function readFileViaMcp(
  input: ReadFileInput,
  workingDir: string
): Promise<ReturnType<typeof buildReadFileOutput> | null> {
  const filePath = resolveToolPath(input.filePath, workingDir)
  const result = await localMcpToolRuntime.callTool({
    kind: 'filesystem',
    workspaceRoot: workingDir,
    preferredNames: ['read_file'],
    argVariants: [
      { path: filePath },
      { filePath: filePath },
      { file_path: filePath },
      { uri: `file://${filePath}` },
    ],
    timeoutMs: 15_000,
  })

  if (!result.ok) return null

  const text = LocalMcpToolRuntime.extractTextFromToolResult(result.value)
  if (typeof text !== 'string') {
    return null
  }

  return buildReadFileOutput({
    filePath,
    content: text,
    offset: input.offset,
    limit: input.limit,
  })
}

async function listDirViaMcp(
  input: ListDirInput,
  workingDir: string
): Promise<{ path: string; entries: Array<{ name: string; type: 'directory' | 'file' }> } | null> {
  const requestedPath =
    typeof input.path === 'string' && input.path.trim().length > 0
      ? input.path
      : '.'
  const dirPath = resolveToolPath(requestedPath, workingDir)

  const result = await localMcpToolRuntime.callTool({
    kind: 'filesystem',
    workspaceRoot: workingDir,
    preferredNames: ['list_directory', 'directory_tree'],
    argVariants: [
      { path: dirPath },
      { dirPath: dirPath },
      { directory: dirPath },
    ],
    timeoutMs: 15_000,
  })

  if (!result.ok) return null

  const parsed = extractStructuredOrText(result.value)
  const record = asRecord(parsed)
  const entriesCandidate = record?.entries ?? record?.children ?? record?.content ?? parsed
  const entries = normalizeListEntries(entriesCandidate)
    ?? normalizeListEntries(LocalMcpToolRuntime.extractTextFromToolResult(result.value))
  if (!entries) return null

  const ignorePatterns = Array.isArray(input.ignore)
    ? input.ignore.filter((pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0)
    : []

  const wildcardToRegex = (pattern: string): RegExp => {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    return new RegExp(`^${escaped}$`)
  }

  const shouldIgnore = (name: string): boolean => {
    if (ignorePatterns.length === 0) return false
    return ignorePatterns.some((pattern) => wildcardToRegex(pattern).test(name))
  }

  return {
    path: dirPath,
    entries: entries.filter((entry) => !shouldIgnore(entry.name)),
  }
}

async function findFilesViaMcp(
  input: FindFilesInput,
  workingDir: string
): Promise<{
  pattern: string
  path: string
  results: string[]
  total: number
  truncated: boolean
  timedOut: boolean
} | null> {
  const pattern = input.pattern
  const searchDir =
    typeof input.path === 'string' && input.path.trim().length > 0
      ? resolveToolPath(input.path, workingDir)
      : workingDir

  const result = await localMcpToolRuntime.callTool({
    kind: 'filesystem',
    workspaceRoot: workingDir,
    preferredNames: ['search_files', 'find_files'],
    argVariants: [
      { path: searchDir, pattern },
      { root: searchDir, pattern },
      { directory: searchDir, pattern },
      { path: searchDir, query: pattern },
    ],
    timeoutMs: 20_000,
  })

  if (result.ok) {
    const parsed = extractStructuredOrText(result.value)
    const paths = normalizeSearchPaths(parsed, searchDir)
    if (paths) {
      return {
        pattern,
        path: searchDir,
        results: paths.slice(0, 200),
        total: Math.min(paths.length, 200),
        truncated: paths.length > 200,
        timedOut: false,
      }
    }
  }

  const shellFind = await runInTerminalViaMcp(
    {
      command: `rg --files -g ${quoteShellArg(pattern)}`,
      timeout: 20_000,
      workdir: searchDir,
    },
    workingDir
  )
  if (!shellFind) return null
  if (!shellFind.success && shellFind.exitCode !== 1) return null

  const shellPaths = shellFind.stdout
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => (path.isAbsolute(line) ? line : path.resolve(searchDir, line)))

  return {
    pattern,
    path: searchDir,
    results: shellPaths.slice(0, 200),
    total: Math.min(shellPaths.length, 200),
    truncated: shellPaths.length > 200,
    timedOut: shellFind.timedOut,
  }
}

async function grepSearchViaMcp(
  input: GrepSearchInput,
  workingDir: string
): Promise<{
  pattern: string
  path: string
  results: Array<{ filePath: string; line: number; text: string }>
  total: number
  truncated: boolean
  timedOut: boolean
} | null> {
  const searchDir =
    typeof input.path === 'string' && input.path.trim().length > 0
      ? resolveToolPath(input.path, workingDir)
      : workingDir

  // mcp-repo-search is URL-clone oriented and cannot search a local workspace path directly.
  // For project-scoped grep, rely on shell MCP + ripgrep.

  const includeArg =
    typeof input.include === 'string' && input.include.trim().length > 0
      ? ` -g ${quoteShellArg(input.include.trim())}`
      : ''
  const shellGrep = await runInTerminalViaMcp(
    {
      command: `rg --json${includeArg} ${quoteShellArg(input.pattern)}`,
      timeout: 20_000,
      workdir: searchDir,
    },
    workingDir
  )
  if (!shellGrep) return null
  if (!shellGrep.success && shellGrep.exitCode !== 1) return null

  const matches: Array<{ filePath: string; line: number; text: string }> = []
  const lines = shellGrep.stdout.split(/\r?\n/g)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const event = parseJsonValue(trimmed)
    const record = asRecord(event)
    if (!record || record.type !== 'match') continue
    const data = asRecord(record.data)
    const pathInfo = asRecord(data?.path)
    const linesInfo = asRecord(data?.lines)
    const fileRaw = typeof pathInfo?.text === 'string' ? pathInfo.text : null
    const textRaw = typeof linesInfo?.text === 'string' ? linesInfo.text : ''
    const lineRaw = Number(data?.line_number ?? 0)
    if (!fileRaw) continue
    matches.push({
      filePath: path.isAbsolute(fileRaw) ? fileRaw : path.resolve(searchDir, fileRaw),
      line: Number.isFinite(lineRaw) && lineRaw > 0 ? Math.round(lineRaw) : 1,
      text: textRaw,
    })
    if (matches.length >= 200) break
  }

  return {
    pattern: input.pattern,
    path: searchDir,
    results: matches,
    total: matches.length,
    truncated: matches.length >= 200,
    timedOut: shellGrep.timedOut,
  }
}

async function writeFileViaMcp(args: {
  filePath: string
  content: string
  workingDir: string
  notify?: boolean
}): Promise<boolean> {
  const result = await localMcpToolRuntime.callTool({
    kind: 'filesystem',
    workspaceRoot: args.workingDir,
    preferredNames: ['write_file', 'edit_file'],
    argVariants: [
      { path: args.filePath, content: args.content },
      { filePath: args.filePath, content: args.content },
      { file_path: args.filePath, content: args.content },
      { path: args.filePath, text: args.content },
    ],
    timeoutMs: 20_000,
  })

  if (!result.ok) return false

  if (args.notify) {
    try {
      const nextContent = fs.readFileSync(args.filePath, 'utf-8')
      const stats = fs.statSync(args.filePath)
      markInternalFsChange(args.filePath)
      notifyFileChanged(args.filePath, nextContent, { origin: 'agent' })
      notifyFileMetaChanged({
        filePath: args.filePath,
        origin: 'agent',
        isBinary: false,
        sizeBytes: stats.size,
        content: nextContent,
      })
    } catch {
      // Ignore post-write read failures, write already succeeded.
    }
  }
  return true
}

async function runInTerminalViaMcp(args: {
  command: string
  timeout?: number
  workdir?: string
}, workingDir: string): Promise<{
  id: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  running: boolean
  timedOut: boolean
  cancelled: boolean
  success: boolean
  status: TerminalExecutionStatus
  error?: string
} | null> {
  const requestedWorkdir = typeof args.workdir === 'string' && args.workdir.trim().length > 0
    ? args.workdir.trim()
    : '.'
  const resolvedWorkdir = resolveToolPath(requestedWorkdir, workingDir)

  const timeoutMs =
    typeof args.timeout === 'number' && Number.isFinite(args.timeout)
      ? Math.min(Math.max(0, Math.floor(args.timeout)), 10 * 60 * 1000)
      : 5 * 60 * 1000

  const mcpResult = await localMcpToolRuntime.callTool({
    kind: 'shell',
    workspaceRoot: resolvedWorkdir,
    preferredNames: ['shell_execute', 'run_command', 'execute_command', 'shell', 'command'],
    argVariants: [
      {
        command: args.command,
        execution_mode: 'foreground',
        timeout_seconds: Math.max(1, Math.floor(timeoutMs / 1000)),
        working_directory: resolvedWorkdir,
      },
      { command: args.command, working_directory: resolvedWorkdir },
      { command: args.command },
    ],
    timeoutMs,
  })

  if (!mcpResult.ok) return null

  const parsed = extractStructuredOrText(mcpResult.value)
  const parsedRecord = asRecord(parsed)

  const stdout = typeof parsedRecord?.stdout === 'string'
    ? parsedRecord.stdout
    : typeof parsed === 'string'
      ? parsed
      : ''
  const stderr = typeof parsedRecord?.stderr === 'string' ? parsedRecord.stderr : ''
  const status = typeof parsedRecord?.status === 'string' ? parsedRecord.status.trim().toLowerCase() : ''
  const exitCodeRaw = Number(
    parsedRecord?.exitCode
    ?? parsedRecord?.exit_code
    ?? parsedRecord?.code
    ?? (status === 'failed' ? 1 : 0)
  )
  const exitCode = Number.isFinite(exitCodeRaw) ? Math.round(exitCodeRaw) : (status === 'failed' ? 1 : 0)
  const timedOut = parsedRecord?.timedOut === true || status === 'timeout' || status === 'timed_out'
  const cancelled = parsedRecord?.cancelled === true
  const running = parsedRecord?.running === true || status === 'running'
  const executionState = getTerminalExecutionState({
    running,
    exitCode,
    timedOut,
    cancelled,
  })

  return {
    id: `mcp_shell_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    command: args.command,
    stdout,
    stderr,
    exitCode,
    running,
    timedOut,
    cancelled,
    success: executionState.success,
    status: executionState.status,
    ...(executionState.error ? { error: executionState.error } : {}),
  }
}

async function createFile(
  input: { filePath: string; content: string },
  workingDir: string,
  options?: { notify?: boolean }
) {
  const filePath = resolveToolPath(input.filePath, workingDir)
  if (fs.existsSync(filePath)) {
    throw new Error('File already exists')
  }
  const content = input.content ?? ''
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const wroteViaMcp = await writeFileViaMcp({
    filePath,
    content,
    workingDir,
    notify: options?.notify,
  })
  if (!wroteViaMcp) {
    throw new Error('Filesystem MCP write tool is unavailable.')
  }

  return { filePath }
}

async function replaceStringInFile(
  input: { filePath: string; oldString: string; newString: string; replaceAll?: boolean },
  workingDir: string,
  options?: { notify?: boolean }
) {
  const filePath = resolveToolPath(input.filePath, workingDir)
  if (input.oldString.length === 0) {
    throw new Error('oldString must be non-empty')
  }
  const content = fs.readFileSync(filePath, 'utf-8')

  const occurrences = content.split(input.oldString).length - 1
  if (occurrences === 0) {
    throw new Error('Old string not found in file')
  }
  if (!input.replaceAll && occurrences > 1) {
    throw new Error('Old string must match exactly one occurrence')
  }

  const updated = input.replaceAll
    ? content.split(input.oldString).join(input.newString)
    : content.replace(input.oldString, input.newString)
  const replacementCount = input.replaceAll ? occurrences : 1
  const wroteViaMcp = await writeFileViaMcp({
    filePath,
    content: updated,
    workingDir,
    notify: options?.notify,
  })
  if (!wroteViaMcp) {
    throw new Error('Filesystem MCP write tool is unavailable.')
  }

  return { filePath, replacements: replacementCount }
}

async function multiReplaceString(
  input: {
    filePath: string
    edits: Array<{ filePath?: string; oldString: string; newString: string; replaceAll?: boolean }>
  },
  workingDir: string,
  options?: { notify?: boolean }
) {
  const edits = Array.isArray(input.edits) ? input.edits : []
  if (edits.length === 0) {
    throw new Error('edits must contain at least one edit')
  }

  const workingContentByFile = new Map<string, string>()
  const replacementCountByFile = new Map<string, number>()

  for (const edit of edits) {
    if (typeof edit.oldString !== 'string' || typeof edit.newString !== 'string') {
      throw new Error('Each edit must include oldString and newString')
    }
    const targetFilePath =
      typeof edit.filePath === 'string' && edit.filePath.trim().length > 0
        ? edit.filePath
        : input.filePath
    if (typeof targetFilePath !== 'string' || targetFilePath.trim().length === 0) {
      throw new Error('Each edit must resolve to a valid filePath')
    }
    if (edit.oldString.length === 0) {
      throw new Error('oldString must be non-empty')
    }

    const resolvedFilePath = resolveToolPath(targetFilePath, workingDir)
    const current =
      workingContentByFile.get(resolvedFilePath) ??
      fs.readFileSync(resolvedFilePath, 'utf-8')

    const occurrences = current.split(edit.oldString).length - 1
    if (occurrences === 0) {
      throw new Error(`Old string not found in file: ${targetFilePath}`)
    }
    if (!edit.replaceAll && occurrences > 1) {
      throw new Error(`Old string must match exactly one occurrence in file: ${targetFilePath}`)
    }

    const updated = edit.replaceAll
      ? current.split(edit.oldString).join(edit.newString)
      : current.replace(edit.oldString, edit.newString)
    const replacementCount = edit.replaceAll ? occurrences : 1

    workingContentByFile.set(resolvedFilePath, updated)
    replacementCountByFile.set(
      resolvedFilePath,
      (replacementCountByFile.get(resolvedFilePath) ?? 0) + replacementCount
    )
  }

  const results: Array<{ filePath: string; replacements: number }> = []
  for (const [resolvedFilePath, updatedContent] of workingContentByFile.entries()) {
    const wroteViaMcp = await writeFileViaMcp({
      filePath: resolvedFilePath,
      content: updatedContent,
      workingDir,
      notify: options?.notify,
    })
    if (!wroteViaMcp) {
      throw new Error(`Filesystem MCP write tool is unavailable for ${resolvedFilePath}.`)
    }
    results.push({
      filePath: resolvedFilePath,
      replacements: replacementCountByFile.get(resolvedFilePath) ?? 0,
    })
  }

  return { results }
}

async function runInTerminal(input: {
  command: string
  description: string
  timeout?: number
  workdir?: string
}, workingDir: string) {
  if (!input.command || typeof input.command !== 'string') {
    throw new Error('command is required')
  }
  if (!input.description || typeof input.description !== 'string' || input.description.trim().length === 0) {
    throw new Error('description is required')
  }

  const normalizedCommand = input.command.trim()
  const blockedCommand = UNSUPPORTED_NATIVE_COMMAND_PATTERNS.some((pattern) =>
    pattern.test(normalizedCommand)
  )
  if (blockedCommand) {
    return {
      id: `term_blocked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      command: input.command,
      stdout: '',
      stderr: 'Current builder supports web projects only. Native desktop/mobile commands are not supported in this release.',
      exitCode: -1,
      running: false,
      timedOut: false,
      cancelled: false,
      success: false,
      status: 'failed',
      error: 'Unsupported native command for this release.',
    }
  }

  const runtimeResolution = resolveCommandWithRuntime(normalizedCommand)
  if (runtimeResolution.status === 'failed') {
    return {
      id: `term_blocked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      command: input.command,
      stdout: '',
      stderr: runtimeResolution.error ?? 'Command is unsupported in this release.',
      exitCode: -1,
      running: false,
      timedOut: false,
      cancelled: false,
      success: false,
      status: 'failed',
      error: runtimeResolution.error ?? 'Command is unsupported in this release.',
    }
  }

  if (runtimeResolution.status === 'needs_user_approval') {
    return {
      id: `term_needs_approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      command: input.command,
      stdout: '',
      stderr: '',
      exitCode: null,
      running: false,
      timedOut: false,
      cancelled: false,
      success: false,
      status: 'needs_user_approval',
      approvalPayload: runtimeResolution.approvalPayload ?? {
        command: input.command,
        reason: runtimeResolution.error || 'Command token is unknown.',
        alternatives: [],
      },
      error: runtimeResolution.error ?? 'Command requires user approval.',
    }
  }

  if (runtimeResolution.runtime) {
    const ensured = await ensureRuntimeInstalled(runtimeResolution.runtime)
    if (!ensured.success) {
      return {
        id: `term_runtime_missing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        command: input.command,
        stdout: '',
        stderr: ensured.error ?? `Runtime ${runtimeResolution.runtime} is unavailable.`,
        exitCode: -1,
        running: false,
        timedOut: false,
        cancelled: false,
        success: false,
        status: 'failed',
        error: ensured.error ?? `Runtime ${runtimeResolution.runtime} is unavailable.`,
      }
    }
  }

  const timeoutMs = typeof input.timeout === 'number' ? Math.max(0, input.timeout) : 120_000
  const commandWorkingDir =
    typeof input.workdir === 'string' && input.workdir.trim().length > 0
      ? resolveToolPath(input.workdir, workingDir)
      : workingDir

  const mcpExecution = await runInTerminalViaMcp({
    command: input.command,
    timeout: timeoutMs,
    workdir: commandWorkingDir,
  }, workingDir)
  if (mcpExecution) {
    return mcpExecution
  }

  return {
    id: `term_mcp_unavailable_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    command: input.command,
    stdout: '',
    stderr: '',
    exitCode: -1,
    running: false,
    timedOut: false,
    cancelled: false,
    success: false,
    status: 'failed',
    error: 'Shell MCP server is unavailable or refused command execution.',
  }
}

type PreviewBrowserAction =
  | 'snapshot'
  | 'navigate'
  | 'click'
  | 'type'
  | 'press'
  | 'wait_for'
  | 'screenshot'

const LOOPBACK_PREVIEW_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

function normalizePreviewBrowserAction(value: unknown): PreviewBrowserAction {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'snapshot'
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')

  switch (normalized) {
    case 'navigate':
    case 'click':
    case 'type':
    case 'press':
    case 'wait_for':
    case 'snapshot':
      return normalized
    case 'take_screenshot':
    case 'screenshot':
      return 'screenshot'
    case 'press_key':
      return 'press'
    default:
      return 'snapshot'
  }
}

function isLoopbackPreviewHost(hostname: string): boolean {
  return LOOPBACK_PREVIEW_HOSTS.has(hostname) || /^127(?:\.\d{1,3}){3}$/.test(hostname)
}

function normalizePreviewBrowserBaseUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Preview browser only supports http(s) preview URLs.')
  }

  if (parsed.hostname === '0.0.0.0') {
    parsed.hostname = '127.0.0.1'
  }

  if (!isLoopbackPreviewHost(parsed.hostname)) {
    throw new Error('Preview browser only supports localhost preview URLs.')
  }

  parsed.hash = ''
  return parsed
}

function resolvePreviewBrowserUrl(input: PreviewBrowserInput): string {
  const currentUrl =
    typeof input.currentUrl === 'string' && input.currentUrl.trim().length > 0
      ? input.currentUrl.trim()
      : ''
  if (!currentUrl) {
    throw new Error('Preview is not ready yet. Call preview_start, wait for the preview to load, and retry.')
  }

  const baseUrl = normalizePreviewBrowserBaseUrl(currentUrl)
  const requestedUrl =
    typeof input.url === 'string' && input.url.trim().length > 0
      ? input.url.trim()
      : null
  const requestedPath =
    typeof input.path === 'string' && input.path.trim().length > 0
      ? input.path.trim()
      : null

  const resolved = requestedUrl
    ? new URL(requestedUrl, baseUrl)
    : requestedPath
      ? new URL(requestedPath, baseUrl)
      : baseUrl

  if (resolved.hostname === '0.0.0.0') {
    resolved.hostname = '127.0.0.1'
  }

  if (!isLoopbackPreviewHost(resolved.hostname)) {
    throw new Error('Preview browser only supports localhost preview URLs.')
  }

  resolved.hash = ''
  return resolved.toString()
}

function isMissingPlaywrightBrowserError(error: string): boolean {
  const normalized = error.toLowerCase()
  return (
    normalized.includes('browser') &&
    (
      normalized.includes('install') ||
      normalized.includes('executable') ||
      normalized.includes('download')
    )
  )
}

async function callPlaywrightTool(args: {
  workspaceRoot: string
  preferredNames: string[]
  argVariants: Array<Record<string, unknown>>
  timeoutMs: number
}): Promise<Awaited<ReturnType<typeof localMcpToolRuntime.callTool>>> {
  let result = await localMcpToolRuntime.callTool({
    kind: 'playwright',
    workspaceRoot: args.workspaceRoot,
    preferredNames: args.preferredNames,
    argVariants: args.argVariants,
    timeoutMs: args.timeoutMs,
  })

  if (result.ok || !isMissingPlaywrightBrowserError(result.error)) {
    return result
  }

  const installResult = await localMcpToolRuntime.callTool({
    kind: 'playwright',
    workspaceRoot: args.workspaceRoot,
    preferredNames: ['browser_install'],
    argVariants: [{}],
    timeoutMs: 180_000,
  })
  if (!installResult.ok) {
    return installResult
  }

  result = await localMcpToolRuntime.callTool({
    kind: 'playwright',
    workspaceRoot: args.workspaceRoot,
    preferredNames: args.preferredNames,
    argVariants: args.argVariants,
    timeoutMs: args.timeoutMs,
  })

  return result
}

async function runPreviewBrowser(input: PreviewBrowserInput, workingDir: string): Promise<{
  action: PreviewBrowserAction
  url: string
  snapshot?: unknown
  result?: unknown
}> {
  const action = normalizePreviewBrowserAction(input.action)
  const targetUrl = resolvePreviewBrowserUrl(input)
  const currentUrl = normalizePreviewBrowserBaseUrl(input.currentUrl as string).toString()
  const shouldNavigate = action === 'navigate' || targetUrl !== currentUrl

  const invoke = async (
    preferredNames: string[],
    argVariants: Array<Record<string, unknown>>,
    timeoutMs = 30_000
  ): Promise<unknown> => {
    const result = await callPlaywrightTool({
      workspaceRoot: workingDir,
      preferredNames,
      argVariants,
      timeoutMs,
    })
    if (!result.ok) {
      throw new Error(result.error)
    }
    return extractStructuredOrText(result.value)
  }

  const captureSnapshot = async (): Promise<unknown> =>
    invoke(['browser_snapshot'], [{}], 30_000)

  if (shouldNavigate) {
    await invoke(['browser_navigate'], [{ url: targetUrl }], 45_000)
  }

  if (action === 'navigate' || action === 'snapshot') {
    return {
      action,
      url: targetUrl,
      snapshot: await captureSnapshot(),
    }
  }

  if (action === 'click') {
    if (typeof input.ref !== 'string' || input.ref.trim().length === 0) {
      throw new Error('preview_browser click requires ref from a prior snapshot.')
    }
    const payload: Record<string, unknown> = { ref: input.ref }
    if (typeof input.element === 'string' && input.element.trim().length > 0) payload.element = input.element
    if (typeof input.doubleClick === 'boolean') payload.doubleClick = input.doubleClick
    if (typeof input.button === 'string' && input.button.trim().length > 0) payload.button = input.button
    if (Array.isArray(input.modifiers)) payload.modifiers = input.modifiers.filter((item) => typeof item === 'string')
    const result = await invoke(['browser_click'], [payload], 30_000)
    return {
      action,
      url: targetUrl,
      result,
      snapshot: await captureSnapshot(),
    }
  }

  if (action === 'type') {
    if (typeof input.ref !== 'string' || input.ref.trim().length === 0) {
      throw new Error('preview_browser type requires ref from a prior snapshot.')
    }
    if (typeof input.text !== 'string') {
      throw new Error('preview_browser type requires text.')
    }
    const payload: Record<string, unknown> = {
      ref: input.ref,
      text: input.text,
    }
    if (typeof input.element === 'string' && input.element.trim().length > 0) payload.element = input.element
    if (typeof input.submit === 'boolean') payload.submit = input.submit
    if (typeof input.slowly === 'boolean') payload.slowly = input.slowly
    const result = await invoke(['browser_type'], [payload], 30_000)
    return {
      action,
      url: targetUrl,
      result,
      snapshot: await captureSnapshot(),
    }
  }

  if (action === 'press') {
    if (typeof input.key !== 'string' || input.key.trim().length === 0) {
      throw new Error('preview_browser press requires key.')
    }
    const result = await invoke(['browser_press_key'], [{ key: input.key.trim() }], 20_000)
    return {
      action,
      url: targetUrl,
      result,
      snapshot: await captureSnapshot(),
    }
  }

  if (action === 'wait_for') {
    const payload: Record<string, unknown> = {}
    if (typeof input.text === 'string' && input.text.trim().length > 0) payload.text = input.text
    if (typeof input.textGone === 'string' && input.textGone.trim().length > 0) payload.textGone = input.textGone
    if (typeof input.time === 'number' && Number.isFinite(input.time) && input.time >= 0) {
      payload.time = input.time
    }
    if (Object.keys(payload).length === 0) {
      throw new Error('preview_browser wait_for requires text, textGone, or time.')
    }
    const timeoutMs =
      typeof payload.time === 'number'
        ? Math.max(10_000, Math.ceil(payload.time * 1000) + 5_000)
        : 30_000
    const result = await invoke(['browser_wait_for'], [payload], timeoutMs)
    return {
      action,
      url: targetUrl,
      result,
      snapshot: await captureSnapshot(),
    }
  }

  if ((input.element && !input.ref) || (!input.element && input.ref)) {
    throw new Error('preview_browser screenshot requires both element and ref together.')
  }

  const payload: Record<string, unknown> = {}
  if (typeof input.type === 'string' && (input.type === 'png' || input.type === 'jpeg')) {
    payload.type = input.type
  }
  if (typeof input.filename === 'string' && input.filename.trim().length > 0) payload.filename = input.filename
  if (typeof input.fullPage === 'boolean') payload.fullPage = input.fullPage
  if (typeof input.element === 'string' && input.element.trim().length > 0) payload.element = input.element
  if (typeof input.ref === 'string' && input.ref.trim().length > 0) payload.ref = input.ref
  const result = await invoke(['browser_take_screenshot'], [payload], 45_000)
  return {
    action,
    url: targetUrl,
    result,
  }
}

export async function runTool(request: ToolRequest): Promise<ToolResult> {
  if (!request.projectPath && TOOLS_REQUIRING_PROJECT_CONTEXT.has(request.name)) {
    return {
      success: false,
      error: 'This tool requires an active project context. Open a project and retry.',
    }
  }

  if (!request.projectPath && !READ_ONLY_TOOLS_WITHOUT_PROJECT.has(request.name)) {
    return {
      success: false,
      error: 'Outside project context only read-only tools are allowed.',
    }
  }

  // Outside project context, all read tools are anchored to a dedicated safe directory.
  const workingDir = request.projectPath ?? resolveOutsideProjectReadRoot()
  const shouldNotify = Boolean(request.projectPath)

  try {
    let result: ToolResult | null = null

    switch (request.name) {
      case 'read': {
        const input = request.input as unknown as ReadFileInput
        const mcpOutput = await readFileViaMcp(input, workingDir)
        if (mcpOutput) {
          result = { success: true, output: mcpOutput }
        } else {
          result = { success: false, error: 'Filesystem MCP read tool is unavailable.' }
        }
        break
      }
      case 'list': {
        const input = request.input as unknown as ListDirInput
        const mcpOutput = await listDirViaMcp(input, workingDir)
        if (mcpOutput) {
          result = { success: true, output: mcpOutput }
        } else {
          result = { success: false, error: 'Filesystem MCP list tool is unavailable.' }
        }
        break
      }
      case 'glob':
      {
        const input = request.input as unknown as FindFilesInput
        const mcpOutput = await findFilesViaMcp(input, workingDir)
        if (mcpOutput) {
          result = { success: true, output: mcpOutput }
        } else {
          result = { success: false, error: 'Filesystem/Search MCP glob tool is unavailable.' }
        }
        break
      }
      case 'grep':
      {
        const input = request.input as unknown as GrepSearchInput
        const mcpOutput = await grepSearchViaMcp(input, workingDir)
        if (mcpOutput) {
          result = { success: true, output: mcpOutput }
        } else {
          result = { success: false, error: 'Repo/Shell MCP grep tool is unavailable.' }
        }
        break
      }
      case 'write':
        result = { success: true, output: await createFile(request.input as unknown as CreateFileInput, workingDir, { notify: shouldNotify }) }
        break
      case 'edit':
        result = {
          success: true,
          output: await replaceStringInFile(request.input as unknown as ReplaceStringInput, workingDir, { notify: shouldNotify }),
        }
        break
      case 'multiedit':
        result = {
          success: true,
          output: await multiReplaceString(request.input as unknown as MultiReplaceInput, workingDir, { notify: shouldNotify }),
        }
        break
      case 'bash':
        result = {
          success: true,
          output: await runInTerminal(request.input as unknown as RunInTerminalInput, workingDir),
        }
        break
      case 'preview_browser':
        result = {
          success: true,
          output: await runPreviewBrowser(request.input as unknown as PreviewBrowserInput, workingDir),
        }
        break
      case 'apply_patch':
        result = { success: false, error: 'apply_patch is not yet enabled in this runtime' }
        break
      default:
        result = { success: false, error: `Unknown tool: ${request.name}` }
        break
    }

    if (result && result.success && request.projectPath && ['write', 'edit', 'multiedit'].includes(request.name)) {
      try {
        const modifiedFiles: string[] = []
        const out = result.output as any
        if (out?.filePath) {
          modifiedFiles.push(out.filePath)
        } else if (out?.results && Array.isArray(out.results)) {
          modifiedFiles.push(...out.results.map((r: any) => r.filePath).filter(Boolean))
        }

        if (modifiedFiles.length > 0) {
          const diagnosticsService = DiagnosticsService.getInstance()
          const diagnostics = await diagnosticsService.checkFiles(request.projectPath, {
            filePaths: modifiedFiles,
            timeoutMs: 5000,
          })
          
          const problems = diagnostics.filter(d => d.severity === 'error' || d.severity === 'warning')
          if (problems.length > 0) {
            result.output = {
              ...(typeof result.output === 'object' && result.output !== null ? result.output : {}),
              diagnostics: problems.map(p => ({
                file: p.file,
                line: p.line,
                severity: p.severity,
                message: p.message,
                source: p.source,
              })),
              diagnosticSummary: `Warning: ${problems.length} problem(s) detected after this edit.`
            }
          }
        }
      } catch (diagErr) {
        console.warn('[ToolRuntime] Post-edit diagnostics check failed:', diagErr)
      }
    }

    return result || { success: false, error: 'Unknown tool execution state' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Tool failed' }
  }
}

export function cancelToolRuns(runId: string): { success: boolean; canceled: number } {
  void runId
  // MCP shell calls in this runtime are foreground-only and complete in a single call,
  // so there are no tracked background child processes to cancel from here.
  return { success: true, canceled: 0 }
}

export function getWorkspaceRoot() {
  return WORKSPACE_ROOT
}

export function disposeToolRuntime(): void {
  localMcpToolRuntime.disposeAll()
}
