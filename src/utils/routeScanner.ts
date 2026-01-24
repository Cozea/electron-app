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
        file: `${projectPath}/${filePath}`,
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
          file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
 */
async function scanReactRoutes(projectPath: string): Promise<ScannedRoute[]> {
  const routes: ScannedRoute[] = []

  try {
    const result = await window.electronAPI.project.listFiles({ projectPath })
    if (!result.success || !result.files) return routes

    // Check for src/pages directory (common convention)
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

        if (routePath === '') routePath = '/'

        const name = generateRouteName(routePath)

        routes.push({
          name,
          path: routePath,
          file: `${projectPath}/${filePath}`,
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
        file: `${projectPath}/${filePath}`,
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
