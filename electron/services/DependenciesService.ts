import { BrowserWindow, ipcMain } from 'electron'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

export type DependencyType =
  | 'dependency'
  | 'devDependency'
  | 'optionalDependency'
  | 'peerDependency'

export interface DependencyItem {
  name: string
  type: DependencyType
  declared: string
  installed?: string
  wanted?: string
  latest?: string
  status: 'upToDate' | 'outdated' | 'missing' | 'unknown'
}

export interface DependencySnapshot {
  items: DependencyItem[]
  pm: PackageManager
  lastCheckedAt: number
  error?: string
}

export interface DependencyJobPayload {
  id: string
  action: 'add' | 'update' | 'remove'
  packageName: string
  status: 'running' | 'success' | 'error'
  startedAt: number
  finishedAt?: number
  stdout?: string
  stderr?: string
  error?: string
}

interface RegistrySearchResult {
  objects: Array<{
    package: {
      name: string
      version: string
      description?: string
      links?: Record<string, string>
    }
    score?: { final?: number }
    searchScore?: number
  }>
  total?: number
}

const REGISTRY_TTL_MS = 24 * 60 * 60 * 1000
const MAX_REGISTRY_SEARCH_SIZE = 50
const MIN_REGISTRY_SEARCH_SIZE = 1

function sendToRenderers(channel: string, payload: unknown) {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, payload)
  })
}

function detectPackageManager(projectPath: string): PackageManager {
  const checks: Array<{ file: string; pm: PackageManager }> = [
    { file: 'bun.lockb', pm: 'bun' },
    { file: 'pnpm-lock.yaml', pm: 'pnpm' },
    { file: 'yarn.lock', pm: 'yarn' },
    { file: 'package-lock.json', pm: 'npm' },
  ]

  for (const check of checks) {
    if (fs.existsSync(path.join(projectPath, check.file))) {
      return check.pm
    }
  }
  return 'npm'
}

function isExistingDirectory(targetPath: string): boolean {
  try {
    return fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
  } catch {
    return false
  }
}

function clampSearchSize(size: number): number {
  if (!Number.isFinite(size)) return 20
  return Math.max(MIN_REGISTRY_SEARCH_SIZE, Math.min(MAX_REGISTRY_SEARCH_SIZE, Math.floor(size)))
}

function detectYarnMajor(projectPath: string): number | null {
  try {
    const result = spawnSync('yarn', ['--version'], {
      cwd: projectPath,
      env: process.env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.status !== 0) return null
    const raw = (result.stdout || '').trim()
    const major = Number.parseInt(raw.split('.')[0] ?? '', 10)
    return Number.isFinite(major) ? major : null
  } catch {
    return null
  }
}

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  options?: { allowNonZero?: boolean }
): Promise<{ stdout: string; stderr: string; code: number | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    let resolved = false

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      resolve({ stdout, stderr, code: null, error: err instanceof Error ? err.message : 'Command failed' })
    })
    child.on('close', (code) => {
      if (resolved) return
      resolved = true
      if (code !== 0 && !options?.allowNonZero) {
        resolve({ stdout, stderr, code, error: stderr || `Command exited with code ${code}` })
        return
      }
      resolve({ stdout, stderr, code })
    })
  })
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function parseNpmList(stdout: string): Record<string, string> {
  const data = safeJsonParse<{ dependencies?: Record<string, { version?: string }> }>(stdout)
  const deps = data?.dependencies ?? {}
  const result: Record<string, string> = {}
  for (const [name, info] of Object.entries(deps)) {
    if (info?.version) result[name] = info.version
  }
  return result
}

function parseNpmOutdated(stdout: string): Record<string, { wanted?: string; latest?: string }> {
  const data = safeJsonParse<Record<string, { wanted?: string; latest?: string }>>(stdout) ?? {}
  return data
}

function parsePnpmList(stdout: string): Record<string, string> {
  const data = safeJsonParse<Array<{ dependencies?: Record<string, { version?: string }> }>>(stdout)
  const root = data?.[0]?.dependencies ?? {}
  const result: Record<string, string> = {}
  for (const [name, info] of Object.entries(root)) {
    if (info?.version) result[name] = info.version
  }
  return result
}

function parsePnpmOutdated(stdout: string): Record<string, { wanted?: string; latest?: string }> {
  const data = safeJsonParse<Array<{ name: string; wanted?: string; latest?: string }>>(stdout) ?? []
  const result: Record<string, { wanted?: string; latest?: string }> = {}
  for (const entry of data) {
    result[entry.name] = { wanted: entry.wanted, latest: entry.latest }
  }
  return result
}

function parseYarnList(stdout: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const parsed = safeJsonParse<{ type?: string; data?: { trees?: Array<{ name: string }> } }>(line)
    if (parsed?.type !== 'tree') continue
    const trees = parsed.data?.trees ?? []
    for (const tree of trees) {
      const idx = tree.name.lastIndexOf('@')
      if (idx > 0) {
        const name = tree.name.slice(0, idx)
        const version = tree.name.slice(idx + 1)
        result[name] = version
      }
    }
  }
  return result
}

function parseYarnOutdated(stdout: string): Record<string, { wanted?: string; latest?: string }> {
  const result: Record<string, { wanted?: string; latest?: string }> = {}
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines) {
    const parsed = safeJsonParse<{ type?: string; data?: { body?: Array<string[]> } }>(line)
    if (parsed?.type !== 'table') continue
    const body = parsed.data?.body ?? []
    for (const row of body) {
      const [name, _current, wanted, latest] = row
      if (name) {
        result[name] = { wanted, latest }
      }
    }
  }
  return result
}

function parseBunList(stdout: string): Record<string, string> {
  const parsed = safeJsonParse<unknown>(stdout)
  const result: Record<string, string> = {}
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (entry && typeof entry === 'object') {
        const record = entry as { name?: string; version?: string }
        if (record.name && record.version) {
          result[record.name] = record.version
        }
      }
    }
  } else if (parsed && typeof parsed === 'object') {
    const deps = (parsed as { dependencies?: Record<string, string> }).dependencies
    if (deps) {
      for (const [name, version] of Object.entries(deps)) {
        if (version) result[name] = version
      }
    }
  }
  return result
}

async function fetchJson<T>(url: string): Promise<T> {
  if (typeof fetch !== 'function') {
    throw new Error('fetch is not available')
  }
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export class DependenciesService {
  private static instance: DependenciesService
  private registryCache = new Map<string, { ts: number; data: unknown }>()

  static getInstance(): DependenciesService {
    if (!DependenciesService.instance) {
      DependenciesService.instance = new DependenciesService()
    }
    return DependenciesService.instance
  }

  registerIpcHandlers() {
    ipcMain.handle('dependencies:inspect', async (_event, options: { projectPath: string }) => {
      return this.inspectProject(options.projectPath)
    })

    ipcMain.handle('dependencies:run', async (_event, options: {
      projectPath: string
      action: 'add' | 'update' | 'remove'
      packageName: string
      version?: string
      dev?: boolean
      updateMode?: 'latest' | 'range'
    }) => {
      return this.runJob(options)
    })

    ipcMain.handle('dependencies:searchRegistry', async (_event, options: { query: string; size?: number }) => {
      return this.searchRegistry(options.query, options.size ?? 20)
    })

    ipcMain.handle('dependencies:fetchPackageMeta', async (_event, options: { names: string[] }) => {
      return this.fetchPackageMeta(options.names)
    })
  }

  private getCached<T>(key: string): T | null {
    const entry = this.registryCache.get(key)
    if (!entry) return null
    if (Date.now() - entry.ts > REGISTRY_TTL_MS) {
      this.registryCache.delete(key)
      return null
    }
    return entry.data as T
  }

  private setCached(key: string, data: unknown) {
    this.registryCache.set(key, { ts: Date.now(), data })
  }

  private async inspectProject(projectPath: string): Promise<{ success: boolean; snapshot?: DependencySnapshot; error?: string }> {
    if (!isExistingDirectory(projectPath)) {
      return { success: false, error: 'Project directory not found' }
    }

    const pkgPath = path.join(projectPath, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      return { success: false, error: 'package.json not found' }
    }

    const pm = detectPackageManager(projectPath)
    let pkg: {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    try {
      const raw = fs.readFileSync(pkgPath, 'utf-8')
      pkg = JSON.parse(raw)
    } catch {
      return { success: false, error: 'Failed to parse package.json' }
    }

    const declaredEntries: Array<{ name: string; version: string; type: DependencyType }> = []
    for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
      declaredEntries.push({ name, version, type: 'dependency' })
    }
    for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
      declaredEntries.push({ name, version, type: 'devDependency' })
    }
    for (const [name, version] of Object.entries(pkg.optionalDependencies ?? {})) {
      declaredEntries.push({ name, version, type: 'optionalDependency' })
    }
    for (const [name, version] of Object.entries(pkg.peerDependencies ?? {})) {
      declaredEntries.push({ name, version, type: 'peerDependency' })
    }

    let installed: Record<string, string> = {}
    let outdated: Record<string, { wanted?: string; latest?: string }> = {}
    let cliError: string | undefined

    try {
      if (pm === 'npm') {
        const list = await runCommand('npm', ['ls', '--depth=0', '--json'], projectPath)
        if (list.error) throw new Error(list.error)
        installed = parseNpmList(list.stdout)
        const out = await runCommand('npm', ['outdated', '--json'], projectPath, { allowNonZero: true })
        if (!out.error) {
          outdated = parseNpmOutdated(out.stdout || '{}')
        }
      } else if (pm === 'pnpm') {
        const list = await runCommand('pnpm', ['list', '--depth', '0', '--json'], projectPath)
        if (list.error) throw new Error(list.error)
        installed = parsePnpmList(list.stdout)
        const out = await runCommand('pnpm', ['outdated', '--json'], projectPath, { allowNonZero: true })
        if (!out.error) {
          outdated = parsePnpmOutdated(out.stdout || '[]')
        }
      } else if (pm === 'yarn') {
        const list = await runCommand('yarn', ['list', '--depth=0', '--json'], projectPath)
        if (list.error) throw new Error(list.error)
        installed = parseYarnList(list.stdout)
        const out = await runCommand('yarn', ['outdated', '--json'], projectPath, { allowNonZero: true })
        if (!out.error) {
          outdated = parseYarnOutdated(out.stdout)
        }
      } else if (pm === 'bun') {
        const list = await runCommand('bun', ['pm', 'ls', '--json'], projectPath)
        if (list.error) throw new Error(list.error)
        installed = parseBunList(list.stdout)
      }
    } catch (err) {
      cliError = err instanceof Error ? err.message : 'Package manager unavailable'
    }

    const names = declaredEntries.map((entry) => entry.name)
    const latestLookup = await this.fetchLatestVersions(names)

    const items: DependencyItem[] = declaredEntries.map((entry) => {
      const installedVersion = installed[entry.name]
      const outdatedInfo = outdated[entry.name]
      const latest = outdatedInfo?.latest ?? latestLookup[entry.name]
      const wanted = outdatedInfo?.wanted ?? entry.version
      let status: DependencyItem['status'] = 'unknown'
      if (!installedVersion) status = 'missing'
      else if (latest && installedVersion !== latest) status = 'outdated'
      else if (latest && installedVersion === latest) status = 'upToDate'

      return {
        name: entry.name,
        type: entry.type,
        declared: entry.version,
        installed: installedVersion,
        wanted,
        latest,
        status,
      }
    })

    const snapshot: DependencySnapshot = {
      items,
      pm,
      lastCheckedAt: Date.now(),
      error: cliError,
    }

    return { success: true, snapshot }
  }

  private async fetchLatestVersions(names: string[]): Promise<Record<string, string | undefined>> {
    const uniqueNames = Array.from(new Set(names.filter(Boolean)))
    const result: Record<string, string | undefined> = {}

    const lookups = await Promise.allSettled(
      uniqueNames.map(async (name) => ({
        name,
        meta: await this.getPackageMeta(name),
      }))
    )

    for (const lookup of lookups) {
      if (lookup.status === 'fulfilled') {
        result[lookup.value.name] = lookup.value.meta?.latest
      }
    }

    return result
  }

  private async getPackageMeta(name: string): Promise<{ latest?: string; description?: string } | null> {
    const cacheKey = `meta:${name}`
    const cached = this.getCached<{ latest?: string; description?: string }>(cacheKey)
    if (cached) return cached

    try {
      const data = await fetchJson<{ ['dist-tags']?: { latest?: string }; description?: string }>(
        `https://registry.npmjs.org/${encodeURIComponent(name)}`
      )
      const meta = {
        latest: data['dist-tags']?.latest,
        description: data.description,
      }
      this.setCached(cacheKey, meta)
      return meta
    } catch {
      return null
    }
  }

  private async searchRegistry(query: string, size: number) {
    const normalized = query.trim()
    if (!normalized) {
      return { success: true, results: { objects: [], total: 0 } }
    }
    const requestedSize = clampSearchSize(size)
    const cacheKey = `search:${normalized}:${requestedSize}`
    const cached = this.getCached<RegistrySearchResult>(cacheKey)
    if (cached) return { success: true, results: cached }

    try {
      const data = await fetchJson<RegistrySearchResult>(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(normalized)}&size=${requestedSize}`
      )
      this.setCached(cacheKey, data)
      return { success: true, results: data }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Registry search failed' }
    }
  }

  private async fetchPackageMeta(names: string[]) {
    const unique = Array.from(new Set(names.filter(Boolean)))
    const result: Record<string, { latest?: string; description?: string }> = {}
    for (const name of unique) {
      const meta = await this.getPackageMeta(name)
      if (meta) {
        result[name] = meta
      }
    }
    return { success: true, results: result }
  }

  private runJob(options: {
    projectPath: string
    action: 'add' | 'update' | 'remove'
    packageName: string
    version?: string
    dev?: boolean
    updateMode?: 'latest' | 'range'
  }) {
    if (!isExistingDirectory(options.projectPath)) {
      return { success: false, error: 'Project directory not found' }
    }

    if (!options.packageName?.trim()) {
      return { success: false, error: 'Package name is required' }
    }

    const pm = detectPackageManager(options.projectPath)
    const jobId = Math.random().toString(36).slice(2)
    const startedAt = Date.now()

    const { cmd, args } = this.getCommandForJob(pm, options)
    if (!cmd) {
      const payload: DependencyJobPayload = {
        id: jobId,
        action: options.action,
        packageName: options.packageName,
        status: 'error',
        startedAt,
        finishedAt: Date.now(),
        error: 'Unsupported package manager command',
      }
      sendToRenderers('dependencies:job-status', { projectPath: options.projectPath, job: payload })
      return { success: false, error: payload.error }
    }

    const child = spawn(cmd, args, { cwd: options.projectPath, env: process.env })
    const basePayload = {
      id: jobId,
      action: options.action,
      packageName: options.packageName,
      startedAt,
    }

    sendToRenderers('dependencies:job-status', {
      projectPath: options.projectPath,
      job: { ...basePayload, status: 'running' } satisfies DependencyJobPayload,
    })

    child.stdout.on('data', (chunk) => {
      sendToRenderers('dependencies:job-status', {
        projectPath: options.projectPath,
        job: { ...basePayload, status: 'running', stdout: chunk.toString() } satisfies DependencyJobPayload,
      })
    })

    child.stderr.on('data', (chunk) => {
      sendToRenderers('dependencies:job-status', {
        projectPath: options.projectPath,
        job: { ...basePayload, status: 'running', stderr: chunk.toString() } satisfies DependencyJobPayload,
      })
    })

    child.on('error', (err) => {
      sendToRenderers('dependencies:job-status', {
        projectPath: options.projectPath,
        job: {
          ...basePayload,
          status: 'error',
          finishedAt: Date.now(),
          error: err instanceof Error ? err.message : 'Command failed',
        } satisfies DependencyJobPayload,
      })
    })

    child.on('close', (code) => {
      const success = code === 0
      sendToRenderers('dependencies:job-status', {
        projectPath: options.projectPath,
        job: {
          ...basePayload,
          status: success ? 'success' : 'error',
          finishedAt: Date.now(),
          error: success ? undefined : `Command exited with code ${code}`,
        } satisfies DependencyJobPayload,
      })
    })

    return { success: true, jobId }
  }

  private getCommandForJob(
    pm: PackageManager,
    options: {
      action: 'add' | 'update' | 'remove'
      packageName: string
      version?: string
      dev?: boolean
      updateMode?: 'latest' | 'range'
    }
  ): { cmd: string | null; args: string[] } {
    const nameWithVersion = options.version ? `${options.packageName}@${options.version}` : options.packageName
    if (options.action === 'add') {
      if (pm === 'npm') return { cmd: 'npm', args: ['install', nameWithVersion, options.dev ? '--save-dev' : '--save'] }
      if (pm === 'pnpm') return { cmd: 'pnpm', args: ['add', nameWithVersion, options.dev ? '-D' : undefined].filter(Boolean) as string[] }
      if (pm === 'yarn') return { cmd: 'yarn', args: ['add', nameWithVersion, options.dev ? '-D' : undefined].filter(Boolean) as string[] }
      if (pm === 'bun') return { cmd: 'bun', args: ['add', nameWithVersion, options.dev ? '-d' : undefined].filter(Boolean) as string[] }
    }

    if (options.action === 'update') {
      const mode = options.updateMode ?? 'latest'
      if (pm === 'npm') {
        return { cmd: 'npm', args: mode === 'latest' ? ['install', `${options.packageName}@latest`] : ['update', options.packageName] }
      }
      if (pm === 'pnpm') {
        return { cmd: 'pnpm', args: mode === 'latest' ? ['up', options.packageName, '--latest'] : ['up', options.packageName] }
      }
      if (pm === 'yarn') {
        const yarnMajor = detectYarnMajor(options.projectPath)
        if (yarnMajor !== null && yarnMajor < 2) {
          return {
            cmd: 'yarn',
            args: mode === 'latest'
              ? ['upgrade', options.packageName, '--latest']
              : ['upgrade', options.packageName],
          }
        }
        return {
          cmd: 'yarn',
          args: mode === 'latest'
            ? ['up', options.packageName, '--latest']
            : ['up', options.packageName],
        }
      }
      if (pm === 'bun') {
        return { cmd: 'bun', args: ['update', options.packageName] }
      }
    }

    if (options.action === 'remove') {
      if (pm === 'npm') return { cmd: 'npm', args: ['uninstall', options.packageName] }
      if (pm === 'pnpm') return { cmd: 'pnpm', args: ['remove', options.packageName] }
      if (pm === 'yarn') return { cmd: 'yarn', args: ['remove', options.packageName] }
      if (pm === 'bun') return { cmd: 'bun', args: ['remove', options.packageName] }
    }

    return { cmd: null, args: [] }
  }
}
