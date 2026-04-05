import { ipcMain } from 'electron'

import { forEachBroadcastWindow } from '../broadcastWindows'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'

type DiagnosticSource = 'tsserver' | 'eslint' | 'runtime' | 'build'
type DiagnosticSeverity = 'error' | 'warning' | 'info'

interface ESLintMessage {
  severity: 0 | 1 | 2
  message: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  ruleId?: string | null
}

interface ESLintResult {
  filePath: string
  messages: ESLintMessage[]
}

interface ESLintInstance {
  lintText: (content: string, options: { filePath: string }) => Promise<ESLintResult[]>
}

interface ESLintConstructorOptions {
  cwd: string
  useEslintrc?: boolean
}

type ESLintConstructor = new (options: ESLintConstructorOptions) => ESLintInstance

export interface DiagnosticItem {
  id?: string
  source: DiagnosticSource
  severity: DiagnosticSeverity
  message: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  code?: string
  related?: Array<{ message: string; file?: string; line?: number; column?: number }>
}

interface ProjectContext {
  projectPath: string
  tsServer?: TsServerClient
  eslint?: ESLintRunner
  openFiles: Map<string, { content: string }>
  tsDiagnosticsByFile: Map<string, DiagnosticItem[]>
  eslintDiagnosticsByFile: Map<string, DiagnosticItem[]>
}

interface DiagnosticsSnapshotOptions {
  filePaths?: string[]
}

interface CheckFilesOptions {
  filePaths: string[]
  timeoutMs?: number
}

const appRequire = createRequire(import.meta.url)

function resolveModule(moduleName: string, projectPath: string): string | null {
  try {
    const projectRequire = createRequire(path.join(projectPath, 'package.json'))
    return projectRequire.resolve(moduleName)
  } catch {
    // ignore
  }
  try {
    return appRequire.resolve(moduleName)
  } catch {
    return null
  }
}

function resolveTsServerPath(tsModulePath: string): string | null {
  const baseDir = path.dirname(tsModulePath)
  const candidate = path.join(baseDir, 'tsserver.js')
  if (fs.existsSync(candidate)) return candidate
  return null
}

function sendToRenderers(channel: string, payload: unknown) {
  forEachBroadcastWindow((win) => {
    if (win.webContents.isDestroyed()) return
    win.webContents.send(channel, payload)
  })
}

function buildMissingToolDiagnostic(source: DiagnosticSource, message: string): DiagnosticItem[] {
  return [
    {
      source,
      severity: 'info',
      message,
    },
  ]
}

class TsServerClient {
  private process: ChildProcessWithoutNullStreams
  private seq = 0
  private buffer = ''
  private openFiles = new Map<string, { version: number; content: string; getErrTimer?: NodeJS.Timeout }>()
  private diagnosticsByFile = new Map<
    string,
    { syntax: DiagnosticItem[]; semantic: DiagnosticItem[]; suggestion: DiagnosticItem[] }
  >()

  constructor(
    private readonly projectPath: string,
    private readonly tsServerPath: string,
    private readonly onDiagnostics: (filePath: string, diagnostics: DiagnosticItem[]) => void
  ) {
    this.process = spawn(process.execPath, [this.tsServerPath], {
      cwd: this.projectPath,
      stdio: 'pipe',
      env: {
        ...process.env,
        // Run the Electron binary in Node mode so it doesn't create a Dock icon on macOS.
        ELECTRON_RUN_AS_NODE: '1',
      },
    })

    this.process.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString()
      this.processBuffer()
    })

    this.process.stderr.on('data', () => {
      // Swallow tsserver stderr output (often verbose)
    })
  }

  dispose() {
    this.openFiles.forEach((entry) => {
      if (entry.getErrTimer) clearTimeout(entry.getErrTimer)
    })
    this.process.kill()
  }

  openFile(filePath: string, content: string) {
    const entry = this.openFiles.get(filePath)
    if (!entry) {
      this.openFiles.set(filePath, { version: 1, content })
    } else {
      entry.content = content
      entry.version += 1
    }
    this.sendRequest('open', {
      file: filePath,
      fileContent: content,
      projectRootPath: this.projectPath,
    })
    this.scheduleGetErr(filePath)
  }

  updateFile(filePath: string, content: string) {
    const entry = this.openFiles.get(filePath)
    if (!entry) {
      this.openFile(filePath, content)
      return
    }

    const { line: endLine, offset: endOffset } = getEndPosition(entry.content)
    entry.content = content
    entry.version += 1

    this.sendRequest('change', {
      file: filePath,
      line: 1,
      offset: 1,
      endLine,
      endOffset,
      insertString: content,
    })

    this.scheduleGetErr(filePath)
  }

  closeFile(filePath: string) {
    const entry = this.openFiles.get(filePath)
    if (entry?.getErrTimer) clearTimeout(entry.getErrTimer)
    this.openFiles.delete(filePath)
    this.diagnosticsByFile.delete(filePath)
    this.sendRequest('close', { file: filePath })
  }

  refresh(files: string[]) {
    if (!files.length) return
    this.sendRequest('geterr', { files, delay: 0 })
  }

  private scheduleGetErr(filePath: string) {
    const entry = this.openFiles.get(filePath)
    if (!entry) return
    if (entry.getErrTimer) clearTimeout(entry.getErrTimer)
    entry.getErrTimer = setTimeout(() => {
      this.sendRequest('geterr', { files: [filePath], delay: 0 })
    }, 300)
  }

  private sendRequest(command: string, args: Record<string, unknown>) {
    const body = JSON.stringify({
      seq: ++this.seq,
      type: 'request',
      command,
      arguments: args,
    })
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`
    this.process.stdin.write(header + body)
  }

  private processBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const lengthMatch = /Content-Length: (\d+)/i.exec(header)
      if (!lengthMatch) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const length = Number(lengthMatch[1])
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + length) return
      const body = this.buffer.slice(bodyStart, bodyStart + length)
      this.buffer = this.buffer.slice(bodyStart + length)

      try {
        const message = JSON.parse(body)
        if (message.type === 'event') {
          this.handleEvent(message.event, message.body)
        }
      } catch {
        // ignore malformed messages
      }
    }
  }

  private handleEvent(event: string, body: {
    file?: string
    diagnostics?: Array<{
      start: { line: number; offset: number }
      end: { line: number; offset: number }
      text: string
      code?: number
      category: 'error' | 'warning' | 'message' | 'suggestion'
      relatedInformation?: Array<{
        message: string
        file?: string
        start?: { line: number; offset: number }
        end?: { line: number; offset: number }
      }>
    }>
  }) {
    if (!['syntaxDiag', 'semanticDiag', 'suggestionDiag'].includes(event)) return
    if (!body?.file) return

    const diagnostics = (body.diagnostics ?? []).map((diag) => {
      const severity = toSeverity(diag.category)
      return {
        source: 'tsserver' as const,
        severity,
        message: diag.text,
        file: body.file,
        line: diag.start?.line,
        column: diag.start?.offset,
        endLine: diag.end?.line,
        endColumn: diag.end?.offset,
        code: diag.code ? String(diag.code) : undefined,
        related: diag.relatedInformation?.map((info) => ({
          message: info.message,
          file: info.file,
          line: info.start?.line,
          column: info.start?.offset,
        })),
      } satisfies DiagnosticItem
    })

    const key = event === 'syntaxDiag' ? 'syntax' : event === 'semanticDiag' ? 'semantic' : 'suggestion'
    const current = this.diagnosticsByFile.get(body.file) ?? { syntax: [], semantic: [], suggestion: [] }
    current[key] = diagnostics
    this.diagnosticsByFile.set(body.file, current)
    const combined = [...current.syntax, ...current.semantic, ...current.suggestion]
    this.onDiagnostics(body.file, combined)
  }
}

class ESLintRunner {
  private eslint: ESLintInstance
  private readonly lintTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly projectPath: string,
    eslintModulePath: string,
    private readonly onDiagnostics: (filePath: string, diagnostics: DiagnosticItem[]) => void
  ) {
    const eslintModule = appRequire(eslintModulePath)
    const ESLintClass = (eslintModule.ESLint ?? eslintModule.default?.ESLint ?? eslintModule) as ESLintConstructor
    try {
      this.eslint = new ESLintClass({ cwd: this.projectPath, useEslintrc: true })
    } catch {
      this.eslint = new ESLintClass({ cwd: this.projectPath })
    }
  }

  dispose() {
    this.lintTimers.forEach((timer) => clearTimeout(timer))
    this.lintTimers.clear()
  }

  scheduleLint(filePath: string, content: string) {
    const existing = this.lintTimers.get(filePath)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      void this.runLint(filePath, content)
    }, 400)
    this.lintTimers.set(filePath, timer)
  }

  async runLint(filePath: string, content: string) {
    try {
      const results = await this.eslint.lintText(content, { filePath })
      const diagnostics = results.flatMap((result) =>
        (result.messages ?? []).map((message) => ({
          source: 'eslint' as const,
          severity: message.severity === 1 ? 'warning' : message.severity === 2 ? 'error' : 'info',
          message: message.message,
          file: result.filePath,
          line: message.line,
          column: message.column,
          endLine: message.endLine,
          endColumn: message.endColumn,
          code: message.ruleId ?? undefined,
        }))
      ) as DiagnosticItem[]
      this.onDiagnostics(filePath, diagnostics)
    } catch (err) {
      this.onDiagnostics(filePath, [
        {
          source: 'eslint',
          severity: 'info',
          message: err instanceof Error ? err.message : 'ESLint failed to run',
          file: filePath,
        },
      ])
    }
  }
}

function getEndPosition(content: string): { line: number; offset: number } {
  const lines = content.split(/\r\n|\n|\r/)
  const line = Math.max(1, lines.length)
  const offset = (lines[lines.length - 1]?.length ?? 0) + 1
  return { line, offset }
}

function toSeverity(category: string): DiagnosticSeverity {
  if (category === 'warning') return 'warning'
  if (category === 'error') return 'error'
  return 'info'
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DiagnosticsService {
  private static instance: DiagnosticsService
  private projects = new Map<string, ProjectContext>()

  static getInstance(): DiagnosticsService {
    if (!DiagnosticsService.instance) {
      DiagnosticsService.instance = new DiagnosticsService()
    }
    return DiagnosticsService.instance
  }

  registerIpcHandlers() {
    ipcMain.handle('diagnostics:start', async (_event, options: { projectPath: string }) => {
      try {
        this.ensureProject(options.projectPath)
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Failed to start diagnostics' }
      }
    })

    ipcMain.handle('diagnostics:stop', async (_event, options: { projectPath: string }) => {
      this.stopProject(options.projectPath)
      return { success: true }
    })

    ipcMain.handle('diagnostics:openFile', async (_event, options: { projectPath: string; filePath: string; content: string }) => {
      const ctx = this.ensureProject(options.projectPath)
      ctx.openFiles.set(options.filePath, { content: options.content })
      ctx.tsServer?.openFile(options.filePath, options.content)
      ctx.eslint?.scheduleLint(options.filePath, options.content)
      return { success: true }
    })

    ipcMain.handle('diagnostics:updateFile', async (_event, options: { projectPath: string; filePath: string; content: string }) => {
      const ctx = this.ensureProject(options.projectPath)
      ctx.openFiles.set(options.filePath, { content: options.content })
      ctx.tsServer?.updateFile(options.filePath, options.content)
      ctx.eslint?.scheduleLint(options.filePath, options.content)
      return { success: true }
    })

    ipcMain.handle('diagnostics:closeFile', async (_event, options: { projectPath: string; filePath: string }) => {
      const ctx = this.ensureProject(options.projectPath)
      ctx.openFiles.delete(options.filePath)
      ctx.tsServer?.closeFile(options.filePath)
      ctx.tsDiagnosticsByFile.delete(options.filePath)
      ctx.eslintDiagnosticsByFile.delete(options.filePath)
      this.publishDiagnostics(options.projectPath, 'tsserver', ctx.tsDiagnosticsByFile)
      this.publishDiagnostics(options.projectPath, 'eslint', ctx.eslintDiagnosticsByFile)
      return { success: true }
    })

    ipcMain.handle('diagnostics:refresh', async (_event, options: { projectPath: string }) => {
      const ctx = this.ensureProject(options.projectPath)
      const files = Array.from(ctx.openFiles.keys())
      ctx.tsServer?.refresh(files)
      files.forEach((filePath) => {
        const entry = ctx.openFiles.get(filePath)
        if (entry) {
          ctx.eslint?.scheduleLint(filePath, entry.content)
        }
      })
      return { success: true }
    })

    ipcMain.handle('diagnostics:getSnapshot', async (_event, options: { projectPath: string; filePaths?: string[] }) => {
      try {
        const diagnostics = this.getSnapshot(options.projectPath, { filePaths: options.filePaths })
        return { success: true, diagnostics }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to get diagnostics snapshot',
          diagnostics: [] as DiagnosticItem[],
        }
      }
    })

    ipcMain.handle('diagnostics:getDiagnostics', async (_event, options: { projectPath: string; filePath?: string }) => {
      try {
        const diagnostics = this.getSnapshot(options.projectPath, {
          filePaths: options.filePath ? [options.filePath] : undefined,
        })
        return { success: true, diagnostics }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to get diagnostics',
          diagnostics: [] as DiagnosticItem[],
        }
      }
    })

    ipcMain.handle('diagnostics:checkFiles', async (_event, options: { projectPath: string; filePaths: string[]; timeoutMs?: number }) => {
      try {
        const diagnostics = await this.checkFiles(options.projectPath, {
          filePaths: options.filePaths,
          timeoutMs: options.timeoutMs,
        })
        return { success: true, diagnostics }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to check files for diagnostics',
          diagnostics: [] as DiagnosticItem[],
        }
      }
    })
  }

  private ensureProject(projectPath: string): ProjectContext {
    const existing = this.projects.get(projectPath)
    if (existing) return existing

    const ctx: ProjectContext = {
      projectPath,
      openFiles: new Map(),
      tsDiagnosticsByFile: new Map(),
      eslintDiagnosticsByFile: new Map(),
    }

    const tsModulePath = resolveModule('typescript', projectPath)
    if (!tsModulePath) {
      sendToRenderers('diagnostics:publish', {
        projectPath,
        source: 'tsserver',
        diagnostics: buildMissingToolDiagnostic('tsserver', 'TypeScript not found. Install it in the project to enable diagnostics.'),
      })
    } else {
      const tsServerPath = resolveTsServerPath(tsModulePath)
      if (!tsServerPath) {
        sendToRenderers('diagnostics:publish', {
          projectPath,
          source: 'tsserver',
          diagnostics: buildMissingToolDiagnostic('tsserver', 'tsserver.js not found in TypeScript installation.'),
        })
      } else {
        ctx.tsServer = new TsServerClient(projectPath, tsServerPath, (filePath, diagnostics) => {
          ctx.tsDiagnosticsByFile.set(filePath, diagnostics)
          this.publishDiagnostics(projectPath, 'tsserver', ctx.tsDiagnosticsByFile)
        })
      }
    }

    const eslintModulePath = resolveModule('eslint', projectPath)
    if (!eslintModulePath) {
      sendToRenderers('diagnostics:publish', {
        projectPath,
        source: 'eslint',
        diagnostics: buildMissingToolDiagnostic('eslint', 'ESLint not found. Install it in the project to enable diagnostics.'),
      })
    } else {
      ctx.eslint = new ESLintRunner(projectPath, eslintModulePath, (filePath, diagnostics) => {
        ctx.eslintDiagnosticsByFile.set(filePath, diagnostics)
        this.publishDiagnostics(projectPath, 'eslint', ctx.eslintDiagnosticsByFile)
      })
    }

    this.projects.set(projectPath, ctx)
    return ctx
  }

  private stopProject(projectPath: string) {
    const ctx = this.projects.get(projectPath)
    if (!ctx) return
    ctx.tsServer?.dispose()
    ctx.eslint?.dispose()
    this.projects.delete(projectPath)
  }

  private resolveProjectFilePath(projectPath: string, filePath: string): string | null {
    const resolved = path.resolve(
      path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath)
    )
    const relative = path.relative(projectPath, resolved)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null
    }
    return resolved
  }

  private buildSnapshotDiagnostics(
    ctx: ProjectContext,
    options?: DiagnosticsSnapshotOptions
  ): DiagnosticItem[] {
    const sourceMaps: Array<[DiagnosticSource, Map<string, DiagnosticItem[]>]> = [
      ['tsserver', ctx.tsDiagnosticsByFile],
      ['eslint', ctx.eslintDiagnosticsByFile],
    ]

    const allowedPaths = new Set<string>()
    if (options?.filePaths?.length) {
      for (const filePath of options.filePaths) {
        const resolved = this.resolveProjectFilePath(ctx.projectPath, filePath)
        if (resolved) {
          allowedPaths.add(resolved)
        }
      }
    }

    const diagnostics: DiagnosticItem[] = []
    sourceMaps.forEach(([source, map]) => {
      map.forEach((items, filePath) => {
        if (allowedPaths.size > 0 && !allowedPaths.has(filePath)) return
        items.forEach((item) => {
          diagnostics.push({
            ...item,
            source,
          })
        })
      })
    })

    return diagnostics
  }

  private getSnapshot(projectPath: string, options?: DiagnosticsSnapshotOptions): DiagnosticItem[] {
    const ctx = this.ensureProject(projectPath)
    return this.buildSnapshotDiagnostics(ctx, options)
  }

  public async checkFiles(
    projectPath: string,
    options: CheckFilesOptions
  ): Promise<DiagnosticItem[]> {
    const ctx = this.ensureProject(projectPath)
    const requested = Array.isArray(options.filePaths) ? options.filePaths : []
    if (requested.length === 0) {
      return this.buildSnapshotDiagnostics(ctx)
    }

    const normalizedPaths: string[] = []
    const lintPromises: Array<Promise<void>> = []

    for (const requestedPath of requested) {
      if (typeof requestedPath !== 'string' || requestedPath.trim().length === 0) {
        continue
      }

      const resolvedPath = this.resolveProjectFilePath(projectPath, requestedPath)
      if (!resolvedPath) continue

      let stats: fs.Stats
      try {
        stats = fs.statSync(resolvedPath)
      } catch {
        continue
      }

      if (!stats.isFile()) continue

      let content: string
      try {
        content = fs.readFileSync(resolvedPath, 'utf-8')
      } catch {
        continue
      }

      normalizedPaths.push(resolvedPath)
      ctx.openFiles.set(resolvedPath, { content })
      ctx.tsServer?.openFile(resolvedPath, content)

      if (ctx.eslint) {
        lintPromises.push(ctx.eslint.runLint(resolvedPath, content))
      }
    }

    if (normalizedPaths.length === 0) {
      return this.buildSnapshotDiagnostics(ctx, { filePaths: requested })
    }

    ctx.tsServer?.refresh(normalizedPaths)
    await Promise.allSettled(lintPromises)

    const waitMs = Math.min(5000, Math.max(200, options.timeoutMs ?? 900))
    await delay(waitMs)

    return this.buildSnapshotDiagnostics(ctx, { filePaths: normalizedPaths })
  }

  private publishDiagnostics(projectPath: string, source: DiagnosticSource, diagnosticsByFile: Map<string, DiagnosticItem[]>) {
    const diagnostics = Array.from(diagnosticsByFile.values()).flat().map((diag) => ({
      ...diag,
      source,
    }))
    sendToRenderers('diagnostics:publish', {
      projectPath,
      source,
      diagnostics,
    })
  }
}
