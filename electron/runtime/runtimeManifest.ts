import fs from 'node:fs'
import path from 'node:path'
import type { CapabilityCatalog, RuntimeManifest } from './runtimeTypes'

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

export function getBundledRuntimeManifestPath(): string {
  return path.join(getAppRoot(), 'build', 'runtime', 'manifest.json')
}

export function getBundledRuntimeManifestSignaturePath(): string {
  return path.join(getAppRoot(), 'build', 'runtime', 'manifest.sig')
}

export function loadBundledRuntimeManifest(): RuntimeManifest {
  const manifest = safeReadJsonFile<RuntimeManifest>(getBundledRuntimeManifestPath())
  if (manifest) return manifest
  return {
    generatedAt: new Date(0).toISOString(),
    entries: [],
  }
}

export function getBundledCapabilityCatalogPath(): string {
  return path.join(getAppRoot(), 'build', 'runtime', 'capability-catalog.json')
}

export function getBundledCapabilityCatalogSignaturePath(): string {
  return path.join(getAppRoot(), 'build', 'runtime', 'capability-catalog.sig')
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
  const appRootCandidate = path.join(getAppRoot(), 'build', 'runtime', 'runtime-public-key.pem')
  if (fs.existsSync(appRootCandidate)) return appRootCandidate
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
