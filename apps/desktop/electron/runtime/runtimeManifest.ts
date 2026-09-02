import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityCatalog } from './runtimeTypes'

function safeReadJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function getAppRoot(): string {
  return process.env.APP_ROOT || process.cwd()
}

function firstExistingPath(candidates: string[]): string {
  const match = candidates.find((candidate) => fs.existsSync(candidate))
  return match || candidates[0]
}

/**
 * Resolve a directory under the monorepo's `build/` output for an unpackaged run.
 *
 * The `prepare:*` scripts and electron-builder both use `<repo>/build`, but
 * APP_ROOT is the desktop app package (`apps/desktop`), two levels below it — so
 * resolving `build/` against APP_ROOT named a directory that has never existed.
 * The app-root layout is still accepted second, which also covers a caller that
 * left APP_ROOT unset and is running from the repo root.
 *
 * Packaged builds read these from `process.resourcesPath` instead; neither
 * candidate here resolves inside an asar, so the packaged path still wins.
 */
export function resolveUnpackagedBuildDir(name: string): string {
  const appRoot = getAppRoot()
  return firstExistingPath([
    path.join(appRoot, '..', '..', 'build', name),
    path.join(appRoot, 'build', name),
  ])
}

export function getBundledCapabilityCatalogPath(): string {
  return firstExistingPath([
    path.join(resolveUnpackagedBuildDir('runtime'), 'capability-catalog.json'),
    path.join(process.resourcesPath, 'runtime', 'capability-catalog.json'),
  ])
}

export function getBundledCapabilityCatalogSignaturePath(): string {
  return firstExistingPath([
    path.join(resolveUnpackagedBuildDir('runtime'), 'capability-catalog.sig'),
    path.join(process.resourcesPath, 'runtime', 'capability-catalog.sig'),
  ])
}

export function loadBundledCapabilityCatalog(): CapabilityCatalog {
  const catalog = safeReadJsonFile<CapabilityCatalog>(getBundledCapabilityCatalogPath())
  if (catalog) return catalog
  return {
    version: '0',
    generatedAt: new Date(0).toISOString(),
    rules: [],
  }
}

export function getBundledRuntimePublicKeyPath(): string {
  const buildCandidate = path.join(resolveUnpackagedBuildDir('runtime'), 'runtime-public-key.pem')
  if (fs.existsSync(buildCandidate)) return buildCandidate
  const resourcesCandidate = path.join(process.resourcesPath, 'runtime', 'runtime-public-key.pem')
  return resourcesCandidate
}

export function loadBundledRuntimePublicKey(): string | null {
  const candidate = getBundledRuntimePublicKeyPath()
  if (!fs.existsSync(candidate)) return null
  try {
    return fs.readFileSync(candidate, 'utf-8')
  } catch {
    return null
  }
}
