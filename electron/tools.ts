import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { notifyFileChanged } from './yjsNotify'
import { markInternalFsChange } from './projectWatcher'
import { TerminalService } from './services/TerminalService'
import { loadCapabilityCatalog } from './runtime/capabilityCatalog'
import { collectProjectEvidence } from './runtime/projectEvidence'
import { createRuntimeEnv } from './runtime/runtimeEnv'
import { ensureRuntimeInstalled } from './runtime/runtimeInstaller'
import { getRuntimePathPrefixes, resolveCommandWithRuntime } from './runtime/runtimeResolver'

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
  startLine?: number
  endLine?: number
}

interface ListDirInput {
  path: string
}

interface FindFilesInput {
  query: string
  maxResults?: number
}

interface GrepSearchInput {
  query: string
  isRegexp?: boolean
  includePattern?: string
  maxResults?: number
  includeIgnoredFiles?: boolean
}

interface CreateFileInput {
  filePath: string
  content: string
}

interface ReplaceStringInput {
  filePath: string
  oldString: string
  newString: string
}

interface MultiReplaceInput {
  replacements: Array<{ filePath: string; oldString: string; newString: string }>
}

interface RunInTerminalInput {
  command: string
  explanation?: string
  isBackground?: boolean
  timeout?: number
}

interface GetTerminalOutputInput {
  id: string
}

interface InstallDependenciesInput {
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
  timeout?: number
}

interface VerifyBuildInput {
  command?: string
  timeout?: number
}

interface StartDevServerInput {
  command?: string
  isBackground?: boolean
  timeout?: number
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

const MAX_OUTPUT_LENGTH = 60_000
const TRUNCATION_MESSAGE = '\n...output truncated...\n'
const TERMINAL_HISTORY_TTL_MS = 30 * 60 * 1000
const TERMINAL_HISTORY_MAX_ENTRIES = 1000
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
  'get_terminal_output',
  'install_dependencies',
  'verify_build',
  'start_dev_server',
])
const READ_ONLY_TOOLS_WITHOUT_PROJECT = new Set<string>([
  'read',
  'list',
  'glob',
  'grep',
])

interface BackgroundProcess {
  id: string
  command: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  timedOut?: boolean
  cancelled?: boolean
  stdout: string
  stderr: string
  process: ReturnType<typeof spawn>
}

type TerminalExecutionStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'

const backgroundProcesses = new Map<string, BackgroundProcess>()
const activeRunProcesses = new Map<string, Set<ReturnType<typeof spawn>>>()
const DEFAULT_KILL_GRACE_MS = 1500

function isProcessRunning(child: ReturnType<typeof spawn>) {
  return child.exitCode === null && child.signalCode === null
}

function terminateProcess(child: ReturnType<typeof spawn>, options?: { forceAfterMs?: number }) {
  const pid = child.pid
  if (!pid) return
  const forceAfterMs = options?.forceAfterMs ?? DEFAULT_KILL_GRACE_MS
  const isWin = process.platform === 'win32'
  const useProcessGroup = Boolean((child as { __agentDetached?: boolean }).__agentDetached)

  try {
    if (isWin) {
      try {
        child.kill('SIGTERM')
      } catch {
        // ignore
      }
      try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
      } catch {
        // ignore
      }
    } else if (useProcessGroup) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // ignore
        }
      }
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    // ignore
  }

  if (forceAfterMs <= 0) return

  setTimeout(() => {
    if (!isProcessRunning(child)) return
    try {
      if (isWin) {
        try {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'])
        } catch {
          // ignore
        }
      } else if (useProcessGroup) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          try {
            child.kill('SIGKILL')
          } catch {
            // ignore
          }
        }
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      // ignore
    }
  }, forceAfterMs)
}

function registerRunProcess(runId: string | undefined, child: ReturnType<typeof spawn>) {
  if (!runId) return
  const set = activeRunProcesses.get(runId) ?? new Set()
  set.add(child)
  activeRunProcesses.set(runId, set)

  const cleanup = () => {
    const current = activeRunProcesses.get(runId)
    if (!current) return
    current.delete(child)
    if (current.size === 0) {
      activeRunProcesses.delete(runId)
    }
  }

  child.on('close', cleanup)
  child.on('error', cleanup)
}

function truncateOutput(output: string) {
  if (output.length <= MAX_OUTPUT_LENGTH) return output
  const tailLength = Math.max(0, MAX_OUTPUT_LENGTH - TRUNCATION_MESSAGE.length)
  return `${TRUNCATION_MESSAGE}${output.slice(-tailLength)}`
}

function appendOutput(current: string, chunk: string) {
  return truncateOutput(current + chunk)
}

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

function pruneTerminalHistory(now = Date.now()) {
  for (const [id, entry] of backgroundProcesses.entries()) {
    const endedAt = entry.endedAt ?? entry.startedAt
    if (now - endedAt > TERMINAL_HISTORY_TTL_MS) {
      backgroundProcesses.delete(id)
    }
  }

  if (backgroundProcesses.size <= TERMINAL_HISTORY_MAX_ENTRIES) return
  const entries = Array.from(backgroundProcesses.entries())
    .sort((a, b) => {
      const aTime = a[1].endedAt ?? a[1].startedAt
      const bTime = b[1].endedAt ?? b[1].startedAt
      return aTime - bTime
    })
  const overflow = entries.length - TERMINAL_HISTORY_MAX_ENTRIES
  for (let i = 0; i < overflow; i += 1) {
    backgroundProcesses.delete(entries[i][0])
  }
}

function findEntryByProcess(processToFind: ReturnType<typeof spawn>) {
  for (const entry of backgroundProcesses.values()) {
    if (entry.process === processToFind) return entry
  }
  return null
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

type SupportedPackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

function readWorkspacePackageJson(workingDir: string): { scripts?: Record<string, string> } | null {
  const packageJsonPath = path.join(workingDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return null
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf-8')
    return JSON.parse(raw) as { scripts?: Record<string, string> }
  } catch {
    return null
  }
}

function detectWorkspacePackageManager(workingDir: string): SupportedPackageManager {
  const checks: Array<{ file: string; manager: SupportedPackageManager }> = [
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'package-lock.json', manager: 'npm' },
  ]

  for (const check of checks) {
    if (fs.existsSync(path.join(workingDir, check.file))) {
      return check.manager
    }
  }
  return 'npm'
}

function getInstallCommandForPackageManager(pm: SupportedPackageManager): string {
  if (pm === 'bun') return 'bun install'
  if (pm === 'pnpm') return 'pnpm install'
  if (pm === 'yarn') return 'yarn install'
  return 'npm install'
}

function getRunScriptCommand(pm: SupportedPackageManager, scriptName: string): string {
  if (pm === 'bun') return `bun run ${scriptName}`
  if (pm === 'pnpm') return `pnpm run ${scriptName}`
  if (pm === 'yarn') return `yarn ${scriptName}`
  return `npm run ${scriptName}`
}

function getBuildVerificationCommand(workingDir: string): string {
  const packageJson = readWorkspacePackageJson(workingDir)
  if (packageJson?.scripts?.build) {
    return getRunScriptCommand(detectWorkspacePackageManager(workingDir), 'build')
  }

  const evidence = collectProjectEvidence(workingDir)
  if (evidence.files.includes('Cargo.toml')) return 'cargo build'
  if (evidence.files.includes('go.mod')) return 'go build ./...'
  if (evidence.files.includes('pyproject.toml') || evidence.files.includes('requirements.txt')) {
    return 'python -m compileall .'
  }

  return getRunScriptCommand(detectWorkspacePackageManager(workingDir), 'build')
}

function getDevServerStartCommand(workingDir: string): string {
  const packageJson = readWorkspacePackageJson(workingDir)
  const packageManager = detectWorkspacePackageManager(workingDir)
  if (packageJson?.scripts?.dev) {
    return getRunScriptCommand(packageManager, 'dev')
  }
  if (packageJson?.scripts?.start) {
    return getRunScriptCommand(packageManager, 'start')
  }

  const evidence = collectProjectEvidence(workingDir)
  const catalog = loadCapabilityCatalog()
  const suggestions: Array<{ command: string; confidence: number }> = []

  for (const rule of catalog.rules) {
    const fileMatch = (rule.matchAnyFile ?? []).some((candidate) => evidence.files.includes(candidate))
    const scriptMatch = (rule.matchAnyScript ?? []).some((script) => evidence.scripts.includes(script))
    if (!fileMatch && !scriptMatch) continue

    for (const suggestion of rule.suggestedCommands) {
      suggestions.push({ command: suggestion.command, confidence: suggestion.confidence })
    }
  }

  suggestions.sort((a, b) => b.confidence - a.confidence)
  return suggestions[0]?.command ?? getRunScriptCommand(packageManager, 'dev')
}

async function runRipgrep(
  args: string[],
  workingDir: string,
  context?: {
    runId?: string
    timeoutMs?: number
    onLine?: (line: string) => boolean
  }
): Promise<{ stdout: string; terminatedEarly: boolean; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const rg = spawn(rgPath, args, { cwd: workingDir })
    registerRunProcess(context?.runId, rg)
    let stdout = ''
    let stderr = ''
    let buffer = ''
    let terminatedEarly = false
    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined

    const handleLine = (line: string) => {
      if (!context?.onLine) {
        stdout += `${line}\n`
        return
      }
      const shouldStop = context.onLine(line)
      if (shouldStop && !terminatedEarly) {
        terminatedEarly = true
        try {
          rg.kill('SIGTERM')
        } catch {
          // ignore
        }
      }
    }

    rg.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      if (!context?.onLine) {
        stdout += text
        return
      }
      buffer += text
      let idx = buffer.indexOf('\n')
      while (idx !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        handleLine(line)
        if (terminatedEarly) {
          buffer = ''
          break
        }
        idx = buffer.indexOf('\n')
      }
    })
    rg.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    rg.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      reject(err)
    })
    rg.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (context?.onLine && buffer && !terminatedEarly) {
        handleLine(buffer)
        buffer = ''
      }
      if (!terminatedEarly && !timedOut && code && code !== 0) {
        reject(new Error(stderr.trim() || `rg exited with code ${code}`))
        return
      }
      resolve({ stdout, terminatedEarly, timedOut })
    })

    if (context?.timeoutMs && context.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        try {
          rg.kill('SIGTERM')
        } catch {
          // ignore
        }
      }, context.timeoutMs)
    }
  })
}

async function readFile(input: {
  filePath: string
  offset?: number
  limit?: number
  startLine?: number
  endLine?: number
}, workingDir: string) {
  const filePath = resolveToolPath(input.filePath, workingDir)
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)
  const totalLines = lines.length
  const maxLines = 2000

  let offset = 1
  let limit = totalLines

  const hasRange = input.startLine !== undefined || input.endLine !== undefined
  if (hasRange) {
    const startLine = Math.max(1, input.startLine ?? 1)
    const endLine = Math.min(totalLines, input.endLine ?? totalLines)
    offset = Math.min(totalLines, startLine)
    const adjustedEnd = Math.max(offset, endLine)
    limit = Math.max(1, adjustedEnd - offset + 1)
  } else {
    offset = Math.max(1, input.offset ?? 1)
    limit = input.limit ? Math.max(1, input.limit) : totalLines
  }

  const startIndex = Math.min(totalLines, offset) - 1
  const boundedLimit = Math.min(limit, maxLines)
  const endIndex = Math.min(totalLines, startIndex + boundedLimit)

  const slice = lines.slice(startIndex, endIndex)

  const startLine = offset
  const endLine = Math.min(totalLines, offset + boundedLimit - 1)

  return {
    filePath,
    content: slice.join('\n'),
    offset,
    limit: boundedLimit,
    startLine,
    endLine,
    totalLines,
    truncated: endIndex < totalLines || boundedLimit < limit,
  }
}

async function listDir(input: { path: string }, workingDir: string) {
  const dirPath = resolveToolPath(input.path, workingDir)
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  return {
    path: dirPath,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    })),
  }
}

async function findFiles(
  input: { query: string; maxResults?: number },
  workingDir: string,
  context?: { runId?: string }
) {
  const pattern = input.query
  const args = ['--files', '-g', pattern]
  const max = input.maxResults ? Math.max(1, input.maxResults) : 20
  const results: string[] = []
  const { terminatedEarly, timedOut } = await runRipgrep(args, workingDir, {
    runId: context?.runId,
    timeoutMs: 6000,
    onLine: (line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      results.push(trimmed)
      return results.length >= max
    },
  })

  return {
    query: pattern,
    results,
    total: results.length,
    truncated: terminatedEarly || timedOut,
    timedOut,
  }
}

async function grepSearch(
  input: {
    query: string
    isRegexp?: boolean
    includePattern?: string
    maxResults?: number
    includeIgnoredFiles?: boolean
  },
  workingDir: string,
  context?: { runId?: string }
) {
  const max = input.maxResults ? Math.max(1, input.maxResults) : 20
  const args = ['--json']

  if (input.includePattern) {
    args.push('-g', input.includePattern)
  }

  if (input.includeIgnoredFiles) {
    args.push('-uuu')
  }

  if (input.isRegexp === false) {
    args.push('-F')
  }

  args.push(input.query)

  const matches: Array<{ filePath: string; line: number; text: string }> = []
  const { terminatedEarly, timedOut } = await runRipgrep(args, workingDir, {
    runId: context?.runId,
    timeoutMs: 8000,
    onLine: (line) => {
      const trimmed = line.trim()
      if (!trimmed) return false
      try {
        const event = JSON.parse(trimmed)
        if (event.type === 'match') {
          const filePath = event.data.path.text
          const lineNumber = event.data.line_number
          const text = event.data.lines.text
          matches.push({ filePath, line: lineNumber, text })
          return matches.length >= max
        }
      } catch {
        // ignore malformed lines
      }
      return false
    },
  })

  return {
    query: input.query,
    results: matches,
    total: matches.length,
    truncated: terminatedEarly || timedOut,
    timedOut,
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
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  markInternalFsChange(filePath)
  fs.writeFileSync(filePath, input.content ?? '', 'utf-8')

  if (options?.notify) {
    notifyFileChanged(filePath, input.content ?? '', { origin: 'agent' })
  }

  return { filePath }
}

function replaceStringInFile(
  input: { filePath: string; oldString: string; newString: string },
  workingDir: string,
  options?: { notify?: boolean }
) {
  const filePath = resolveToolPath(input.filePath, workingDir)
  const content = fs.readFileSync(filePath, 'utf-8')

  const occurrences = content.split(input.oldString).length - 1
  if (occurrences === 0) {
    throw new Error('Old string not found in file')
  }
  if (occurrences > 1) {
    throw new Error('Old string must match exactly one occurrence')
  }

  const updated = content.replace(input.oldString, input.newString)
  markInternalFsChange(filePath)
  fs.writeFileSync(filePath, updated, 'utf-8')

  if (options?.notify) {
    notifyFileChanged(filePath, updated, { origin: 'agent' })
  }

  return { filePath, replacements: 1 }
}

function multiReplaceString(
  input: { replacements: Array<{ filePath: string; oldString: string; newString: string }> },
  workingDir: string,
  options?: { notify?: boolean }
) {
  const results: Array<{ filePath: string; replacements: number }> = []

  for (const replacement of input.replacements) {
    const filePath = resolveToolPath(replacement.filePath, workingDir)
    const content = fs.readFileSync(filePath, 'utf-8')

    const occurrences = content.split(replacement.oldString).length - 1
    if (occurrences === 0) {
      throw new Error(`Old string not found in file: ${replacement.filePath}`)
    }
    if (occurrences > 1) {
      throw new Error(`Old string must match exactly one occurrence in file: ${replacement.filePath}`)
    }

    const updated = content.replace(replacement.oldString, replacement.newString)
    markInternalFsChange(filePath)
    fs.writeFileSync(filePath, updated, 'utf-8')
    if (options?.notify) {
      notifyFileChanged(filePath, updated, { origin: 'agent' })
    }
    results.push({ filePath, replacements: 1 })
  }

  return { results }
}

async function runInTerminal(input: {
  command: string
  explanation?: string
  isBackground?: boolean
  timeout?: number
}, workingDir: string, context?: { runId?: string }) {
  if (!input.command || typeof input.command !== 'string') {
    throw new Error('command is required')
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

  const isBackground = Boolean(input.isBackground)
  const timeoutMs = typeof input.timeout === 'number'
    ? Math.max(0, input.timeout)
    : isBackground
      ? 0
      : 120_000
  const runtimeEnv = createRuntimeEnv(getRuntimePathPrefixes(), process.env)

  const shouldDetach = process.platform !== 'win32'
  const child = spawn(input.command, {
    cwd: workingDir,
    shell: true,
    env: runtimeEnv,
    detached: shouldDetach,
  })
  if (shouldDetach) {
    ;(child as { __agentDetached?: boolean }).__agentDetached = true
  }

  const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const entry: BackgroundProcess = {
    id,
    command: input.command,
    startedAt: Date.now(),
    stdout: '',
    stderr: '',
    process: child,
    cancelled: false,
    timedOut: false,
  }
  backgroundProcesses.set(id, entry)
  pruneTerminalHistory()

  child.stdout.on('data', (chunk) => {
    entry.stdout = appendOutput(entry.stdout, chunk.toString())
  })
  child.stderr.on('data', (chunk) => {
    entry.stderr = appendOutput(entry.stderr, chunk.toString())
  })
  child.on('close', (code) => {
    entry.exitCode = code
    entry.endedAt = Date.now()
  })
  child.on('error', (err) => {
    entry.stderr = appendOutput(entry.stderr, `${err.message}\n`)
    entry.exitCode = -1
    entry.endedAt = Date.now()
  })

  if (isBackground) {
    registerRunProcess(context?.runId, child)

    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!entry.endedAt) {
          entry.timedOut = true
          terminateProcess(child)
        }
      }, timeoutMs)
    }

    const executionState = getTerminalExecutionState({
      running: true,
      exitCode: null,
      timedOut: false,
      cancelled: false,
    })

    return {
      id,
      pid: child.pid,
      command: input.command,
      isBackground: true,
      running: true,
      timedOut: false,
      cancelled: false,
      success: executionState.success,
      status: executionState.status,
    }
  }

  registerRunProcess(context?.runId, child)

  return new Promise((resolve) => {
    let timeoutHandle: NodeJS.Timeout | undefined

    const finish = (code: number | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      entry.exitCode = code
      entry.endedAt = Date.now()
      const executionState = getTerminalExecutionState({
        running: false,
        exitCode: code,
        timedOut: entry.timedOut ?? false,
        cancelled: entry.cancelled ?? false,
      })
      resolve({
        id,
        command: input.command,
        stdout: truncateOutput(entry.stdout),
        stderr: truncateOutput(entry.stderr),
        exitCode: code,
        running: false,
        timedOut: entry.timedOut ?? false,
        cancelled: entry.cancelled ?? false,
        success: executionState.success,
        status: executionState.status,
        ...(executionState.error ? { error: executionState.error } : {}),
      })
    }
    child.on('close', (code) => finish(code))
    child.on('error', (err) => {
      entry.stderr = appendOutput(entry.stderr, `${err.message}\n`)
      finish(-1)
    })

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        entry.timedOut = true
        terminateProcess(child)
      }, timeoutMs)
    }
  })
}

async function installDependencies(
  input: InstallDependenciesInput,
  workingDir: string,
  context?: { runId?: string }
) {
  const packageManager = input.packageManager ?? detectWorkspacePackageManager(workingDir)
  const command = getInstallCommandForPackageManager(packageManager)
  return runInTerminal({
    command,
    explanation: 'Install project dependencies using the detected package manager.',
    isBackground: false,
    timeout: typeof input.timeout === 'number' ? input.timeout : 120_000,
  }, workingDir, context)
}

async function verifyBuild(
  input: VerifyBuildInput,
  workingDir: string,
  context?: { runId?: string }
) {
  const command = input.command?.trim() || getBuildVerificationCommand(workingDir)
  return runInTerminal({
    command,
    explanation: 'Verify the project build succeeds.',
    isBackground: false,
    timeout: typeof input.timeout === 'number' ? input.timeout : 120_000,
  }, workingDir, context)
}

async function startDevServer(
  input: StartDevServerInput,
  workingDir: string,
  context?: { runId?: string }
) {
  const command = input.command?.trim() || getDevServerStartCommand(workingDir)
  return runInTerminal({
    command,
    explanation: 'Start the project development server.',
    isBackground: input.isBackground ?? true,
    timeout: typeof input.timeout === 'number' ? input.timeout : 0,
  }, workingDir, context)
}

async function getTerminalOutput(input: { id: string }) {
  if (!input.id || typeof input.id !== 'string') {
    throw new Error('id is required')
  }
  const id = input.id.trim()
  if (!id) {
    throw new Error('id is required')
  }

  pruneTerminalHistory()

  const entry = backgroundProcesses.get(id)
  if (entry) {
    const running = entry.endedAt === undefined
    const executionState = getTerminalExecutionState({
      running,
      exitCode: entry.exitCode ?? null,
      timedOut: entry.timedOut ?? false,
      cancelled: entry.cancelled ?? false,
    })
    return {
      id: entry.id,
      command: entry.command,
      stdout: entry.stdout,
      stderr: entry.stderr,
      exitCode: entry.exitCode ?? null,
      running,
      startedAt: entry.startedAt,
      endedAt: entry.endedAt ?? null,
      timedOut: entry.timedOut ?? false,
      cancelled: entry.cancelled ?? false,
      success: executionState.success,
      status: executionState.status,
      ...(executionState.error ? { error: executionState.error } : {}),
    }
  }

  const terminalSnapshot = TerminalService.getInstance().getTerminalSnapshot(id)
  if (terminalSnapshot) {
    const executionState = getTerminalExecutionState({
      running: terminalSnapshot.running,
      exitCode: terminalSnapshot.exitCode,
      timedOut: terminalSnapshot.timedOut,
      cancelled: terminalSnapshot.cancelled,
    })
    return {
      id: terminalSnapshot.id,
      command: terminalSnapshot.command ?? '',
      stdout: terminalSnapshot.stdout,
      stderr: terminalSnapshot.stderr,
      exitCode: terminalSnapshot.exitCode,
      running: terminalSnapshot.running,
      startedAt: terminalSnapshot.startedAt,
      endedAt: terminalSnapshot.endedAt,
      timedOut: terminalSnapshot.timedOut,
      cancelled: terminalSnapshot.cancelled,
      success: executionState.success,
      status: executionState.status,
      ...(executionState.error ? { error: executionState.error } : {}),
    }
  }

  throw new Error('Unknown terminal id')
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
    switch (request.name) {
      case 'read':
        return { success: true, output: await readFile(request.input as ReadFileInput, workingDir) }
      case 'list':
        return { success: true, output: await listDir(request.input as ListDirInput, workingDir) }
      case 'glob':
        return {
          success: true,
          output: await findFiles(request.input as FindFilesInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'grep':
        return {
          success: true,
          output: await grepSearch(request.input as GrepSearchInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'write':
        return { success: true, output: await createFile(request.input as CreateFileInput, workingDir, { notify: shouldNotify }) }
      case 'edit':
        return {
          success: true,
          output: replaceStringInFile(request.input as ReplaceStringInput, workingDir, { notify: shouldNotify }),
        }
      case 'multiedit':
        return {
          success: true,
          output: multiReplaceString(request.input as MultiReplaceInput, workingDir, { notify: shouldNotify }),
        }
      case 'bash':
        return {
          success: true,
          output: await runInTerminal(request.input as RunInTerminalInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'install_dependencies':
        return {
          success: true,
          output: await installDependencies(request.input as InstallDependenciesInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'verify_build':
        return {
          success: true,
          output: await verifyBuild(request.input as VerifyBuildInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'start_dev_server':
        return {
          success: true,
          output: await startDevServer(request.input as StartDevServerInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'get_terminal_output':
        return { success: true, output: await getTerminalOutput(request.input as GetTerminalOutputInput) }
      case 'apply_patch':
        return { success: false, error: 'apply_patch is not yet enabled in this runtime' }
      default:
        return { success: false, error: `Unknown tool: ${request.name}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Tool failed' }
  }
}

export function cancelToolRuns(runId: string): { success: boolean; canceled: number } {
  if (!runId) return { success: false, canceled: 0 }
  const processes = activeRunProcesses.get(runId)
  if (!processes || processes.size === 0) {
    return { success: true, canceled: 0 }
  }

  let canceled = 0
  for (const child of processes) {
    const entry = findEntryByProcess(child)
    if (entry) {
      entry.cancelled = true
      entry.endedAt = entry.endedAt ?? Date.now()
      entry.exitCode = entry.exitCode ?? -1
      entry.stderr = appendOutput(entry.stderr, '\n[Process cancelled by user]')
    }
    terminateProcess(child)
    canceled++
  }

  return { success: true, canceled }
}

export function getWorkspaceRoot() {
  return WORKSPACE_ROOT
}
