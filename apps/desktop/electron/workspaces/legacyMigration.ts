import fs from "node:fs/promises"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as ManagedRuntime from "effect/ManagedRuntime"

import type { WorkspaceSource } from "../../../../shared/workspaceTypes.ts"
import { WorkspaceCatalog } from "./WorkspaceCatalog.ts"

type LegacyRegistrySource = "manual" | "cloud-hint" | "attached-import" | "slug-resolution"

interface LegacyRegistryEntry {
  path: string
  updatedAt: number
  verifiedAt: number
  source: LegacyRegistrySource
}

interface LegacyRegistryState {
  version: 1
  projects: Record<string, LegacyRegistryEntry>
}

const LEGACY_SOURCE_MAP: Record<LegacyRegistrySource, WorkspaceSource> = {
  "manual": "migrate_registry_manual",
  "cloud-hint": "migrate_registry_cloud_hint",
  "attached-import": "migrate_registry_attached_import",
  "slug-resolution": "migrate_registry_slug_resolution",
}

const MIGRATION_SETTING_KEY = "legacy_registry_migration_completed_at"

export interface LegacyMigrationResult {
  skipped: boolean
  migrated: number
  broken: number
  conflicts: number
  errors: string[]
}

export async function migrateFromLegacyRegistry(
  runtime: ManagedRuntime.ManagedRuntime<WorkspaceCatalog, never>,
  userData: string,
): Promise<LegacyMigrationResult> {
  const run = <A>(eff: Effect.Effect<A, unknown, WorkspaceCatalog>) =>
    runtime.runPromise(eff as Effect.Effect<A, never, WorkspaceCatalog>)

  // Check if already migrated
  const alreadyMigrated = await run(
    Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.getSetting(MIGRATION_SETTING_KEY)),
  )
  if (alreadyMigrated) {
    return { skipped: true, migrated: 0, broken: 0, conflicts: 0, errors: [] }
  }

  const registryPath = path.join(userData, "project-path-registry.json")

  let registry: LegacyRegistryState
  try {
    const raw = await fs.readFile(registryPath, "utf-8")
    registry = JSON.parse(raw) as LegacyRegistryState
  } catch {
    await run(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
        c.setSetting(MIGRATION_SETTING_KEY, String(Date.now())),
      ),
    )
    return { skipped: false, migrated: 0, broken: 0, conflicts: 0, errors: [] }
  }

  const entries = Object.entries(registry.projects ?? {})
  let migrated = 0
  let broken = 0
  let conflicts = 0
  const errors: string[] = []

  for (const [projectId, entry] of entries) {
    try {
      // Check if path exists
      let pathExists = false
      try {
        const stat = await fs.stat(entry.path)
        pathExists = stat.isDirectory()
      } catch {
        pathExists = false
      }

      if (!pathExists) {
        // Path is gone — skip the bind. The project resolves as
        // missing-binding, which is what surfaces the repair screen.
        broken++
        continue
      }

      const bindResult = await run(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
          c.bindExistingFolder({
            projectId,
            folderPath: entry.path,
            writeMarker: false,
            setActive: true,
            source: LEGACY_SOURCE_MAP[entry.source],
          }),
        ),
      )

      if (bindResult.success) {
        migrated++
      } else if (bindResult.conflicts && bindResult.conflicts.length > 0) {
        conflicts += bindResult.conflicts.length
      } else {
        errors.push(`project ${projectId}: ${bindResult.error ?? "unknown bind error"}`)
      }
    } catch (e) {
      errors.push(`project ${projectId}: ${String(e)}`)
    }
  }

  // Marked complete even when individual entries failed: a retry loop on
  // every launch would re-log the same errors forever. Failed entries fall
  // back to the per-project repair screen like broken paths do.
  await run(
    Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
      c.setSetting(MIGRATION_SETTING_KEY, String(Date.now())),
    ),
  )

  console.log(
    `[WorkspaceCatalog] Legacy migration: ${migrated} migrated, ${broken} broken, ${conflicts} conflicts, ${errors.length} errors`,
  )

  return { skipped: false, migrated, broken, conflicts, errors }
}
