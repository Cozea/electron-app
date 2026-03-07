/**
 * Route Scanner - Multi-Framework Support
 *
 * Scans project directories for routes based on detected framework.
 * Uses stored frameworkInfo when available, falls back to detection.
 */

import { getFrameworkInfo, type Framework } from './projectDetector'

export interface ScannedRoute {
  name: string
  path: string
  file: string
  type: 'static' | 'dynamic'
  description?: string
}

export interface ScanResult {
  routes: ScannedRoute[]
  framework: Framework
  frameworkDisplayName: string
  routeConvention: string
}

const SOURCE_FILE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.astro', '.svelte']

function normalizeRouteScannerPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/')
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
    const normalizedValue = normalizeRouteScannerPath(value)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
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
  availableFiles: string[]
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

/**
 * Scan a project directory for routes based on framework.
 * Uses stored metadata if available, otherwise detects at runtime.
 */
export async function scanForRoutes(
  projectPath: string,
  storedFrameworkInfo?: {
    framework?: string
    devCommand?: string
    devPort?: number
  } | null
): Promise<ScanResult> {
  // Get framework info (from stored or detection)
  const frameworkInfo = await getFrameworkInfo(
    projectPath,
    storedFrameworkInfo?.framework as Framework | undefined,
    storedFrameworkInfo?.devCommand,
    storedFrameworkInfo?.devPort,
  )

  // Route scan based on framework
  let routes: ScannedRoute[] = []

  switch (frameworkInfo.framework) {
    case 'nextjs':
      routes = await scanNextjsRoutes(projectPath)
      break
    case 'remix':
      routes = await scanRemixRoutes(projectPath)
      break
    case 'sveltekit':
      routes = await scanSvelteKitRoutes(projectPath)
      break
    case 'nuxt':
      routes = await scanNuxtRoutes(projectPath)
      break
    case 'astro':
      routes = await scanAstroRoutes(projectPath)
      break
    case 'gatsby':
      routes = await scanGatsbyRoutes(projectPath)
      break
    case 'solid-start':
      routes = await scanSolidStartRoutes(projectPath)
      break
    case 'qwik':
      routes = await scanQwikRoutes(projectPath)
      break
    case 'vite-react':
    case 'cra':
      routes = await scanReactRoutes(projectPath)
      break
    case 'vite-vue':
      routes = await scanVueRoutes(projectPath)
      break
    default:
      // Try generic file-based scan
      routes = await scanGenericRoutes(projectPath)
  }

  return {
    routes,
    framework: frameworkInfo.framework,
    frameworkDisplayName: frameworkInfo.displayName,
    routeConvention: frameworkInfo.routeConvention,
  }
}

/**
 * Next.js App Router / Pages Router
 */
async function scanNextjsRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    // App Router: app/**/page.tsx
    const appRouterFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        (path.startsWith('src/app/') || path.startsWith('app/')) &&
        /page\.(tsx|jsx|ts|js)$/.test(path) &&
        !path.includes('_') &&
        !path.includes('api/')
      )
    })

    // Pages Router: pages/**/*.tsx (excluding _app, _document)
    const pagesRouterFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        (path.startsWith('src/pages/') || path.startsWith('pages/')) &&
        /\.(tsx|jsx|ts|js)$/.test(path) &&
        !path.includes('_app') &&
        !path.includes('_document') &&
        !path.includes('api/')
      )
    })

    // Process App Router files
    for (const file of appRouterFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/app\//, '/')
        .replace(/^app\//, '/')
        .replace(/\/page\.(tsx|jsx|ts|js)$/, '')

      if (routePath === '') routePath = '/'

      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }

    // Process Pages Router files (if no App Router routes found)
    if (routes.length === 0) {
      for (const file of pagesRouterFiles) {
        const filePath = file.path.replace(/\\/g, '/')
        let routePath = filePath
          .replace(/^src\/pages\//, '/')
          .replace(/^pages\//, '/')
          .replace(/\/index\.(tsx|jsx|ts|js)$/, '')
          .replace(/\.(tsx|jsx|ts|js)$/, '')

        if (routePath === '') routePath = '/'

        const isDynamic = routePath.includes('[')
        const name = generateRouteName(routePath)

        routes.push({
          name,
          path: routePath,
          file: filePath,
          type: isDynamic ? 'dynamic' : 'static',
        })
      }
    }
  } catch (e) {
    console.error('Failed to scan Next.js routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Remix: app/routes/ (recursive .tsx files)
 */
async function scanRemixRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('app/routes/') &&
        /\.(tsx|jsx|ts|js)$/.test(path)
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      // Remix uses . for nested routes: app/routes/blog.$slug.tsx -> /blog/:slug
      let routePath = filePath
        .replace(/^app\/routes\//, '/')
        .replace(/\.(tsx|jsx|ts|js)$/, '')
        .replace(/\./g, '/')
        .replace(/_index$/, '')
        .replace(/\$([^/]+)/g, ':$1') // $slug -> :slug

      if (routePath === '/') routePath = '/'
      if (routePath.endsWith('/')) routePath = routePath.slice(0, -1) || '/'

      const isDynamic = routePath.includes(':') || routePath.includes('$')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Remix routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * SvelteKit: src/routes/ (recursive +page.svelte files)
 */
async function scanSvelteKitRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/routes/') &&
        path.endsWith('+page.svelte')
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/routes/, '')
        .replace(/\/\+page\.svelte$/, '')

      if (routePath === '') routePath = '/'

      // SvelteKit uses [param] for dynamic routes
      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan SvelteKit routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Nuxt: pages/ (recursive .vue files)
 */
async function scanNuxtRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return path.startsWith('pages/') && path.endsWith('.vue')
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^pages/, '')
        .replace(/\.vue$/, '')
        .replace(/\/index$/, '')

      if (routePath === '') routePath = '/'

      // Nuxt uses [param] for dynamic routes
      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Nuxt routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Astro: src/pages/ (recursive .astro files)
 */
async function scanAstroRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/pages/') &&
        /\.(astro|md|mdx)$/.test(path)
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/pages/, '')
        .replace(/\.(astro|md|mdx)$/, '')
        .replace(/\/index$/, '')

      if (routePath === '') routePath = '/'

      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Astro routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Gatsby: src/pages/ (recursive .tsx files)
 */
async function scanGatsbyRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/pages/') &&
        /\.(tsx|jsx|ts|js)$/.test(path)
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/pages/, '')
        .replace(/\.(tsx|jsx|ts|js)$/, '')
        .replace(/\/index$/, '')

      if (routePath === '') routePath = '/'

      const isDynamic = routePath.includes('{') // Gatsby uses {param}
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Gatsby routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * SolidStart: src/routes/ (recursive .tsx files)
 */
async function scanSolidStartRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/routes/') &&
        /\.(tsx|jsx)$/.test(path) &&
        !path.includes('(') // Exclude route groups
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/routes/, '')
        .replace(/\.(tsx|jsx)$/, '')
        .replace(/\/index$/, '')

      if (routePath === '') routePath = '/'

      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan SolidStart routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Qwik City: src/routes/ (recursive index.tsx files)
 */
async function scanQwikRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    const routeFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/routes/') &&
        path.endsWith('/index.tsx')
      )
    })

    for (const file of routeFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/routes/, '')
        .replace(/\/index\.tsx$/, '')

      if (routePath === '') routePath = '/'

      const isDynamic = routePath.includes('[')
      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Qwik routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * React (Vite/CRA) - Look for pages folder or router config
 *
 * Note: React Router projects typically use code-based routing, not file-based.
 * We attempt to parse App.tsx for actual route definitions first, falling back
 * to file-based conventions if parsing fails.
 */
async function scanReactRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    let hasExplicitRootRoute = false

    // First, try to parse App.tsx for React Router route definitions
    const appFile = result.files.find(f => {
      const p = f.path.replace(/\\/g, '/')
      return p === 'src/App.tsx' || p === 'src/App.jsx'
    })

    if (appFile) {
      const parsedRoutes = await parseReactRouterRoutes(
        projectPath,
        appFile.path,
        result.files.map((file) => file.path.replace(/\\/g, '/'))
      )
      if (parsedRoutes.length > 0) {
        return sortRoutes(parsedRoutes)
      }
      hasExplicitRootRoute = await detectExplicitRootRouteInReactApp(projectPath, appFile.path)
    }

    // Fallback: Check for src/pages directory (common convention)
    const pageFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        path.startsWith('src/pages/') &&
        /\.(tsx|jsx)$/.test(path)
      )
    })

    if (pageFiles.length > 0) {
      for (const file of pageFiles) {
        const filePath = file.path.replace(/\\/g, '/')
        let routePath = filePath
          .replace(/^src\/pages/, '')
          .replace(/\.(tsx|jsx)$/, '')
          .replace(/\/index$/, '')
          .replace(/\/Index$/, '')

        // Home files are often mapped explicitly in router config.
        // When we can detect an explicit root route, keep Home as "/".
        // Otherwise preserve "/home" so non-standard home routes remain reachable.
        if (/^\/home$/i.test(routePath)) {
          routePath = hasExplicitRootRoute ? '/' : '/home'
        }

        if (routePath === '') routePath = '/'

        const name = generateRouteName(routePath)

        routes.push({
          name,
          path: routePath,
          file: filePath,
          type: 'static',
        })
      }
    }
  } catch (e) {
    console.error('Failed to scan React routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Parse React Router route definitions from App.tsx
 * Extracts routes from <Route path="..." element={...} /> patterns
 */
async function parseReactRouterRoutes(
  projectPath: string,
  appFilePath: string,
  availableFiles: string[]
): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const content = await window.electronAPI.project.readFile({
      projectPath,
      filePath: appFilePath,
    })

    if (!content.success || !content.content) return routes

    // Match import statements to map component names to files
    const importMap = new Map<string, string>()
    const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
    let importMatch
    while ((importMatch = importRegex.exec(content.content)) !== null) {
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

      const routePath = isIndex
        ? '/'
        : rawPath.startsWith('/')
          ? rawPath
          : `/${rawPath}`

      if (routePath === '/' && routes.some((route) => route.path === '/')) {
        return
      }

      const filePath = importMap.get(componentName) || `src/pages/${componentName}.tsx`
      const isDynamic = routePath.includes(':') || routePath.includes('*')

      routes.push({
        name: generateRouteName(routePath),
        path: routePath,
        file: filePath,
        type: isDynamic ? 'dynamic' : 'static',
      })
    }

    // Match self-closing JSX routes regardless of attribute order and with either
    // element={<Page />} or Component={Page}.
    const selfClosingRouteRegex = /<Route\b([\s\S]*?)\/>/g
    let routeMatch
    while ((routeMatch = selfClosingRouteRegex.exec(content.content)) !== null) {
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

    // Match router-object config patterns such as:
    // { path: "/", element: <Home /> } or { path: "/", Component: Home }
    const objectPathElementRegex = /\bpath\s*:\s*["']([^"']*)["'][\s\S]{0,240}?\belement\s*:\s*<(\w+)(?:\s*\/>|>[\s\S]*?<\/\w+>)/g
    while ((routeMatch = objectPathElementRegex.exec(content.content)) !== null) {
      const [, path, componentName] = routeMatch
      addParsedRoute(path, componentName)
    }

    const objectPathComponentRegex = /\bpath\s*:\s*["']([^"']*)["'][\s\S]{0,240}?\bComponent\s*:\s*(\w+)/g
    while ((routeMatch = objectPathComponentRegex.exec(content.content)) !== null) {
      const [, path, componentName] = routeMatch
      addParsedRoute(path, componentName)
    }

    const objectIndexElementRegex = /\bindex\s*:\s*true[\s\S]{0,240}?\belement\s*:\s*<(\w+)(?:\s*\/>|>[\s\S]*?<\/\w+>)/g
    while ((routeMatch = objectIndexElementRegex.exec(content.content)) !== null) {
      const [, componentName] = routeMatch
      addParsedRoute('/', componentName, true)
    }

    const objectIndexComponentRegex = /\bindex\s*:\s*true[\s\S]{0,240}?\bComponent\s*:\s*(\w+)/g
    while ((routeMatch = objectIndexComponentRegex.exec(content.content)) !== null) {
      const [, componentName] = routeMatch
      addParsedRoute('/', componentName, true)
    }

    // Deduplicate routes by path (keep first occurrence)
    const seen = new Set<string>()
    const deduped: ScannedRoute[] = []
    for (const route of routes) {
      if (!seen.has(route.path)) {
        seen.add(route.path)
        deduped.push(route)
      }
    }
    return deduped
  } catch (e) {
    console.error('Failed to parse React Router routes:', e)
  }

  return routes
}

async function detectExplicitRootRouteInReactApp(
  projectPath: string,
  appFilePath: string
): Promise<boolean> {
  try {
    const content = await window.electronAPI.project.readFile({
      projectPath,
      filePath: appFilePath,
    })

    if (!content.success || !content.content) return false

    const source = content.content
    return (
      /<Route[^>]*\bpath=["']\/["']/.test(source) ||
      /<Route[^>]*\bindex\b/.test(source) ||
      /\bpath\s*:\s*["']\/["']/.test(source) ||
      /\bindex\s*:\s*true\b/.test(source)
    )
  } catch {
    return false
  }
}

/**
 * Vue (Vite) - Look for pages or views folder
 */
async function scanVueRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    // Check for src/pages or src/views directory
    const pageFiles = result.files.filter(file => {
      const path = file.path.replace(/\\/g, '/')
      return (
        (path.startsWith('src/pages/') || path.startsWith('src/views/')) &&
        path.endsWith('.vue')
      )
    })

    for (const file of pageFiles) {
      const filePath = file.path.replace(/\\/g, '/')
      let routePath = filePath
        .replace(/^src\/(pages|views)/, '')
        .replace(/\.vue$/, '')
        .replace(/\/index$/i, '')

      if (routePath === '') routePath = '/'

      const name = generateRouteName(routePath)

      routes.push({
        name,
        path: routePath,
        file: filePath,
        type: 'static',
      })
    }
  } catch (e) {
    console.error('Failed to scan Vue routes:', e)
  }

  return sortRoutes(routes)
}

/**
 * Generic fallback - look for common patterns
 */
async function scanGenericRoutes(projectPath: string): Promise<ScannedRoute[]> {
  // Try Next.js first, then other common patterns
  const nextRoutes = await scanNextjsRoutes(projectPath)
  if (nextRoutes.length > 0) return nextRoutes

  const reactRoutes = await scanReactRoutes(projectPath)
  if (reactRoutes.length > 0) return reactRoutes

  return []
}

/**
 * Generate a readable name from a route path
 */
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
    .replace(/\b\w/g, c => c.toUpperCase()) || 'Page'
}

/**
 * Sort routes: home first, then alphabetically
 */
function sortRoutes(routes: ScannedRoute[]): ScannedRoute[] {
  return routes.sort((a, b) => {
    if (a.path === '/') return -1
    if (b.path === '/') return 1
    return a.path.localeCompare(b.path)
  })
}

/**
 * Generate a route description using AI (placeholder for future implementation)
 */
export async function describeRoute(route: ScannedRoute): Promise<string> {
  // TODO: Implement AI-based route description
  return `Page at ${route.path}`
}
