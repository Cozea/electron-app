import fs from 'node:fs'
import path from 'node:path'

import type {
  ListFilesResult,
  ProjectContextOptionsResult,
  ProjectFrameworkId,
  ProjectRouteConvention,
  ProjectRouteScanResult,
  ProjectScannedRoute,
  ProjectStoredFrameworkInfo,
  ReadFileResult,
} from '../../shared/electronApiTypes'
import { resolvePathWithinDirectory } from '../pathUtils'
import { listProjectFilesFromIndex } from './ProjectFileIndexService'

interface FrameworkConfig {
  displayName: string
  routeConvention: ProjectRouteConvention
}

interface ProjectFileEntry {
  path: string
  sizeBytes: number
}

interface RouteAnalysisCacheEntry {
  projectPath: string
  cacheKey: string
  result: ProjectRouteScanResult | null
  builtAt: number
  lastAccessedAt: number
  stale: boolean
  promise: Promise<ProjectRouteScanResult> | null
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const ROUTE_ANALYSIS_FRESH_MS = 30_000
const MAX_ROUTE_ANALYSIS_CACHE_ENTRIES = 16
const SOURCE_FILE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.astro', '.svelte']

const FRAMEWORK_CONFIGS: Record<ProjectFrameworkId, FrameworkConfig> = {
  expo: { displayName: 'Expo', routeConvention: 'unknown' },
  'react-native': { displayName: 'React Native', routeConvention: 'unknown' },
  nextjs: { displayName: 'Next.js', routeConvention: 'file-based' },
  remix: { displayName: 'Remix', routeConvention: 'file-based' },
  'vite-react': { displayName: 'Vite + React', routeConvention: 'config-based' },
  'vite-vue': { displayName: 'Vite + Vue', routeConvention: 'config-based' },
  'vite-svelte': { displayName: 'Vite + Svelte', routeConvention: 'config-based' },
  cra: { displayName: 'Create React App', routeConvention: 'config-based' },
  sveltekit: { displayName: 'SvelteKit', routeConvention: 'file-based' },
  nuxt: { displayName: 'Nuxt', routeConvention: 'file-based' },
  astro: { displayName: 'Astro', routeConvention: 'file-based' },
  gatsby: { displayName: 'Gatsby', routeConvention: 'file-based' },
  angular: { displayName: 'Angular', routeConvention: 'config-based' },
  'solid-start': { displayName: 'SolidStart', routeConvention: 'file-based' },
  qwik: { displayName: 'Qwik City', routeConvention: 'file-based' },
  unknown: { displayName: 'Unknown', routeConvention: 'unknown' },
}

const routeAnalysisCacheByKey = new Map<string, RouteAnalysisCacheEntry>()

function isProjectFrameworkId(value: unknown): value is ProjectFrameworkId {
  return typeof value === 'string' && value in FRAMEWORK_CONFIGS
}

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath)
}

function normalizeRouteScannerPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/')
}

function normalizeRelativeProjectFilePath(value: string): string {
  return normalizeRouteScannerPath(value).replace(/^\/+/, '')
}

function isFileUnderProject(projectPath: string, filePath: string): boolean {
  const relativePath = path.relative(projectPath, filePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function buildRouteAnalysisCacheKey(
  projectPath: string,
  frameworkInfo?: ProjectStoredFrameworkInfo | null,
): string {
  const framework = isProjectFrameworkId(frameworkInfo?.framework)
    ? frameworkInfo.framework
    : 'auto'
  return [
    normalizeProjectPath(projectPath),
    framework,
    frameworkInfo?.devCommand ?? '',
    frameworkInfo?.devPort ?? '',
  ].join('\u0000')
}

function emptyRouteScanResult(
  framework: ProjectFrameworkId,
  error?: string,
): ProjectRouteScanResult {
  const config = FRAMEWORK_CONFIGS[framework]
  return {
    success: !error,
    routes: [],
    framework,
    frameworkDisplayName: config.displayName,
    routeConvention: config.routeConvention,
    error,
  }
}

function getOrCreateRouteCacheEntry(
  projectPath: string,
  frameworkInfo?: ProjectStoredFrameworkInfo | null,
): RouteAnalysisCacheEntry {
  const cacheKey = buildRouteAnalysisCacheKey(projectPath, frameworkInfo)
  const existing = routeAnalysisCacheByKey.get(cacheKey)
  if (existing) {
    existing.lastAccessedAt = Date.now()
    return existing
  }

  const now = Date.now()
  const entry: RouteAnalysisCacheEntry = {
    projectPath: normalizeProjectPath(projectPath),
    cacheKey,
    result: null,
    builtAt: 0,
    lastAccessedAt: now,
    stale: true,
    promise: null,
  }
  routeAnalysisCacheByKey.set(cacheKey, entry)
  pruneRouteAnalysisCache()
  return entry
}

function pruneRouteAnalysisCache(): void {
  if (routeAnalysisCacheByKey.size <= MAX_ROUTE_ANALYSIS_CACHE_ENTRIES) return

  const entriesByAccessTime = Array.from(routeAnalysisCacheByKey.values()).sort(
    (left, right) => left.lastAccessedAt - right.lastAccessedAt,
  )

  for (const entry of entriesByAccessTime) {
    if (routeAnalysisCacheByKey.size <= MAX_ROUTE_ANALYSIS_CACHE_ENTRIES) return
    if (entry.promise) continue
    routeAnalysisCacheByKey.delete(entry.cacheKey)
  }
}

function isRouteAnalysisFresh(entry: RouteAnalysisCacheEntry): boolean {
  return Boolean(entry.result) && !entry.stale && Date.now() - entry.builtAt <= ROUTE_ANALYSIS_FRESH_MS
}

async function readProjectFile(
  projectPath: string,
  filePath: string,
): Promise<ReadFileResult> {
  try {
    const fullPath = resolvePathWithinDirectory(projectPath, filePath)
    const content = await fs.promises.readFile(fullPath, 'utf-8')
    return {
      success: true,
      content,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

async function readPackageJson(projectPath: string): Promise<PackageJson | null> {
  const result = await readProjectFile(projectPath, 'package.json')
  if (!result.success || !result.content) {
    return null
  }

  try {
    return JSON.parse(result.content) as PackageJson
  } catch {
    return null
  }
}

async function detectProjectFramework(projectPath: string): Promise<ProjectFrameworkId> {
  const packageJson = await readPackageJson(projectPath)
  if (!packageJson) {
    return 'unknown'
  }

  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  if (deps.expo) return 'expo'
  if (deps['react-native']) return 'react-native'
  if (deps.next) return 'nextjs'
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix'
  if (deps['@sveltejs/kit']) return 'sveltekit'
  if (deps.nuxt || deps.nuxt3) return 'nuxt'
  if (deps.astro) return 'astro'
  if (deps.gatsby) return 'gatsby'
  if (deps['@solidjs/start'] || deps['solid-start']) return 'solid-start'
  if (deps['@builder.io/qwik-city']) return 'qwik'
  if (deps['@angular/core']) return 'angular'
  if (deps['react-scripts']) return 'cra'
  if (deps.vite) {
    if (deps.vue || deps['@vitejs/plugin-vue']) return 'vite-vue'
    if (deps.svelte || deps['@sveltejs/vite-plugin-svelte']) return 'vite-svelte'
    if (deps.react || deps['@vitejs/plugin-react']) return 'vite-react'
  }

  return 'unknown'
}

async function resolveProjectFramework(
  projectPath: string,
  frameworkInfo?: ProjectStoredFrameworkInfo | null,
): Promise<ProjectFrameworkId> {
  if (isProjectFrameworkId(frameworkInfo?.framework) && frameworkInfo.framework !== 'unknown') {
    return frameworkInfo.framework
  }

  return await detectProjectFramework(projectPath)
}

function filesFromListResult(result: ListFilesResult): ProjectFileEntry[] {
  return result.files?.map((file) => ({
    path: normalizeRelativeProjectFilePath(file.path),
    sizeBytes: file.sizeBytes,
  })) ?? []
}

function resolveRelativeModulePath(importerPath: string, relativeImportPath: string): string {
  const importerSegments = normalizeRouteScannerPath(importerPath).split('/')
  importerSegments.pop()

  const importSegments = normalizeRouteScannerPath(relativeImportPath).split('/')
  for (const segment of importSegments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (importerSegments.length > 0) importerSegments.pop()
      continue
    }
    importerSegments.push(segment)
  }

  return importerSegments.join('/')
}

function buildSourcePathCandidates(reference: string, importerPath?: string): string[] {
  const normalized = normalizeRouteScannerPath(reference).trim()
  if (!normalized) return []

  const candidates = new Set<string>()
  const addCandidate = (value: string) => {
    const normalizedValue = normalizeRelativeProjectFilePath(value).replace(/\/+$/, '')
    if (normalizedValue) candidates.add(normalizedValue)
  }

  if (normalized.startsWith('./') || normalized.startsWith('../')) {
    if (importerPath) {
      addCandidate(resolveRelativeModulePath(importerPath, normalized))
    }
  } else if (normalized.startsWith('@/')) {
    addCandidate(`src/${normalized.slice(2)}`)
  } else if (normalized.startsWith('~/')) {
    addCandidate(`src/${normalized.slice(2)}`)
  } else if (normalized.startsWith('/src/')) {
    addCandidate(normalized.slice(1))
  } else if (normalized.startsWith('src/')) {
    addCandidate(normalized)
  } else if (normalized.startsWith('/')) {
    addCandidate(normalized.slice(1))
  }

  addCandidate(normalized)

  const expanded = new Set<string>()
  for (const candidate of candidates) {
    expanded.add(candidate)
    const hasKnownExtension = SOURCE_FILE_EXTENSIONS.some((ext) => candidate.endsWith(ext))
    if (!hasKnownExtension) {
      for (const extension of SOURCE_FILE_EXTENSIONS) {
        expanded.add(`${candidate}${extension}`)
      }
      for (const extension of SOURCE_FILE_EXTENSIONS) {
        expanded.add(`${candidate}/index${extension}`)
      }
    }
  }

  return Array.from(expanded)
}

function resolveImportPathFromFiles(
  importPath: string,
  importerPath: string,
  availableFiles: string[],
): string | null {
  const normalizedFiles = availableFiles.map((file) => normalizeRouteScannerPath(file))
  const lowerCaseFileMap = new Map(normalizedFiles.map((file) => [file.toLowerCase(), file]))

  for (const candidate of buildSourcePathCandidates(importPath, importerPath)) {
    const exactMatch = normalizedFiles.find((file) => file === candidate)
    if (exactMatch) return exactMatch

    const lowerCaseMatch = lowerCaseFileMap.get(candidate.toLowerCase())
    if (lowerCaseMatch) return lowerCaseMatch
  }

  const bareName = importPath.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|vue|astro|svelte)$/, '') ?? null
  if (!bareName) return null

  const lowerBareName = bareName.toLowerCase()
  const suffixMatches = normalizedFiles.filter((file) => {
    const fileName = file.split('/').pop()?.replace(/\.(tsx|jsx|ts|js|vue|astro|svelte)$/, '') ?? ''
    return fileName.toLowerCase() === lowerBareName
  })

  return suffixMatches.length === 1 ? suffixMatches[0] : null
}

function generateRouteName(routePath: string): string {
  if (routePath === '/') return 'Home'

  return routePath
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/^:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Page'
}

function sortRoutes(routes: ProjectScannedRoute[]): ProjectScannedRoute[] {
  return routes.sort((left, right) => {
    if (left.path === '/') return -1
    if (right.path === '/') return 1
    return left.path.localeCompare(right.path)
  })
}

function scanNextjsRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  const routes: ProjectScannedRoute[] = []
  const appRouterFiles = files.filter((file) => {
    const filePath = normalizeRouteScannerPath(file.path)
    return (
      (filePath.startsWith('src/app/') || filePath.startsWith('app/')) &&
      /page\.(tsx|jsx|ts|js)$/.test(filePath) &&
      !filePath.includes('_') &&
      !filePath.includes('api/')
    )
  })
  const pagesRouterFiles = files.filter((file) => {
    const filePath = normalizeRouteScannerPath(file.path)
    return (
      (filePath.startsWith('src/pages/') || filePath.startsWith('pages/')) &&
      /\.(tsx|jsx|ts|js)$/.test(filePath) &&
      !filePath.includes('_app') &&
      !filePath.includes('_document') &&
      !filePath.includes('api/')
    )
  })

  for (const file of appRouterFiles) {
    const filePath = normalizeRouteScannerPath(file.path)
    let routePath = filePath
      .replace(/^src\/app\//, '/')
      .replace(/^app\//, '/')
      .replace(/\/page\.(tsx|jsx|ts|js)$/, '')

    if (routePath === '') routePath = '/'
    routes.push({
      name: generateRouteName(routePath),
      path: routePath,
      file: filePath,
      type: routePath.includes('[') ? 'dynamic' : 'static',
    })
  }

  if (routes.length === 0) {
    for (const file of pagesRouterFiles) {
      const filePath = normalizeRouteScannerPath(file.path)
      let routePath = filePath
        .replace(/^src\/pages\//, '/')
        .replace(/^pages\//, '/')
        .replace(/\/index\.(tsx|jsx|ts|js)$/, '')
        .replace(/\.(tsx|jsx|ts|js)$/, '')

      if (routePath === '') routePath = '/'
      routes.push({
        name: generateRouteName(routePath),
        path: routePath,
        file: filePath,
        type: routePath.includes('[') ? 'dynamic' : 'static',
      })
    }
  }

  return sortRoutes(routes)
}

function scanRemixRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  const routes = files
    .filter((file) => {
      const filePath = normalizeRouteScannerPath(file.path)
      return filePath.startsWith('app/routes/') && /\.(tsx|jsx|ts|js)$/.test(filePath)
    })
    .map((file): ProjectScannedRoute => {
      const filePath = normalizeRouteScannerPath(file.path)
      let routePath = filePath
        .replace(/^app\/routes\//, '/')
        .replace(/\.(tsx|jsx|ts|js)$/, '')
        .replace(/\./g, '/')
        .replace(/_index$/, '')
        .replace(/\$([^/]+)/g, ':$1')

      if (routePath.endsWith('/')) routePath = routePath.slice(0, -1) || '/'
      return {
        name: generateRouteName(routePath),
        path: routePath,
        file: filePath,
        type: routePath.includes(':') || routePath.includes('$') ? 'dynamic' : 'static',
      }
    })

  return sortRoutes(routes)
}

function scanSvelteKitRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('src/routes/') && filePath.endsWith('+page.svelte')
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/routes/, '').replace(/\/\+page\.svelte$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('[') ? 'dynamic' : 'static',
        }
      }),
  )
}

function scanNuxtRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('pages/') && filePath.endsWith('.vue')
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^pages/, '').replace(/\.vue$/, '').replace(/\/index$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('[') ? 'dynamic' : 'static',
        }
      }),
  )
}

function scanAstroRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('src/pages/') && /\.(astro|md|mdx)$/.test(filePath)
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/pages/, '').replace(/\.(astro|md|mdx)$/, '').replace(/\/index$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('[') ? 'dynamic' : 'static',
        }
      }),
  )
}

function scanGatsbyRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('src/pages/') && /\.(tsx|jsx|ts|js)$/.test(filePath)
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/pages/, '').replace(/\.(tsx|jsx|ts|js)$/, '').replace(/\/index$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('{') ? 'dynamic' : 'static',
        }
      }),
  )
}

function scanSolidStartRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('src/routes/') && /\.(tsx|jsx)$/.test(filePath) && !filePath.includes('(')
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/routes/, '').replace(/\.(tsx|jsx)$/, '').replace(/\/index$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('[') ? 'dynamic' : 'static',
        }
      }),
  )
}

function scanQwikRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return filePath.startsWith('src/routes/') && filePath.endsWith('/index.tsx')
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/routes/, '').replace(/\/index\.tsx$/, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: routePath.includes('[') ? 'dynamic' : 'static',
        }
      }),
  )
}

async function parseReactRouterRoutes(
  projectPath: string,
  appFilePath: string,
  availableFiles: string[],
): Promise<ProjectScannedRoute[]> {
  const routes: ProjectScannedRoute[] = []
  const contentResult = await readProjectFile(projectPath, appFilePath)
  if (!contentResult.success || !contentResult.content) return routes

  const source = contentResult.content
  const importMap = new Map<string, string>()
  const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  let importMatch: RegExpExecArray | null
  while ((importMatch = importRegex.exec(source)) !== null) {
    const [, componentName, importPath] = importMatch
    const resolvedPath = resolveImportPathFromFiles(importPath, appFilePath, availableFiles)
    if (resolvedPath) {
      importMap.set(componentName, resolvedPath)
      continue
    }

    const fallbackCandidate = buildSourcePathCandidates(importPath, appFilePath)[0]
    if (fallbackCandidate) {
      importMap.set(componentName, fallbackCandidate)
    }
  }

  const addParsedRoute = (rawPath: string, componentName: string, isIndex = false) => {
    if (componentName.toLowerCase().includes('layout')) return
    const routePath = isIndex ? '/' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`
    if (routePath === '/' && routes.some((route) => route.path === '/')) return
    const filePath = importMap.get(componentName) || `src/pages/${componentName}.tsx`
    routes.push({
      name: generateRouteName(routePath),
      path: routePath,
      file: filePath,
      type: routePath.includes(':') || routePath.includes('*') ? 'dynamic' : 'static',
    })
  }

  const jsxPathElementRegex = /<Route\b[\s\S]{0,320}?\bpath=["']([^"']*)["'][\s\S]{0,320}?\belement=\{\s*<(\w+)/g
  let routeMatch: RegExpExecArray | null
  while ((routeMatch = jsxPathElementRegex.exec(source)) !== null) {
    const [, routePath, componentName] = routeMatch
    addParsedRoute(routePath, componentName)
  }

  const jsxPathComponentRegex = /<Route\b[\s\S]{0,320}?\bpath=["']([^"']*)["'][\s\S]{0,320}?\bComponent=\{(\w+)\}/g
  while ((routeMatch = jsxPathComponentRegex.exec(source)) !== null) {
    const [, routePath, componentName] = routeMatch
    addParsedRoute(routePath, componentName)
  }

  const jsxIndexElementRegex = /<Route\b[\s\S]{0,240}?\bindex\b[\s\S]{0,240}?\belement=\{\s*<(\w+)/g
  while ((routeMatch = jsxIndexElementRegex.exec(source)) !== null) {
    const [, componentName] = routeMatch
    addParsedRoute('/', componentName, true)
  }

  const selfClosingRouteRegex = /<Route\b([\s\S]*?)\/>/g
  while ((routeMatch = selfClosingRouteRegex.exec(source)) !== null) {
    const attributes = routeMatch[1]
    const componentName = attributes.match(/\belement=\{\s*<(\w+)(?:\s*\/>|>[\s\S]*?<\/\w+>)\s*\}/)?.[1]
      ?? attributes.match(/\bComponent=\{(\w+)\}/)?.[1]
    if (!componentName) continue

    const pathMatch = attributes.match(/\bpath=["']([^"']*)["']/)
    if (pathMatch) {
      addParsedRoute(pathMatch[1], componentName)
      continue
    }

    if (/\bindex\b/.test(attributes)) {
      addParsedRoute('/', componentName, true)
    }
  }

  const objectPathElementRegex = /\bpath\s*:\s*["']([^"']*)["'][\s\S]{0,240}?\belement\s*:\s*<(\w+)(?:\s*\/>|>[\s\S]*?<\/\w+>)/g
  while ((routeMatch = objectPathElementRegex.exec(source)) !== null) {
    const [, routePath, componentName] = routeMatch
    addParsedRoute(routePath, componentName)
  }

  const objectPathComponentRegex = /\bpath\s*:\s*["']([^"']*)["'][\s\S]{0,240}?\bComponent\s*:\s*(\w+)/g
  while ((routeMatch = objectPathComponentRegex.exec(source)) !== null) {
    const [, routePath, componentName] = routeMatch
    addParsedRoute(routePath, componentName)
  }

  const objectIndexElementRegex = /\bindex\s*:\s*true[\s\S]{0,240}?\belement\s*:\s*<(\w+)(?:\s*\/>|>[\s\S]*?<\/\w+>)/g
  while ((routeMatch = objectIndexElementRegex.exec(source)) !== null) {
    const [, componentName] = routeMatch
    addParsedRoute('/', componentName, true)
  }

  const objectIndexComponentRegex = /\bindex\s*:\s*true[\s\S]{0,240}?\bComponent\s*:\s*(\w+)/g
  while ((routeMatch = objectIndexComponentRegex.exec(source)) !== null) {
    const [, componentName] = routeMatch
    addParsedRoute('/', componentName, true)
  }

  const seen = new Set<string>()
  return routes.filter((route) => {
    if (seen.has(route.path)) return false
    seen.add(route.path)
    return true
  })
}

async function detectExplicitRootRouteInReactApp(
  projectPath: string,
  appFilePath: string,
): Promise<boolean> {
  const contentResult = await readProjectFile(projectPath, appFilePath)
  if (!contentResult.success || !contentResult.content) return false

  const source = contentResult.content
  return (
    /<Route[^>]*\bpath=["']\/["']/.test(source) ||
    /<Route[^>]*\bindex\b/.test(source) ||
    /\bpath\s*:\s*["']\/["']/.test(source) ||
    /\bindex\s*:\s*true\b/.test(source)
  )
}

async function scanReactRoutes(
  projectPath: string,
  files: ProjectFileEntry[],
): Promise<ProjectScannedRoute[]> {
  const availableFiles = files.map((file) => normalizeRouteScannerPath(file.path))
  const appFile = files.find((file) => {
    const filePath = normalizeRouteScannerPath(file.path)
    return filePath === 'src/App.tsx' || filePath === 'src/App.jsx'
  })

  let hasExplicitRootRoute = false
  if (appFile) {
    const parsedRoutes = await parseReactRouterRoutes(projectPath, appFile.path, availableFiles)
    if (parsedRoutes.length > 0) {
      return sortRoutes(parsedRoutes)
    }
    hasExplicitRootRoute = await detectExplicitRootRouteInReactApp(projectPath, appFile.path)
  }

  const pageRoutes = files
    .filter((file) => {
      const filePath = normalizeRouteScannerPath(file.path)
      return filePath.startsWith('src/pages/') && /\.(tsx|jsx)$/.test(filePath)
    })
    .map((file): ProjectScannedRoute => {
      const filePath = normalizeRouteScannerPath(file.path)
      let routePath = filePath
        .replace(/^src\/pages/, '')
        .replace(/\.(tsx|jsx)$/, '')
        .replace(/\/index$/, '')
        .replace(/\/Index$/, '')

      if (/^\/home$/i.test(routePath)) {
        routePath = hasExplicitRootRoute ? '/' : '/home'
      }
      if (routePath === '') routePath = '/'
      return {
        name: generateRouteName(routePath),
        path: routePath,
        file: filePath,
        type: 'static',
      }
    })

  return sortRoutes(pageRoutes)
}

function scanVueRoutes(files: ProjectFileEntry[]): ProjectScannedRoute[] {
  return sortRoutes(
    files
      .filter((file) => {
        const filePath = normalizeRouteScannerPath(file.path)
        return (filePath.startsWith('src/pages/') || filePath.startsWith('src/views/')) && filePath.endsWith('.vue')
      })
      .map((file): ProjectScannedRoute => {
        const filePath = normalizeRouteScannerPath(file.path)
        let routePath = filePath.replace(/^src\/(pages|views)/, '').replace(/\.vue$/, '').replace(/\/index$/i, '')
        if (routePath === '') routePath = '/'
        return {
          name: generateRouteName(routePath),
          path: routePath,
          file: filePath,
          type: 'static',
        }
      }),
  )
}

async function scanRoutesForFramework(
  projectPath: string,
  framework: ProjectFrameworkId,
  files: ProjectFileEntry[],
): Promise<ProjectScannedRoute[]> {
  switch (framework) {
    case 'nextjs':
      return scanNextjsRoutes(files)
    case 'remix':
      return scanRemixRoutes(files)
    case 'sveltekit':
      return scanSvelteKitRoutes(files)
    case 'nuxt':
      return scanNuxtRoutes(files)
    case 'astro':
      return scanAstroRoutes(files)
    case 'gatsby':
      return scanGatsbyRoutes(files)
    case 'solid-start':
      return scanSolidStartRoutes(files)
    case 'qwik':
      return scanQwikRoutes(files)
    case 'vite-react':
    case 'cra':
      return await scanReactRoutes(projectPath, files)
    case 'vite-vue':
      return scanVueRoutes(files)
    default: {
      const nextRoutes = scanNextjsRoutes(files)
      if (nextRoutes.length > 0) return nextRoutes
      const reactRoutes = await scanReactRoutes(projectPath, files)
      if (reactRoutes.length > 0) return reactRoutes
      return []
    }
  }
}

async function buildRouteScanResult(
  projectPath: string,
  frameworkInfo?: ProjectStoredFrameworkInfo | null,
): Promise<ProjectRouteScanResult> {
  const resolvedProjectPath = normalizeProjectPath(projectPath)
  const framework = await resolveProjectFramework(resolvedProjectPath, frameworkInfo)
  const config = FRAMEWORK_CONFIGS[framework]
  const listResult = await listProjectFilesFromIndex(resolvedProjectPath)
  if (!listResult.success) {
    return emptyRouteScanResult(framework, listResult.error ?? 'Failed to list project files')
  }

  const routes = await scanRoutesForFramework(resolvedProjectPath, framework, filesFromListResult(listResult))
  return {
    success: true,
    routes,
    framework,
    frameworkDisplayName: config.displayName,
    routeConvention: config.routeConvention,
  }
}

export async function scanProjectRoutesFromAnalysis({
  projectPath,
  frameworkInfo,
}: {
  projectPath: string
  frameworkInfo?: ProjectStoredFrameworkInfo | null
}): Promise<ProjectRouteScanResult> {
  const entry = getOrCreateRouteCacheEntry(projectPath, frameworkInfo)
  if (isRouteAnalysisFresh(entry) && entry.result) {
    entry.lastAccessedAt = Date.now()
    return entry.result
  }

  if (entry.promise) {
    return entry.promise
  }

  entry.promise = buildRouteScanResult(entry.projectPath, frameworkInfo)
    .then((result) => {
      entry.result = result
      entry.builtAt = Date.now()
      entry.lastAccessedAt = entry.builtAt
      entry.stale = false
      return result
    })
    .catch((error) => emptyRouteScanResult('unknown', error instanceof Error ? error.message : 'Failed to scan routes'))
    .finally(() => {
      entry.promise = null
    })

  return entry.promise
}

export async function getProjectContextOptionsFromAnalysis({
  projectPath,
  frameworkInfo,
}: {
  projectPath: string
  frameworkInfo?: ProjectStoredFrameworkInfo | null
}): Promise<ProjectContextOptionsResult> {
  const resolvedProjectPath = normalizeProjectPath(projectPath)
  const [fileResult, routeResult] = await Promise.all([
    listProjectFilesFromIndex(resolvedProjectPath),
    scanProjectRoutesFromAnalysis({ projectPath: resolvedProjectPath, frameworkInfo }),
  ])

  if (!fileResult.success) {
    return {
      ...emptyRouteScanResult(routeResult.framework, fileResult.error ?? 'Failed to list project files'),
      files: [],
    }
  }

  return {
    ...routeResult,
    success: fileResult.success && routeResult.success,
    files: filesFromListResult(fileResult).map((file) => file.path),
  }
}

export function markProjectAnalysisStaleForFile(filePath: string): void {
  const resolvedFilePath = path.resolve(filePath)

  for (const entry of routeAnalysisCacheByKey.values()) {
    if (isFileUnderProject(entry.projectPath, resolvedFilePath)) {
      entry.stale = true
    }
  }
}

export function clearProjectAnalysisCachesForTests(): void {
  routeAnalysisCacheByKey.clear()
}
