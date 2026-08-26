/**
 * Project Framework Detection
 *
 * Detects project framework, route convention, and dev server config.
 * Used as fallback when metadata isn't stored in Convex.
 */

import type { AppSettings, DevCommandSuggestion } from '@shared/electronApiTypes'
import { parseProjectDevAppCommand } from '@shared/projectDevAppCommand'
import { projectAnalysisDesktopClient } from '@/lib/projectAnalysis/projectAnalysisDesktopClient'
import { settingsDesktopClient } from '@/lib/settings/settingsDesktopClient'

export type Framework =
  | 'expo'
  | 'react-native'
  | 'nextjs'
  | 'remix'
  | 'vite-react'
  | 'vite-vue'
  | 'vite-svelte'
  | 'cra'
  | 'sveltekit'
  | 'nuxt'
  | 'astro'
  | 'gatsby'
  | 'angular'
  | 'solid-start'
  | 'qwik'
  | 'unknown'

export type RouteConvention = 'file-based' | 'config-based' | 'unknown'

export interface FrameworkInfo {
  framework: Framework
  displayName: string
  routeConvention: RouteConvention
  routePatterns: string[]  // Glob patterns for route files
  routeConfigPath?: string // Path to router config (for config-based)
  devCommand: string
  devPort: number
  buildCommand: string
  startCommand: string
}

export interface ProjectPreviewExperience {
  mode: 'web'
  supportsWebPreview: boolean
}

export interface DevServerLaunchContext {
  previewMode?: 'web' | 'native'
  nativePlatform?: 'ios' | 'android' | null
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

const MAX_PACKAGE_MANAGER_ANCESTOR_DEPTH = 4

function rewriteNpmCommandForPackageManager(command: string, pm: PackageManager): string {
  if (pm === 'npm') return command
  const trimmed = command.trim()

  const runMatch = trimmed.match(/^npm\s+run\s+([^\s]+)([\s\S]*)$/i)
  if (runMatch) {
    return `${pm} run ${runMatch[1]}${runMatch[2] ?? ''}`.trim()
  }

  const simpleScriptMatch = trimmed.match(/^npm\s+(start|test)([\s\S]*)$/i)
  if (simpleScriptMatch) {
    return `${pm} ${simpleScriptMatch[1]}${simpleScriptMatch[2] ?? ''}`.trim()
  }

  const installMatch = trimmed.match(/^npm\s+install([\s\S]*)$/i)
  if (installMatch) {
    return `${pm} install${installMatch[1] ?? ''}`.trim()
  }

  return command
}

function trimTrailingSeparators(pathValue: string): string {
  if (/^[A-Za-z]:[\\/]*$/.test(pathValue)) {
    return pathValue.endsWith('\\') || pathValue.endsWith('/') ? pathValue : `${pathValue}\\`
  }

  return pathValue.replace(/[\\/]+$/, '') || pathValue
}

function inferPathSeparator(pathValue: string): '/' | '\\' {
  return pathValue.includes('\\') ? '\\' : '/'
}

function joinAbsolutePath(basePath: string, ...segments: string[]): string {
  const separator = inferPathSeparator(basePath)
  const normalizedBase = trimTrailingSeparators(basePath)
  const cleanedSegments = segments
    .map((segment) => segment.replace(/^[/\\]+|[/\\]+$/g, ''))
    .filter(Boolean)

  if (cleanedSegments.length === 0) {
    return normalizedBase
  }

  const baseWithSeparator =
    normalizedBase.endsWith('/') || normalizedBase.endsWith('\\')
      ? normalizedBase
      : `${normalizedBase}${separator}`

  return `${baseWithSeparator}${cleanedSegments.join(separator)}`
}

function normalizeRelativePackageDirectory(value?: string | null): string | null {
  const normalized = value?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!normalized) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null
  }

  return segments.join('/')
}

function joinRelativeProjectPath(directory: string | null, fileName: string): string {
  return directory ? `${directory}/${fileName}` : fileName
}

function quoteCommandArgument(value: string): string {
  if (/^[A-Za-z0-9._/-]+$/.test(value)) {
    return value
  }

  if (isWindowsClient()) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function getParentDirectory(pathValue: string): string | null {
  const normalized = trimTrailingSeparators(pathValue)
  const lastSlashIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))

  if (lastSlashIndex < 0) {
    return null
  }

  if (lastSlashIndex === 0) {
    return normalized[0]
  }

  if (lastSlashIndex === 2 && /^[A-Za-z]:/.test(normalized.slice(0, 2))) {
    return normalized.slice(0, 3)
  }

  const parent = normalized.slice(0, lastSlashIndex)
  return parent.length > 0 ? parent : null
}

function normalizeComparableAbsolutePath(pathValue: string): string {
  const trimmed = trimTrailingSeparators(pathValue).replace(/\\/g, '/')

  if (trimmed === '/') {
    return trimmed
  }

  if (/^[A-Za-z]:\/$/.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  return trimmed.toLowerCase()
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedCandidate = normalizeComparableAbsolutePath(candidatePath)
  const normalizedRoot = normalizeComparableAbsolutePath(rootPath)

  if (normalizedCandidate === normalizedRoot) {
    return true
  }

  return normalizedCandidate.startsWith(`${normalizedRoot}/`)
}

function getApprovedReadRoots(settings: AppSettings): string[] {
  const roots = new Set<string>()
  const projectsDirectory = settings.projectsDirectory?.trim()
  if (projectsDirectory) {
    roots.add(trimTrailingSeparators(projectsDirectory))
  }

  for (const approvedRoot of settings.approvedExternalReadRoots ?? []) {
    if (typeof approvedRoot !== 'string' || approvedRoot.trim().length === 0) {
      continue
    }
    roots.add(trimTrailingSeparators(approvedRoot))
  }

  return Array.from(roots)
}

function isPathInsideApprovedRoots(candidatePath: string, approvedRoots: readonly string[]): boolean {
  return approvedRoots.some((rootPath) => isPathInsideRoot(candidatePath, rootPath))
}

/**
 * Resolves an opaque workspace id to its absolute project root path via the main process.
 * Returns null when the id is empty, unauthorized, or unknown.
 */
async function resolveWorkspaceRootPath(workspaceId: string): Promise<string | null> {
  const trimmed = workspaceId.trim()
  if (!trimmed) {
    return null
  }
  try {
    const rootPath = await projectAnalysisDesktopClient.resolveRoot(trimmed)
    if (typeof rootPath !== 'string' || rootPath.trim().length === 0) {
      return null
    }
    return rootPath
  } catch {
    return null
  }
}

function buildPackageManagerSearchRoots(
  rootPath: string,
  approvedRoots: readonly string[],
): string[] {
  const roots: string[] = []
  const initialRoot = trimTrailingSeparators(rootPath.trim())
  let current: string | null = initialRoot

  if (initialRoot) {
    roots.push(initialRoot)
  }

  for (let depth = 1; depth <= MAX_PACKAGE_MANAGER_ANCESTOR_DEPTH && current; depth += 1) {
    const normalized = trimTrailingSeparators(current)
    const parent = getParentDirectory(normalized)
    if (!parent || parent === normalized) {
      break
    }

    if (!isPathInsideApprovedRoots(parent, approvedRoots)) {
      break
    }

    if (!roots.includes(parent)) {
      roots.push(parent)
    }
    current = parent
  }

  return roots
}

function parsePackageManagerField(
  packageManagerField: unknown,
): PackageManager | null {
  if (typeof packageManagerField !== 'string') {
    return null
  }

  const normalized = packageManagerField.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  if (normalized === 'bun' || normalized.startsWith('bun@')) return 'bun'
  if (normalized === 'pnpm' || normalized.startsWith('pnpm@')) return 'pnpm'
  if (normalized === 'yarn' || normalized.startsWith('yarn@')) return 'yarn'
  if (normalized === 'npm' || normalized.startsWith('npm@')) return 'npm'

  return null
}

function detectPackageManagerFromEntryNames(entryNames: Set<string>): PackageManager | null {
  if (entryNames.has('bun.lock') || entryNames.has('bun.lockb')) return 'bun'
  if (entryNames.has('pnpm-lock.yaml')) return 'pnpm'
  if (entryNames.has('yarn.lock')) return 'yarn'
  if (entryNames.has('package-lock.json')) return 'npm'
  return null
}

async function readPackageManagerFromAbsolutePackageJson(
  absoluteDirectoryPath: string,
): Promise<PackageManager | null> {
  try {
    const raw = await projectAnalysisDesktopClient.readAbsoluteFile(
      joinAbsolutePath(absoluteDirectoryPath, 'package.json'),
    )
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as { packageManager?: unknown }
    return parsePackageManagerField(parsed.packageManager)
  } catch {
    return null
  }
}

async function detectPackageManagerFromRoot(
  workspaceId: string,
  relativeDirectory?: string | null,
): Promise<PackageManager> {
  // workspaceId is an opaque catalog id, not a path. Resolve it to the absolute project root
  // before walking the filesystem; the path-based fs:* reads below require a real path.
  const rootPath = await resolveWorkspaceRootPath(workspaceId)
  if (!rootPath) {
    return 'npm'
  }

  const normalizedDirectory = normalizeRelativePackageDirectory(relativeDirectory)
  const packageRoot = normalizedDirectory
    ? joinAbsolutePath(rootPath, normalizedDirectory)
    : rootPath
  let approvedRoots: string[] = []

  try {
    approvedRoots = getApprovedReadRoots(await settingsDesktopClient.get())
  } catch {
    approvedRoots = []
  }

  for (const candidateRoot of buildPackageManagerSearchRoots(packageRoot, approvedRoots)) {
    const packageManagerFromPackageJson =
      await readPackageManagerFromAbsolutePackageJson(candidateRoot)
    if (packageManagerFromPackageJson) {
      return packageManagerFromPackageJson
    }

    try {
      const entries = await projectAnalysisDesktopClient.readDir(candidateRoot)
      const entryNames = new Set(entries.map((entry) => entry.name))
      const packageManagerFromLockfile = detectPackageManagerFromEntryNames(entryNames)
      if (packageManagerFromLockfile) {
        return packageManagerFromLockfile
      }
    } catch {
      // Fall through to the next ancestor candidate.
    }
  }

  return 'npm'
}

function inferDevServerLabelFromCommand(command: string): string {
  const normalized = command.trim().toLowerCase()
  if (!normalized) return 'Dev Server'

  if (normalized.includes('next')) return 'Next.js Dev'
  if (normalized.includes('expo')) return 'Expo Dev'
  if (normalized.includes('react-native')) return 'React Native Dev'
  if (normalized.includes('nuxt')) return 'Nuxt Dev'
  if (normalized.includes('remix')) return 'Remix Dev'
  if (normalized.includes('astro')) return 'Astro Dev'
  if (normalized.includes('gatsby')) return 'Gatsby Dev'
  if (normalized.includes('sveltekit') || normalized.includes('@sveltejs/kit')) return 'SvelteKit Dev'
  if (normalized.includes('vite')) return 'Vite Dev'
  if (normalized.includes('react-scripts')) return 'CRA Dev'
  if (normalized.includes('ng serve') || normalized.includes('@angular/cli')) return 'Angular Dev'
  if (normalized.includes('solid-start') || normalized.includes('@solidjs/start')) return 'SolidStart Dev'
  if (normalized.includes('qwik')) return 'Qwik Dev'
  return 'Dev Server'
}

// Framework detection rules and metadata
const FRAMEWORK_CONFIGS: Record<Framework, Omit<FrameworkInfo, 'framework'>> = {
  expo: {
    displayName: 'Expo',
    routeConvention: 'unknown',
    routePatterns: [],
    devCommand: 'npm start',
    devPort: 8081,
    buildCommand: 'npm start',
    startCommand: 'npm start',
  },
  'react-native': {
    displayName: 'React Native',
    routeConvention: 'unknown',
    routePatterns: [],
    devCommand: 'npm start',
    devPort: 8081,
    buildCommand: 'npm start',
    startCommand: 'npm start',
  },
  nextjs: {
    displayName: 'Next.js',
    routeConvention: 'file-based',
    routePatterns: ['app/**/page.tsx', 'app/**/page.jsx', 'pages/**/*.tsx', 'pages/**/*.jsx'],
    devCommand: 'bun run dev',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'npm start',
  },
  remix: {
    displayName: 'Remix',
    routeConvention: 'file-based',
    routePatterns: ['app/routes/**/*.tsx', 'app/routes/**/*.jsx'],
    devCommand: 'bun run dev',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'npm start',
  },
  'vite-react': {
    displayName: 'Vite + React',
    routeConvention: 'config-based',
    routePatterns: ['src/pages/**/*.tsx', 'src/pages/**/*.jsx'],
    routeConfigPath: 'src/App.tsx',
    devCommand: 'bun run dev',
    devPort: 5173,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  'vite-vue': {
    displayName: 'Vite + Vue',
    routeConvention: 'config-based',
    routePatterns: ['src/pages/**/*.vue', 'src/views/**/*.vue'],
    routeConfigPath: 'src/router/index.ts',
    devCommand: 'bun run dev',
    devPort: 5173,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  'vite-svelte': {
    displayName: 'Vite + Svelte',
    routeConvention: 'config-based',
    routePatterns: ['src/routes/**/*.svelte'],
    devCommand: 'bun run dev',
    devPort: 5173,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  cra: {
    displayName: 'Create React App',
    routeConvention: 'config-based',
    routePatterns: ['src/pages/**/*.tsx', 'src/pages/**/*.jsx'],
    routeConfigPath: 'src/App.tsx',
    devCommand: 'npm start',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'npx serve -s build',
  },
  sveltekit: {
    displayName: 'SvelteKit',
    routeConvention: 'file-based',
    routePatterns: ['src/routes/**/+page.svelte'],
    devCommand: 'bun run dev',
    devPort: 5173,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  nuxt: {
    displayName: 'Nuxt',
    routeConvention: 'file-based',
    routePatterns: ['pages/**/*.vue'],
    devCommand: 'bun run dev',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  astro: {
    displayName: 'Astro',
    routeConvention: 'file-based',
    routePatterns: ['src/pages/**/*.astro', 'src/pages/**/*.md', 'src/pages/**/*.mdx'],
    devCommand: 'bun run dev',
    devPort: 4321,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  gatsby: {
    displayName: 'Gatsby',
    routeConvention: 'file-based',
    routePatterns: ['src/pages/**/*.tsx', 'src/pages/**/*.jsx'],
    devCommand: 'bun run develop',
    devPort: 8000,
    buildCommand: 'bun run build',
    startCommand: 'bun run serve',
  },
  angular: {
    displayName: 'Angular',
    routeConvention: 'config-based',
    routePatterns: ['src/app/**/*.component.ts'],
    routeConfigPath: 'src/app/app.routes.ts',
    devCommand: 'npm start',
    devPort: 4200,
    buildCommand: 'bun run build',
    startCommand: 'npx serve -s dist',
  },
  'solid-start': {
    displayName: 'SolidStart',
    routeConvention: 'file-based',
    routePatterns: ['src/routes/**/*.tsx'],
    devCommand: 'bun run dev',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'npm start',
  },
  qwik: {
    displayName: 'Qwik City',
    routeConvention: 'file-based',
    routePatterns: ['src/routes/**/index.tsx'],
    devCommand: 'bun run dev',
    devPort: 5173,
    buildCommand: 'bun run build',
    startCommand: 'bun run preview',
  },
  unknown: {
    displayName: 'Unknown',
    routeConvention: 'unknown',
    routePatterns: [],
    devCommand: 'bun run dev',
    devPort: 3000,
    buildCommand: 'bun run build',
    startCommand: 'npm start',
  },
}

interface PackageJson {
  name?: string
  packageManager?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

function extractNpmScriptName(command: string | null | undefined): string | null {
  return parseProjectDevAppCommand(command)?.scriptName ?? null
}

async function readPackageJsonAtPath(
  workspaceId: string,
  filePath: string,
): Promise<PackageJson | null> {
  try {
    const result = await projectAnalysisDesktopClient.readFile({
      workspaceId,
      filePath,
    })

    if (!result.success || !result.content) {
      return null
    }

    return JSON.parse(result.content) as PackageJson
  } catch {
    return null
  }
}

async function readPackageJson(workspaceId: string): Promise<PackageJson | null> {
  return readPackageJsonAtPath(workspaceId, 'package.json')
}

function hasScript(scripts: Record<string, string>, name: string): boolean {
  return Boolean(scripts[name]?.trim())
}

function resolveExistingDevScriptName(
  scripts: Record<string, string>,
  preferredCommand: string,
): string | null {
  const preferredScript = extractNpmScriptName(preferredCommand)
  if (preferredScript && scripts[preferredScript]) {
    return preferredScript
  }

  const fallbackScriptNames = ['dev', 'start', 'develop', 'web', 'serve']
  for (const scriptName of fallbackScriptNames) {
    if (scripts[scriptName]) return scriptName
  }

  return null
}

function buildPackageManagerScriptCommand(
  pm: PackageManager,
  scriptName: string,
  relativeDirectory?: string | null,
): string {
  const directory = normalizeRelativePackageDirectory(relativeDirectory)
  if (directory) {
    const quotedDirectory = quoteCommandArgument(directory)
    if (pm === 'npm') {
      return scriptName === 'start'
        ? `npm --prefix ${quotedDirectory} start`
        : `npm --prefix ${quotedDirectory} run ${scriptName}`
    }
    if (pm === 'pnpm') {
      return scriptName === 'start'
        ? `pnpm --dir ${quotedDirectory} start`
        : `pnpm --dir ${quotedDirectory} run ${scriptName}`
    }
    if (pm === 'yarn') {
      return scriptName === 'start'
        ? `yarn --cwd ${quotedDirectory} start`
        : `yarn --cwd ${quotedDirectory} run ${scriptName}`
    }
    return scriptName === 'start'
      ? `bun --cwd ${quotedDirectory} start`
      : `bun --cwd ${quotedDirectory} run ${scriptName}`
  }

  if (scriptName === 'start') {
    return pm === 'npm' ? 'npm start' : `${pm} start`
  }
  return `${pm} run ${scriptName}`
}

function commandExistsInScripts(command: string | null | undefined, scripts: Record<string, string>): boolean {
  const invocation = parseProjectDevAppCommand(command)
  if (!invocation || invocation.packageDirectory) return false
  return Boolean(scripts[invocation.scriptName]?.trim())
}

async function resolveStoredPackageScriptCommand(
  workspaceId: string,
  command: string,
): Promise<{
  command: string
  packageDirectory: string | null
  packageScript: string
} | null> {
  const invocation = parseProjectDevAppCommand(command)
  if (!invocation) return null

  const packageJson = await readPackageJsonAtPath(
    workspaceId,
    joinRelativeProjectPath(invocation.packageDirectory, 'package.json'),
  )
  const packageScript = packageJson?.scripts?.[invocation.scriptName]?.trim()
  if (!packageScript) return null

  const detectedPackageManager = await detectPackageManagerFromRoot(
    workspaceId,
    invocation.packageDirectory,
  )
  if (detectedPackageManager !== invocation.packageManager) return null

  return {
    command: command.trim(),
    packageDirectory: invocation.packageDirectory,
    packageScript,
  }
}

function resolvePreferredScriptName(
  scripts: Record<string, string>,
  framework: Framework,
  context?: DevServerLaunchContext,
): string | null {
  const previewMode = context?.previewMode ?? 'web'
  const nativePlatform = context?.nativePlatform ?? null

  const preferredScriptGroups: string[][] = []

  if (previewMode === 'native') {
    if (framework === 'expo') {
      preferredScriptGroups.push(['start'])
    } else if (framework === 'react-native') {
      preferredScriptGroups.push(
        nativePlatform === 'ios' ? ['ios', 'start'] : ['android', 'start']
      )
    } else if (nativePlatform === 'ios') {
      preferredScriptGroups.push(['ios', 'start'])
    } else if (nativePlatform === 'android') {
      preferredScriptGroups.push(['android', 'start'])
    } else {
      preferredScriptGroups.push(['start'])
    }
  } else {
    if (framework === 'expo') {
      preferredScriptGroups.push(['web', 'start'])
    } else {
      preferredScriptGroups.push(['web', 'dev', 'start', 'develop', 'serve'])
    }
  }

  preferredScriptGroups.push(['dev', 'start', 'develop', 'web', 'serve'])

  for (const group of preferredScriptGroups) {
    for (const scriptName of group) {
      if (scripts[scriptName]) return scriptName
    }
  }

  return null
}

function detectFrameworkFromPackageJson(pkg: PackageJson): Framework {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }

  if (deps['expo']) return 'expo'
  if (deps['react-native']) return 'react-native'
  if (deps['next']) return 'nextjs'
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix'
  if (deps['@sveltejs/kit']) return 'sveltekit'
  if (deps['nuxt'] || deps['nuxt3']) return 'nuxt'
  if (deps['astro']) return 'astro'
  if (deps['gatsby']) return 'gatsby'
  if (deps['@solidjs/start'] || deps['solid-start']) return 'solid-start'
  if (deps['@builder.io/qwik-city']) return 'qwik'
  if (deps['@angular/core']) return 'angular'
  if (deps['react-scripts']) return 'cra'
  if (deps['vite']) {
    if (deps['vue'] || deps['@vitejs/plugin-vue']) return 'vite-vue'
    if (deps['svelte'] || deps['@sveltejs/vite-plugin-svelte']) return 'vite-svelte'
    if (deps['react'] || deps['@vitejs/plugin-react']) return 'vite-react'
  }

  return 'unknown'
}

interface NestedRunnablePackage {
  directory: string
  packageJson: PackageJson
  packageManager: PackageManager
  framework: Framework
  scriptName: string
}

async function findSingleNestedRunnablePackage(
  workspaceId: string,
  context?: DevServerLaunchContext,
): Promise<NestedRunnablePackage | null> {
  let filePaths: string[] = []
  try {
    const result = await projectAnalysisDesktopClient.listFiles({ workspaceId })
    if (!result.success) return null
    filePaths = (result.files ?? []).map((file) => file.path.replace(/\\/g, '/'))
  } catch {
    return null
  }

  const packagePaths = filePaths
    .filter((filePath) => filePath.endsWith('/package.json'))
    .filter((filePath) => filePath.split('/').length <= 5)
    .sort((left, right) => {
      const depthDelta = left.split('/').length - right.split('/').length
      return depthDelta !== 0 ? depthDelta : left.localeCompare(right)
    })

  const candidates: NestedRunnablePackage[] = []
  for (const packagePath of packagePaths) {
    const directory = normalizeRelativePackageDirectory(
      packagePath.slice(0, -'/package.json'.length),
    )
    if (!directory) continue

    const packageJson = await readPackageJsonAtPath(workspaceId, packagePath)
    if (!packageJson) continue
    const framework = detectFrameworkFromPackageJson(packageJson)
    const scriptName = resolvePreferredScriptName(packageJson.scripts ?? {}, framework, context)
    if (!scriptName) continue

    candidates.push({
      directory,
      packageJson,
      packageManager: await detectPackageManagerFromRoot(workspaceId, directory),
      framework,
      scriptName,
    })
  }

  return candidates.length === 1 ? candidates[0] : null
}

/**
 * Detect framework from package.json dependencies
 */
export async function detectFramework(workspaceId: string): Promise<FrameworkInfo> {
  try {
    const pkg = await readPackageJson(workspaceId)
    if (!pkg) {
      return { framework: 'unknown', ...FRAMEWORK_CONFIGS.unknown }
    }
    const scripts = pkg.scripts || {}
    const framework = detectFrameworkFromPackageJson(pkg)

    const config = FRAMEWORK_CONFIGS[framework]
    let devPort = config.devPort

    // Try to detect port from scripts
    if (scripts.dev) {
      const portMatch = scripts.dev.match(/--port[=\s]+(\d+)|-p[=\s]+(\d+)/)
      if (portMatch) {
        devPort = parseInt(portMatch[1] || portMatch[2], 10)
      }
    }

    const packageManager = await detectPackageManagerFromRoot(workspaceId)
    const resolvedScriptName = resolveExistingDevScriptName(scripts, config.devCommand)
    const devCommand = resolvedScriptName
      ? buildPackageManagerScriptCommand(packageManager, resolvedScriptName)
      : rewriteNpmCommandForPackageManager(config.devCommand, packageManager)

    return {
      framework,
      ...config,
      devCommand,
      devPort,
      buildCommand: rewriteNpmCommandForPackageManager(config.buildCommand, packageManager),
      startCommand: rewriteNpmCommandForPackageManager(config.startCommand, packageManager),
    }
  } catch (error) {
    console.error('Failed to detect framework:', error)
    return { framework: 'unknown', ...FRAMEWORK_CONFIGS.unknown }
  }
}

/**
 * Get framework info from stored metadata or detect at runtime
 */
export async function getFrameworkInfo(
  workspaceId: string,
  storedFramework?: Framework | null,
  storedDevCommand?: string | null,
  storedDevPort?: number | null,
): Promise<FrameworkInfo> {
  // If we have stored metadata, use it
  if (storedFramework && storedFramework !== 'unknown') {
    const config = FRAMEWORK_CONFIGS[storedFramework]
    const packageManager = await detectPackageManagerFromRoot(workspaceId)
    return {
      framework: storedFramework,
      ...config,
      devCommand: storedDevCommand || rewriteNpmCommandForPackageManager(config.devCommand, packageManager),
      devPort: storedDevPort || config.devPort,
      buildCommand: rewriteNpmCommandForPackageManager(config.buildCommand, packageManager),
      startCommand: rewriteNpmCommandForPackageManager(config.startCommand, packageManager),
    }
  }

  // Otherwise detect at runtime
  return detectFramework(workspaceId)
}

export async function getProjectPreviewExperience(
  workspaceId: string,
  _storedFramework?: Framework | null,
  _storedDevCommand?: string | null,
  _storedDevPort?: number | null,
): Promise<ProjectPreviewExperience> {
  const pkg = await readPackageJson(workspaceId)

  const scripts = pkg?.scripts ?? {}
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const supportsWebPreview = hasScript(scripts, 'web') || Boolean(deps['react-native-web'])

  return {
    mode: 'web',
    supportsWebPreview,
  }
}

/**
 * Get just the dev server config for preview/runtime launch flows.
 */
function getPersistedDevCommand(workspaceId: string): string | null {
  if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') return null
  const key = `dev-command:${encodeURIComponent(workspaceId)}`
  const raw = localStorage.getItem(key)
  return raw?.trim() || null
}

export async function getDevServerConfig(
  workspaceId: string,
  storedDevCommand?: string | null,
  storedDevPort?: number | null,
  context?: DevServerLaunchContext,
): Promise<{
  command: string
  port: number
  label: string
  suggestions: DevCommandSuggestion[]
  requiresUserSelection: boolean
  packageDirectory: string | null
  commandVerified: boolean
}> {
  let suggestions: DevCommandSuggestion[] = []
  let requiresUserSelection = false

  try {
    const profile = await projectAnalysisDesktopClient.getProjectCapabilities({ workspaceId })
    suggestions = profile?.devServer?.suggestions ?? []
    requiresUserSelection = Boolean(profile?.devServer?.requiresUserSelection)
  } catch {
    suggestions = []
    requiresUserSelection = false
  }

  const inferPortFromCommand = (command: string, fallbackPort: number): number => {
    const match = command.match(/--port[=\s]+(\d+)|-p[=\s]+(\d+)|localhost:(\d+)/i)
    const parsed = Number.parseInt(match?.[1] || match?.[2] || match?.[3] || '', 10)
    return Number.isFinite(parsed) ? parsed : fallbackPort
  }

  const packageJson = await readPackageJson(workspaceId)
  const scripts = packageJson?.scripts ?? {}
  const info = await detectFramework(workspaceId)
  const packageManager = await detectPackageManagerFromRoot(workspaceId)

  const resolvedStoredCommand = storedDevCommand
    ? await resolveStoredPackageScriptCommand(workspaceId, storedDevCommand)
    : null
  if (resolvedStoredCommand) {
    return {
      command: resolvedStoredCommand.command,
      port: inferPortFromCommand(
        resolvedStoredCommand.packageScript,
        storedDevPort ?? info.devPort,
      ),
      label: inferDevServerLabelFromCommand(resolvedStoredCommand.packageScript),
      suggestions,
      requiresUserSelection: false,
      packageDirectory: resolvedStoredCommand.packageDirectory,
      commandVerified: true,
    }
  }

  const persistedCommand = getPersistedDevCommand(workspaceId)
  if (persistedCommand && commandExistsInScripts(persistedCommand, scripts)) {
    return {
      command: persistedCommand,
      port: inferPortFromCommand(persistedCommand, info.devPort),
      label: inferDevServerLabelFromCommand(persistedCommand),
      suggestions,
      requiresUserSelection: false,
      packageDirectory: null,
      commandVerified: true,
    }
  }

  const preferredScriptName = resolvePreferredScriptName(scripts, info.framework, context)
  if (preferredScriptName) {
    const preferredCommand = buildPackageManagerScriptCommand(packageManager, preferredScriptName)
    return {
      command: preferredCommand,
      port: inferPortFromCommand(preferredCommand, storedDevPort ?? info.devPort),
      label: inferDevServerLabelFromCommand(preferredCommand),
      suggestions,
      requiresUserSelection: false,
      packageDirectory: null,
      commandVerified: true,
    }
  }

  const nestedPackage = await findSingleNestedRunnablePackage(workspaceId, context)
  if (nestedPackage) {
    const nestedCommand = buildPackageManagerScriptCommand(
      nestedPackage.packageManager,
      nestedPackage.scriptName,
      nestedPackage.directory,
    )
    const nestedScript = nestedPackage.packageJson.scripts?.[nestedPackage.scriptName] ?? ''
    const nestedFallbackPort = FRAMEWORK_CONFIGS[nestedPackage.framework].devPort
    return {
      command: nestedCommand,
      port: inferPortFromCommand(nestedScript, storedDevPort ?? nestedFallbackPort),
      label: inferDevServerLabelFromCommand(nestedScript || nestedCommand),
      suggestions,
      requiresUserSelection: false,
      packageDirectory: nestedPackage.directory,
      commandVerified: true,
    }
  }

  const selectedSuggestion = suggestions.find((suggestion) => suggestion.confidence >= 0.8)
  if (selectedSuggestion && commandExistsInScripts(selectedSuggestion.command, scripts)) {
    const fallbackPort = info.devPort
    return {
      command: selectedSuggestion.command,
      port: inferPortFromCommand(selectedSuggestion.command, fallbackPort),
      label: inferDevServerLabelFromCommand(selectedSuggestion.command),
      suggestions,
      requiresUserSelection: false,
      packageDirectory: null,
      commandVerified: true,
    }
  }

  const firstValidSuggestion = suggestions.find((suggestion) =>
    commandExistsInScripts(suggestion.command, scripts)
  )
  const fallbackCommand = firstValidSuggestion?.command ?? info.devCommand
  const fallbackPort = inferPortFromCommand(fallbackCommand, info.devPort)

  return {
    command: fallbackCommand,
    port: fallbackPort,
    label: info.displayName === 'Unknown' ? 'Dev Server' : `${info.displayName} Dev`,
    suggestions,
    requiresUserSelection,
    packageDirectory: null,
    commandVerified: Boolean(firstValidSuggestion),
  }
}

/**
 * Detect which package manager is used in the project
 */
export async function detectPackageManager(
  workspaceId: string,
  relativeDirectory?: string | null,
): Promise<PackageManager> {
  return detectPackageManagerFromRoot(workspaceId, relativeDirectory)
}

function isWindowsClient(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  const platformHint = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
  return /win/i.test(platformHint)
}

/**
 * Get the install command for a package manager
 */
export function getInstallCommand(
  pm: PackageManager,
  relativeDirectory?: string | null,
): string {
  const windows = isWindowsClient()
  const commands: Record<PackageManager, string> = windows
    ? {
      bun: 'bun install',
      pnpm: 'pnpm.cmd install',
      yarn: 'yarn.cmd install',
      npm: 'npm.cmd install',
    }
    : {
      bun: 'bun install',
      pnpm: 'pnpm install',
      yarn: 'yarn install',
      npm: 'npm install',
    }
  const directory = normalizeRelativePackageDirectory(relativeDirectory)
  if (!directory) {
    return commands[pm]
  }

  const quotedDirectory = quoteCommandArgument(directory)
  const executable = commands[pm].split(/\s+/)[0]
  if (pm === 'npm') return `${executable} --prefix ${quotedDirectory} install`
  if (pm === 'pnpm') return `${executable} --dir ${quotedDirectory} install`
  return `${executable} --cwd ${quotedDirectory} install`
}

export function getLegacyPeerDepsInstallCommand(pm: PackageManager): string | null {
  const windows = isWindowsClient()

  if (pm === 'npm') {
    return windows ? 'npm.cmd install --legacy-peer-deps' : 'npm install --legacy-peer-deps'
  }

  if (pm === 'pnpm') {
    return windows ? 'pnpm.cmd install --legacy-peer-deps' : 'pnpm install --legacy-peer-deps'
  }

  return null
}

/**
 * Check if dependencies are installed (node_modules exists and has content)
 */
export async function checkDependenciesInstalled(
  workspaceId: string,
  packageManager?: PackageManager,
  relativeDirectory?: string | null,
): Promise<boolean> {
  try {
    // workspaceId is an opaque catalog id; resolve to a real path before the path-based readDir.
    const rootPath = await resolveWorkspaceRootPath(workspaceId)
    if (!rootPath) {
      return false
    }
    const directory = normalizeRelativePackageDirectory(relativeDirectory)
    const packageRoot = directory ? joinAbsolutePath(rootPath, directory) : rootPath
    const rootEntries = await projectAnalysisDesktopClient.readDir(packageRoot)
    const hasNodeModules = rootEntries.some(
      (entry) => entry.name === 'node_modules' && entry.type === 'directory'
    )

    // Yarn PnP repos can be fully installed without node_modules.
    const hasYarnPnpArtifacts = rootEntries.some(
      (entry) => entry.name === '.pnp.cjs' || entry.name === '.pnp.js'
    )

    if (packageManager === 'yarn') {
      return hasNodeModules || hasYarnPnpArtifacts
    }

    if (packageManager === 'pnpm' || packageManager === 'npm' || packageManager === 'bun') {
      return hasNodeModules
    }

    return hasNodeModules || hasYarnPnpArtifacts
  } catch {
    return false
  }
}

/**
 * Check if package.json exists
 */
export async function hasPackageJson(
  workspaceId: string,
  relativeDirectory?: string | null,
): Promise<boolean> {
  try {
    const directory = normalizeRelativePackageDirectory(relativeDirectory)
    const result = await projectAnalysisDesktopClient.readFile({
      workspaceId,
      filePath: joinRelativeProjectPath(directory, 'package.json'),
    })
    return result.success && !!result.content
  } catch {
    return false
  }
}
