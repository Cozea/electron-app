import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { notifyFileChanged } from './yjsNotify'
import { markInternalFsChange } from './projectWatcher'

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

interface CreateDirectoryInput {
  dirPath?: string
  path?: string
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

const WORKSPACE_ROOT = path.resolve(
  process.env.COZEA_WORKSPACE_ROOT || process.env.APP_ROOT || process.cwd()
)

const MAX_OUTPUT_LENGTH = 60_000
const TRUNCATION_MESSAGE = '\n...output truncated...\n'

interface BackgroundProcess {
  id: string
  command: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  timedOut?: boolean
  stdout: string
  stderr: string
  process: ReturnType<typeof spawn>
}

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

async function createDirectory(input: { dirPath?: string; path?: string }, workingDir: string) {
  const targetPath = input.dirPath ?? input.path
  if (!targetPath) {
    throw new Error('dirPath is required')
  }
  const dirPath = resolveToolPath(targetPath, workingDir)
  fs.mkdirSync(dirPath, { recursive: true })
  return { dirPath }
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

  const isBackground = Boolean(input.isBackground)
  const timeoutMs = typeof input.timeout === 'number'
    ? Math.max(0, input.timeout)
    : isBackground
      ? 0
      : 120_000

  const shouldDetach = process.platform !== 'win32'
  const child = spawn(input.command, {
    cwd: workingDir,
    shell: true,
    env: process.env,
    detached: shouldDetach,
  })
  if (shouldDetach) {
    ;(child as { __agentDetached?: boolean }).__agentDetached = true
  }

  if (isBackground) {
    const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const entry: BackgroundProcess = {
      id,
      command: input.command,
      startedAt: Date.now(),
      stdout: '',
      stderr: '',
      process: child,
    }

    registerRunProcess(context?.runId, child)

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

    if (timeoutMs > 0) {
      setTimeout(() => {
        if (!entry.endedAt) {
          entry.timedOut = true
          terminateProcess(child)
        }
      }, timeoutMs)
    }

    backgroundProcesses.set(id, entry)
    return { id, pid: child.pid, command: input.command, isBackground: true }
  }

  registerRunProcess(context?.runId, child)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let timeoutHandle: NodeJS.Timeout | undefined

    const finish = (code: number | null) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      resolve({
        command: input.command,
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode: code,
        timedOut,
      })
    }

    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk.toString())
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk.toString())
    })
    child.on('close', (code) => finish(code))
    child.on('error', (err) => {
      stderr = appendOutput(stderr, `${err.message}\n`)
      finish(-1)
    })

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        terminateProcess(child)
      }, timeoutMs)
    }
  })
}

async function getTerminalOutput(input: { id: string }) {
  if (!input.id || typeof input.id !== 'string') {
    throw new Error('id is required')
  }
  const entry = backgroundProcesses.get(input.id)
  if (!entry) {
    throw new Error('Unknown terminal id')
  }

  return {
    id: entry.id,
    command: entry.command,
    stdout: entry.stdout,
    stderr: entry.stderr,
    exitCode: entry.exitCode ?? null,
    running: entry.endedAt === undefined,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt ?? null,
    timedOut: entry.timedOut ?? false,
  }
}

export async function runTool(request: ToolRequest): Promise<ToolResult> {
  // Use projectPath if provided, otherwise fall back to global WORKSPACE_ROOT
  const workingDir = request.projectPath || WORKSPACE_ROOT
  const shouldNotify = Boolean(request.projectPath)

  try {
    switch (request.name) {
      case 'read_file':
        return { success: true, output: await readFile(request.input as ReadFileInput, workingDir) }
      case 'list_dir':
        return { success: true, output: await listDir(request.input as ListDirInput, workingDir) }
      case 'file_search':
        return {
          success: true,
          output: await findFiles(request.input as FindFilesInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'grep_search':
        return {
          success: true,
          output: await grepSearch(request.input as GrepSearchInput, workingDir, {
            runId: request.runId,
          }),
        }
      case 'create_file':
        return { success: true, output: await createFile(request.input as CreateFileInput, workingDir, { notify: shouldNotify }) }
      case 'create_directory':
        return { success: true, output: await createDirectory(request.input as CreateDirectoryInput, workingDir) }
      case 'replace_string_in_file':
        return {
          success: true,
          output: replaceStringInFile(request.input as ReplaceStringInput, workingDir, { notify: shouldNotify }),
        }
      case 'multi_replace_string_in_file':
        return {
          success: true,
          output: multiReplaceString(request.input as MultiReplaceInput, workingDir, { notify: shouldNotify }),
        }
      case 'run_in_terminal':
        return {
          success: true,
          output: await runInTerminal(request.input as RunInTerminalInput, workingDir, {
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
    terminateProcess(child)
    canceled++
  }

  return { success: true, canceled }
}

export function getWorkspaceRoot() {
  return WORKSPACE_ROOT
}
