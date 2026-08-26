import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface T3OrchestrationUserdataMigrationOptions {
  readonly legacySqlitePath: string;
  readonly t3BaseDir: string;
  readonly dryRun?: boolean;
}

export interface T3OrchestrationUserdataMigrationResult {
  readonly migrated: boolean;
  readonly reason: string;
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
 * Event-level projection replay remains a follow-up once parity tests land.
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
  return { migrated: true, reason: "copied_legacy_sqlite_bundle" };
}
