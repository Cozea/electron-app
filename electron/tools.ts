import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

export interface ToolRequest {
  name: string
  input: Record<string, any>
}

export interface ToolResult {
  success: boolean
  output?: any
  error?: string
}

const WORKSPACE_ROOT = path.resolve(
  process.env.COZEA_WORKSPACE_ROOT || process.env.APP_ROOT || process.cwd()
)

function resolveToolPath(inputPath: string): string {
  const resolved = path.resolve(
    path.isAbsolute(inputPath) ? inputPath : path.join(WORKSPACE_ROOT, inputPath)
  )
  const relative = path.relative(WORKSPACE_ROOT, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside of the workspace')
  }
  return resolved
}

async function runRipgrep(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const rg = spawn('rg', args, { cwd: WORKSPACE_ROOT })
    let stdout = ''
    let stderr = ''

    rg.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    rg.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    rg.on('error', (err) => {
      reject(err)
    })
    rg.on('close', (code) => {
      if (code && code !== 0) {
        reject(new Error(stderr.trim() || `rg exited with code ${code}`))
        return
      }
      resolve(stdout)
    })
  })
}

async function readFile(input: {
  filePath: string
  offset?: number
  limit?: number
  startLine?: number
  endLine?: number
}) {
  const filePath = resolveToolPath(input.filePath)
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

async function listDir(input: { path: string }) {
  const dirPath = resolveToolPath(input.path)
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })

  return {
    path: dirPath,
    entries: entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
    })),
  }
}

async function findFiles(input: { query: string; maxResults?: number }) {
  const pattern = input.query
  const args = ['--files', '-g', pattern]
  const raw = await runRipgrep(args)
  const results = raw.split(/\r?\n/).filter(Boolean)
  const max = input.maxResults ? Math.max(1, input.maxResults) : 20

  return {
    query: pattern,
    results: results.slice(0, max),
    total: results.length,
    truncated: results.length > max,
  }
}

async function grepSearch(input: {
  query: string
  isRegexp?: boolean
  includePattern?: string
  maxResults?: number
  includeIgnoredFiles?: boolean
}) {
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

  const raw = await runRipgrep(args)
  const matches: Array<{ filePath: string; line: number; text: string }> = []

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'match') {
        const filePath = event.data.path.text
        const lineNumber = event.data.line_number
        const text = event.data.lines.text
        matches.push({ filePath, line: lineNumber, text })
      }
    } catch {
      // ignore malformed lines
    }
  }

  return {
    query: input.query,
    results: matches.slice(0, max),
    total: matches.length,
    truncated: matches.length > max,
  }
}

async function createFile(input: { filePath: string; content: string }) {
  const filePath = resolveToolPath(input.filePath)
  if (fs.existsSync(filePath)) {
    throw new Error('File already exists')
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, input.content ?? '', 'utf-8')
  return { filePath }
}

async function createDirectory(input: { dirPath?: string; path?: string }) {
  const targetPath = input.dirPath ?? input.path
  if (!targetPath) {
    throw new Error('dirPath is required')
  }
  const dirPath = resolveToolPath(targetPath)
  fs.mkdirSync(dirPath, { recursive: true })
  return { dirPath }
}

function replaceStringInFile(input: { filePath: string; oldString: string; newString: string }) {
  const filePath = resolveToolPath(input.filePath)
  const content = fs.readFileSync(filePath, 'utf-8')

  const occurrences = content.split(input.oldString).length - 1
  if (occurrences === 0) {
    throw new Error('Old string not found in file')
  }
  if (occurrences > 1) {
    throw new Error('Old string must match exactly one occurrence')
  }

  const updated = content.replace(input.oldString, input.newString)
  fs.writeFileSync(filePath, updated, 'utf-8')

  return { filePath, replacements: 1 }
}

function multiReplaceString(input: { replacements: Array<{ filePath: string; oldString: string; newString: string }> }) {
  const results: Array<{ filePath: string; replacements: number }> = []

  for (const replacement of input.replacements) {
    const filePath = resolveToolPath(replacement.filePath)
    const content = fs.readFileSync(filePath, 'utf-8')

    const occurrences = content.split(replacement.oldString).length - 1
    if (occurrences === 0) {
      throw new Error(`Old string not found in file: ${replacement.filePath}`)
    }
    if (occurrences > 1) {
      throw new Error(`Old string must match exactly one occurrence in file: ${replacement.filePath}`)
    }

    const updated = content.replace(replacement.oldString, replacement.newString)
    fs.writeFileSync(filePath, updated, 'utf-8')
    results.push({ filePath, replacements: 1 })
  }

  return { results }
}

export async function runTool(request: ToolRequest): Promise<ToolResult> {
  try {
    switch (request.name) {
      case 'read_file':
        return { success: true, output: await readFile(request.input as any) }
      case 'list_dir':
        return { success: true, output: await listDir(request.input as any) }
      case 'file_search':
        return { success: true, output: await findFiles(request.input as any) }
      case 'grep_search':
        return { success: true, output: await grepSearch(request.input as any) }
      case 'create_file':
        return { success: true, output: await createFile(request.input as any) }
      case 'create_directory':
        return { success: true, output: await createDirectory(request.input as any) }
      case 'replace_string_in_file':
        return { success: true, output: replaceStringInFile(request.input as any) }
      case 'multi_replace_string_in_file':
        return { success: true, output: multiReplaceString(request.input as any) }
      case 'apply_patch':
        return { success: false, error: 'apply_patch is not yet enabled in this runtime' }
      default:
        return { success: false, error: `Unknown tool: ${request.name}` }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Tool failed' }
  }
}

export function getWorkspaceRoot() {
  return WORKSPACE_ROOT
}
