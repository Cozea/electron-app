/**
 * Project Framework Detection
 *
 * Detects project framework, route convention, and dev server config.
 * Used as fallback when metadata isn't stored in Convex.
 */

import type { DevCommandSuggestion } from '@shared/electronApiTypes'

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

async function detectPackageManagerFromRoot(projectPath: string): Promise<PackageManager> {
  try {
    const entries = await window.electronAPI.fs.readDir(projectPath)
    const names = new Set(entries.map((entry) => entry.name))
    if (names.has('bun.lockb')) return 'bun'
    if (names.has('pnpm-lock.yaml')) return 'pnpm'
    if (names.has('yarn.lock')) return 'yarn'
    if (names.has('package-lock.json')) return 'npm'
  } catch {
    // Fall through to npm.
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
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  scripts?: Record<string, string>
}

function extractNpmScriptName(command: string | null | undefined): string | null {
  const trimmed = command?.trim()
  if (!trimmed) return null

  const runMatch = trimmed.match(/^(?:npm|pnpm|yarn|bun)\s+run\s+([^\s]+)$/i)
  if (runMatch) return runMatch[1]

  const simpleMatch = trimmed.match(/^(?:npm|pnpm|yarn|bun)\s+(start|test|dev)$/i)
  if (simpleMatch) return simpleMatch[1].toLowerCase()

  return null
}

async function readPackageJson(projectPath: string): Promise<PackageJson | null> {
  try {
    const result = await window.electronAPI.project.readFile({
      projectPath,
      filePath: 'package.json',
    })

    if (!result.success || !result.content) {
      return null
    }

    return JSON.parse(result.content) as PackageJson
  } catch {
    return null
  }
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

function buildPackageManagerScriptCommand(pm: PackageManager, scriptName: string): string {
  if (scriptName === 'start') {
    return pm === 'npm' ? 'npm start' : `${pm} start`
  }
  return `${pm} run ${scriptName}`
}

function commandExistsInScripts(command: string | null | undefined, scripts: Record<string, string>): boolean {
  const scriptName = extractNpmScriptName(command)
  if (!scriptName) return true
  return Boolean(scripts[scriptName])
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

/**
 * Detect framework from package.json dependencies
 */
export async function detectFramework(projectPath: string): Promise<FrameworkInfo> {
  try {
    const pkg = await readPackageJson(projectPath)
    if (!pkg) {
      return { framework: 'unknown', ...FRAMEWORK_CONFIGS.unknown }
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const scripts = pkg.scripts || {}

    // Detection order matters - more specific frameworks first
    let framework: Framework = 'unknown'

    // Next.js
    if (deps['expo']) {
      framework = 'expo'
    }
    // React Native
    else if (deps['react-native']) {
      framework = 'react-native'
    }
    // Next.js
    else if (deps['next']) {
      framework = 'nextjs'
    }
    // Remix
    else if (deps['@remix-run/react'] || deps['@remix-run/node']) {
      framework = 'remix'
    }
    // SvelteKit
    else if (deps['@sveltejs/kit']) {
      framework = 'sveltekit'
    }
    // Nuxt
    else if (deps['nuxt'] || deps['nuxt3']) {
      framework = 'nuxt'
    }
    // Astro
    else if (deps['astro']) {
      framework = 'astro'
    }
    // Gatsby
    else if (deps['gatsby']) {
      framework = 'gatsby'
    }
    // SolidStart
    else if (deps['@solidjs/start'] || deps['solid-start']) {
      framework = 'solid-start'
    }
    // Qwik
    else if (deps['@builder.io/qwik-city']) {
      framework = 'qwik'
    }
    // Angular
    else if (deps['@angular/core']) {
      framework = 'angular'
    }
    // Create React App
    else if (deps['react-scripts']) {
      framework = 'cra'
    }
    // Vite-based (check after specific frameworks)
    else if (deps['vite']) {
      if (deps['vue'] || deps['@vitejs/plugin-vue']) {
        framework = 'vite-vue'
      } else if (deps['svelte'] || deps['@sveltejs/vite-plugin-svelte']) {
        framework = 'vite-svelte'
      } else if (deps['react'] || deps['@vitejs/plugin-react']) {
        framework = 'vite-react'
      }
    }

    const config = FRAMEWORK_CONFIGS[framework]
    let devPort = config.devPort

    // Try to detect port from scripts
    if (scripts.dev) {
      const portMatch = scripts.dev.match(/--port[=\s]+(\d+)|-p[=\s]+(\d+)/)
      if (portMatch) {
        devPort = parseInt(portMatch[1] || portMatch[2], 10)
      }
    }

    const packageManager = await detectPackageManagerFromRoot(projectPath)
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
  projectPath: string,
  storedFramework?: Framework | null,
  storedDevCommand?: string | null,
  storedDevPort?: number | null,
): Promise<FrameworkInfo> {
  // If we have stored metadata, use it
  if (storedFramework && storedFramework !== 'unknown') {
    const config = FRAMEWORK_CONFIGS[storedFramework]
    const packageManager = await detectPackageManagerFromRoot(projectPath)
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
  return detectFramework(projectPath)
}

export async function getProjectPreviewExperience(
  projectPath: string,
  _storedFramework?: Framework | null,
  _storedDevCommand?: string | null,
  _storedDevPort?: number | null,
): Promise<ProjectPreviewExperience> {
  const pkg = await readPackageJson(projectPath)

  const scripts = pkg?.scripts ?? {}
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies }
  const supportsWebPreview = hasScript(scripts, 'web') || Boolean(deps['react-native-web'])

  return {
    mode: 'web',
    supportsWebPreview,
  }
}

/**
 * Get just the dev server config (for ServerControl)
 */
function getPersistedDevCommand(projectPath: string): string | null {
  if (typeof localStorage === 'undefined') return null
  const key = `dev-command:${encodeURIComponent(projectPath)}`
  const raw = localStorage.getItem(key)
  return raw?.trim() || null
}

export async function getDevServerConfig(
  projectPath: string,
  storedDevCommand?: string | null,
  storedDevPort?: number | null,
  context?: DevServerLaunchContext,
): Promise<{
  command: string
  port: number
  label: string
  suggestions: DevCommandSuggestion[]
  requiresUserSelection: boolean
}> {
  let suggestions: DevCommandSuggestion[] = []
  let requiresUserSelection = false

  try {
    const profile = await window.electronAPI.runtime.getProjectCapabilities({ projectPath })
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

  const packageJson = await readPackageJson(projectPath)
  const scripts = packageJson?.scripts ?? {}
  const info = await detectFramework(projectPath)
  const packageManager = await detectPackageManagerFromRoot(projectPath)

  if (storedDevCommand && commandExistsInScripts(storedDevCommand, scripts)) {
    return {
      command: storedDevCommand,
      port: inferPortFromCommand(storedDevCommand, storedDevPort ?? info.devPort),
      label: inferDevServerLabelFromCommand(storedDevCommand),
      suggestions,
      requiresUserSelection: false,
    }
  }

  const persistedCommand = getPersistedDevCommand(projectPath)
  if (persistedCommand && commandExistsInScripts(persistedCommand, scripts)) {
    return {
      command: persistedCommand,
      port: inferPortFromCommand(persistedCommand, info.devPort),
      label: inferDevServerLabelFromCommand(persistedCommand),
      suggestions,
      requiresUserSelection: false,
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
  }
}

/**
 * Detect which package manager is used in the project
 */
export async function detectPackageManager(projectPath: string): Promise<PackageManager> {
  return detectPackageManagerFromRoot(projectPath)
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
export function getInstallCommand(pm: PackageManager): string {
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
  return commands[pm]
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
  projectPath: string,
  packageManager?: PackageManager
): Promise<boolean> {
  try {
    const rootEntries = await window.electronAPI.fs.readDir(projectPath)
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
export async function hasPackageJson(projectPath: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.project.readFile({ projectPath, filePath: 'package.json' })
    return result.success && !!result.content
  } catch {
    return false
  }
}
