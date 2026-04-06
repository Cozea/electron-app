import { app, ipcMain } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { getRuntimePathPrefixes } from '../runtime/runtimeResolver'
import type { AgentToolId, AgentToolPrepareResult, AgentToolSource, AgentToolStatus } from '../../shared/electronApiTypes'

interface AgentToolDefinition {
  id: AgentToolId
  label: string
  packageName?: string
  binaries: string[]
  args?: string[]
}

interface PersistedAgentToolState {
  toolId: AgentToolId
  source: AgentToolSource
  commandPath?: string
  launchCommand?: string
  packageName?: string
  updatedAt: number
  error?: string
}

interface AgentToolStateFile {
  tools: Partial<Record<AgentToolId, PersistedAgentToolState>>
}

const AGENT_TOOL_DEFINITIONS: Record<AgentToolId, AgentToolDefinition> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    packageName: '@anthropic-ai/claude-code',
    binaries: ['claude', 'claude-code'],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    packageName: '@google/gemini-cli',
    binaries: ['gemini'],
  },
  kilo: {
    id: 'kilo',
    label: 'Kilo Code',
    packageName: 'kilo-code',
    binaries: ['kilo-code', 'kilo'],
  },
  copilot: {
    id: 'copilot',
    label: 'GitHub Copilot',
    packageName: '@githubnext/github-copilot-cli',
    binaries: ['github-copilot-cli', 'gh copilot'],
  },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex',
    packageName: 'openai-codex-cli',
    binaries: ['codex'],
  },
  shell: {
    id: 'shell',
    label: 'Shell',
    binaries: [],
  },
}

function getAgentToolsRoot(): string {
  if (app.isReady()) {
    return path.join(app.getPath('userData'), 'agent-tools')
  }
  return path.join(os.homedir(), '.cozea', 'agent-tools')
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true })
}

function getStateFilePath(): string {
  return path.join(getAgentToolsRoot(), 'state.json')
}

function loadState(): AgentToolStateFile {
  try {
    const filePath = getStateFilePath()
    if (!fs.existsSync(filePath)) {
      return { tools: {} }
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AgentToolStateFile
    return parsed && typeof parsed === 'object' && parsed.tools ? parsed : { tools: {} }
  } catch {
    return { tools: {} }
  }
}

function saveState(state: AgentToolStateFile): void {
  ensureDirectory(getAgentToolsRoot())
  fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2))
}

function updateToolState(toolId: AgentToolId, nextState: PersistedAgentToolState): void {
  const state = loadState()
  state.tools[toolId] = nextState
  saveState(state)
}

function clearToolState(toolId: AgentToolId): void {
  const state = loadState()
  delete state.tools[toolId]
  saveState(state)
}

function isExecutable(candidatePath: string): boolean {
  try {
    if (!fs.existsSync(candidatePath)) return false
    if (process.platform === 'win32') return true
    fs.accessSync(candidatePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function getPathEntries(pathValue: string | undefined): string[] {
  if (!pathValue) return []
  return pathValue
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean)
}

function resolveBinaryFromPath(binaryNames: string[], pathValue: string | undefined): string | null {
  for (const entry of getPathEntries(pathValue)) {
    for (const binary of binaryNames) {
      const candidates = process.platform === 'win32'
        ? [binary, `${binary}.cmd`, `${binary}.exe`, `${binary}.bat`, `${binary}.ps1`]
        : [binary]
      for (const candidateName of candidates) {
        const candidatePath = path.join(entry, candidateName)
        if (isExecutable(candidatePath)) {
          return candidatePath
        }
      }
    }
  }
  return null
}

function shellEscapeArg(value: string): string {
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function shellEscapeForScript(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildLaunchCommand(commandPath: string, args: string[] = []): string {
  return [shellEscapeArg(commandPath), ...args.map(shellEscapeArg)].join(' ')
}

function getShellPath(): string | null {
  if (process.platform === 'win32') return null
  const shellPath = process.env.SHELL || '/bin/zsh'
  return isExecutable(shellPath) ? shellPath : null
}

function getInteractiveLoginShellArgs(script: string): string[] {
  return ['-l', '-i', '-c', script]
}

function resolveBinaryFromLoginShell(binaryNames: string[]): string | null {
  const shellPath = getShellPath()
  if (!shellPath || binaryNames.length === 0) return null

  const script = binaryNames
    .map((binary) => `command -v ${shellEscapeForScript(binary)} 2>/dev/null || true`)
    .join('\n')

  const result = spawnSync(shellPath, getInteractiveLoginShellArgs(script), {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  if (result.error) return null

  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && isExecutable(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveSystemBinary(definition: AgentToolDefinition): string | null {
  const fromLoginShell = resolveBinaryFromLoginShell(definition.binaries)
  if (fromLoginShell) return fromLoginShell

  const runtimeEnv = createRuntimeEnv(getRuntimePathPrefixes(), process.env)
  return resolveBinaryFromPath(definition.binaries, runtimeEnv.PATH)
}

async function runProcess(command: string, args: string[], options: {
  cwd: string
  env: NodeJS.ProcessEnv
}): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({
        success: false,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : 'Process failed to start',
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (code === 0) {
        resolve({ success: true, stdout, stderr })
        return
      }
      resolve({
        success: false,
        stdout,
        stderr,
        error: stderr.trim() || stdout.trim() || `Process exited with code ${code}`,
      })
    })
  })
}

export class AgentToolService {
  private static instance: AgentToolService
  private pendingPreparations = new Map<AgentToolId, Promise<AgentToolPrepareResult>>()
  private sessionStatusCache = new Map<AgentToolId, AgentToolStatus>()

  static getInstance(): AgentToolService {
    if (!AgentToolService.instance) {
      AgentToolService.instance = new AgentToolService()
    }
    return AgentToolService.instance
  }

  registerIpcHandlers(): void {
    ipcMain.handle('agentTools:getStatus', async (_event, options: { toolId: AgentToolId }) => {
      return await this.getStatus(options.toolId)
    })

    ipcMain.handle('agentTools:prepare', async (_event, options: { toolId: AgentToolId }) => {
      return await this.prepare(options.toolId)
    })
  }

  private setCachedStatus(status: AgentToolStatus): AgentToolStatus {
    this.sessionStatusCache.set(status.toolId, status)
    return status
  }

  private invalidateCachedStatus(toolId: AgentToolId): void {
    this.sessionStatusCache.delete(toolId)
  }

  private getPersisted(toolId: AgentToolId): PersistedAgentToolState | null {
    return loadState().tools[toolId] ?? null
  }

  private createShellStatus(definition: AgentToolDefinition): AgentToolStatus {
    return {
      toolId: definition.id,
      label: definition.label,
      available: true,
      source: 'builtin',
      launchCommand: '',
      updatedAt: Date.now(),
    }
  }

  private createMissingStatus(definition: AgentToolDefinition, error?: string): AgentToolStatus {
    return {
      toolId: definition.id,
      label: definition.label,
      available: false,
      source: 'missing',
      packageName: definition.packageName,
      updatedAt: Date.now(),
      error: error || 'Agent CLI is not installed globally.',
    }
  }

  private createSystemStatus(definition: AgentToolDefinition, commandPath: string): AgentToolStatus {
    return {
      toolId: definition.id,
      label: definition.label,
      available: true,
      source: 'system',
      packageName: definition.packageName,
      commandPath,
      launchCommand: buildLaunchCommand(commandPath, definition.args),
      updatedAt: Date.now(),
    }
  }

  private async getStatus(toolId: AgentToolId): Promise<AgentToolStatus> {
    const definition = AGENT_TOOL_DEFINITIONS[toolId]
    if (!definition) {
      return {
        toolId,
        label: toolId,
        available: false,
        source: 'missing',
        updatedAt: Date.now(),
        error: 'Unknown agent tool.',
      }
    }

    if (toolId === 'shell') {
      return this.setCachedStatus(this.createShellStatus(definition))
    }

    const cached = this.sessionStatusCache.get(toolId)
    if (cached) {
      if (!cached.commandPath || isExecutable(cached.commandPath)) {
        return cached
      }
      this.invalidateCachedStatus(toolId)
    }

    const commandPath = resolveSystemBinary(definition)
    if (commandPath) {
      const status = this.createSystemStatus(definition, commandPath)
      updateToolState(toolId, {
        toolId,
        source: status.source,
        commandPath: status.commandPath,
        launchCommand: status.launchCommand,
        packageName: definition.packageName,
        updatedAt: status.updatedAt ?? Date.now(),
      })
      return this.setCachedStatus(status)
    }

    const persisted = this.getPersisted(toolId)
    const error = persisted?.source === 'missing' && persisted.error
      ? persisted.error
      : 'Agent CLI is not installed globally.'
    return this.setCachedStatus(this.createMissingStatus(definition, error))
  }

  private async installSystemTool(definition: AgentToolDefinition): Promise<AgentToolPrepareResult> {
    if (!definition.packageName) {
      return {
        success: false,
        ...this.createMissingStatus(definition, 'This agent tool does not support installation.'),
      }
    }

    const shellPath = getShellPath()
    if (!shellPath) {
      return {
        success: false,
        ...this.createMissingStatus(definition, 'A login shell is required to install this CLI.'),
      }
    }

    const installScript = `npm install -g --no-fund --no-audit ${shellEscapeForScript(definition.packageName)}`
    const result = await runProcess(shellPath, getInteractiveLoginShellArgs(installScript), {
      cwd: os.homedir(),
      env: {
        ...process.env,
        CI: process.env.CI || '1',
      },
    })

    if (!result.success) {
      const failed = this.createMissingStatus(definition, result.error || 'Failed to install agent CLI globally.')
      updateToolState(definition.id, {
        toolId: definition.id,
        source: 'missing',
        packageName: definition.packageName,
        updatedAt: failed.updatedAt ?? Date.now(),
        error: failed.error,
      })
      this.setCachedStatus(failed)
      return {
        success: false,
        ...failed,
      }
    }

    this.invalidateCachedStatus(definition.id)
    const status = await this.getStatus(definition.id)
    if (!status.available || !status.commandPath || !status.launchCommand) {
      const failed = this.createMissingStatus(definition, 'Agent CLI installed, but the executable could not be found in your shell PATH.')
      updateToolState(definition.id, {
        toolId: definition.id,
        source: 'missing',
        packageName: definition.packageName,
        updatedAt: failed.updatedAt ?? Date.now(),
        error: failed.error,
      })
      this.setCachedStatus(failed)
      return {
        success: false,
        ...failed,
      }
    }

    return {
      success: true,
      ...status,
    }
  }

  async prepare(toolId: AgentToolId): Promise<AgentToolPrepareResult> {
    const existing = this.pendingPreparations.get(toolId)
    if (existing) return existing

    const work = (async () => {
      const definition = AGENT_TOOL_DEFINITIONS[toolId]
      if (!definition) {
        return {
          success: false,
          toolId,
          label: toolId,
          available: false,
          source: 'missing',
          updatedAt: Date.now(),
          error: 'Unknown agent tool.',
        } satisfies AgentToolPrepareResult
      }

      if (toolId === 'shell') {
        clearToolState(toolId)
        const shellStatus = this.createShellStatus(definition)
        this.setCachedStatus(shellStatus)
        return {
          success: true,
          ...shellStatus,
        } satisfies AgentToolPrepareResult
      }

      const status = await this.getStatus(toolId)
      if (status.available && status.launchCommand) {
        return {
          success: true,
          ...status,
        }
      }

      return await this.installSystemTool(definition)
    })()

    this.pendingPreparations.set(toolId, work)
    try {
      return await work
    } finally {
      this.pendingPreparations.delete(toolId)
    }
  }
}
