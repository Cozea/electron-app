import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resetOrchestrationProjectionsForEventReplay,
} from "./t3-orchestration-projection-replay.ts";

export interface T3OrchestrationUserdataMigrationOptions {
  readonly legacySqlitePath: string;
  readonly t3BaseDir: string;
  readonly dryRun?: boolean;
}

export interface T3OrchestrationUserdataMigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
  readonly eventCount?: number;
  readonly projectionTablesReset?: ReadonlyArray<string>;
}

const SQLITE_SIDEcars = ["-wal", "-shm"] as const;

function copySqliteBundle(sourcePath: string, targetPath: string): void {
  fs.copyFileSync(sourcePath, targetPath);
  for (const suffix of SQLITE_SIDEcars) {
    const sidecar = `${sourcePath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.copyFileSync(sidecar, `${targetPath}${suffix}`);
    }
  }
}

/**
 * Resolve legacy Cozea/T3 assistant SQLite path (`{baseDir}/userdata/state.sqlite`).
 * Matches `electron/assistant-runtime/os-jank.ts` default base `~/.t3`.
 */
export function resolveLegacyAssistantSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  const rawHome = env.COZEA_ASSISTANT_HOME?.trim();
  const baseDir =
    rawHome && rawHome.length > 0 ? path.resolve(rawHome.replace(/^~(?=$|\/)/, os.homedir())) : path.join(os.homedir(), ".t3");
  return path.join(baseDir, "userdata", "state.sqlite");
}

/**
 * Migrate Cozea legacy assistant SQLite userdata into T3 persistence.
 *
 * Phase T6 copies the legacy `state.sqlite` bundle when T3 has no database yet.
 * Phase T6c clears projection tables/cursors so T3 replays `orchestration_events`
 * on first boot after the copy.
 */
export async function migrateCozeaAssistantUserdataToT3(
  options: T3OrchestrationUserdataMigrationOptions,
): Promise<T3OrchestrationUserdataMigrationResult> {
  const legacyExists = fs.existsSync(options.legacySqlitePath);
  const t3UserdataDir = path.join(options.t3BaseDir, "userdata");
  const t3SqlitePath = path.join(t3UserdataDir, "state.sqlite");
  const t3Exists = fs.existsSync(t3SqlitePath);

  if (!legacyExists) {
    return { migrated: false, reason: "legacy_sqlite_missing" };
  }
  if (t3Exists) {
    return { migrated: false, reason: "t3_sqlite_already_present" };
  }
  if (options.dryRun) {
    return { migrated: false, reason: "dry_run" };
  }

  fs.mkdirSync(t3UserdataDir, { recursive: true });
  copySqliteBundle(options.legacySqlitePath, t3SqlitePath);
  const replay = resetOrchestrationProjectionsForEventReplay(t3SqlitePath);
  return {
    migrated: true,
    reason:
      replay.eventCount > 0
        ? "copied_legacy_sqlite_and_reset_projections"
        : "copied_legacy_sqlite_bundle",
    eventCount: replay.eventCount,
    projectionTablesReset: replay.resetTables,
  };
}
