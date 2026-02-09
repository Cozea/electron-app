const GENERATED_DIRECTORIES = [
  'node_modules',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.vercel',
  'dist',
  'build',
  'out',
  'coverage',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.yarn',
  'tmp',
  'temp',
  'logs',
  'vendor',
  'target',
  '__pycache__',
] as const

const GENERATED_FILE_SUFFIXES = [
  '.log',
  '.tmp',
  '.temp',
  '.swp',
  '.swo',
  '.pid',
  'prisma/dev.db',
  'prisma/dev.db-wal',
  'prisma/dev.db-shm',
  '.tsbuildinfo',
  '.eslintcache',
] as const

export const EXCLUDED_GENERATED_DIRECTORIES: readonly string[] = GENERATED_DIRECTORIES
export const EXCLUDED_GENERATED_FILE_SUFFIXES: readonly string[] = GENERATED_FILE_SUFFIXES

export function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').toLowerCase()
}

export function shouldExcludeGeneratedDirectory(name: string): boolean {
  const normalizedName = normalizeRelativePath(name).replace(/^\/+/, '')
  return EXCLUDED_GENERATED_DIRECTORIES.includes(normalizedName)
}

export function shouldExcludeGeneratedFile(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath)
  return EXCLUDED_GENERATED_FILE_SUFFIXES.some((suffix) => (
    normalizedPath.endsWith(suffix) || normalizedPath.endsWith(`/${suffix}`)
  ))
}
