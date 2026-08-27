import path from "node:path"
import * as Layer from "effect/Layer"
import * as ManagedRuntime from "effect/ManagedRuntime"

import { WorkspaceCatalog } from "./WorkspaceCatalog.ts"
import { makeWorkspaceCatalogLayer } from "./WorkspaceCatalogLayer.ts"
import { migrateFromLegacyRegistry } from "./legacyMigration.ts"

export type WorkspaceCatalogManagedRuntime = ManagedRuntime.ManagedRuntime<
  WorkspaceCatalog,
  never
>

let _runtime: WorkspaceCatalogManagedRuntime | null = null
let _initError: Error | null = null

// Deferred promise so IPC handlers registered before init can await readiness.
let _readyResolve: (() => void) | null = null
const _readyPromise = new Promise<void>((resolve) => {
  _readyResolve = resolve
})

export async function initWorkspaceCatalogRuntime(userData: string): Promise<void> {
  if (_runtime) return

  try {
    const dbPath = path.join(userData, "local-workspaces.sqlite")
    // A failed catalog DB/migration build is fatal and already surfaced via the
    // surrounding try/catch + waitForWorkspaceCatalogRuntime; die on layer-build
    // errors so the runtime's error channel is `never`, matching the contract
    // that every catalog effect is infallible at the call site.
    const layer = Layer.orDie(makeWorkspaceCatalogLayer(dbPath))
    _runtime = ManagedRuntime.make(layer)

    // Migrate legacy JSON registry on first run (idempotent)
    try {
      await migrateFromLegacyRegistry(_runtime, userData)
    } catch (e) {
      console.error("[WorkspaceCatalog] Legacy migration failed (non-fatal):", e)
    }
  } catch (e) {
    _initError = e instanceof Error ? e : new Error(String(e))
    console.error("[WorkspaceCatalog] Runtime initialization failed:", _initError)
  } finally {
    // Always resolve so IPC handlers don't hang forever.
    // If init failed, waitForWorkspaceCatalogRuntime() will throw _initError.
    _readyResolve?.()
  }
}

/**
 * Returns the runtime, waiting for initialization if it hasn't completed yet.
 * Safe to call before `initWorkspaceCatalogRuntime` finishes.
 */
export async function waitForWorkspaceCatalogRuntime(): Promise<WorkspaceCatalogManagedRuntime> {
  await _readyPromise
  if (_initError) {
    throw _initError
  }
  if (!_runtime) {
    throw new Error("[WorkspaceCatalog] Runtime not available after initialization")
  }
  return _runtime
}

export function getWorkspaceCatalogRuntime(): WorkspaceCatalogManagedRuntime {
  if (!_runtime) {
    throw new Error(
      "[WorkspaceCatalog] Runtime not initialized. Call initWorkspaceCatalogRuntime() first.",
    )
  }
  return _runtime
}

export async function disposeWorkspaceCatalogRuntime(): Promise<void> {
  if (!_runtime) return
  await _runtime.dispose()
  _runtime = null
}
