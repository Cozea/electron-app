import fs from "node:fs";
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

/**
 * Phase T3 scaffold — migrate Cozea legacy assistant SQLite userdata into T3 persistence.
 *
 * Legacy store: `{assistantBaseDir}/userdata/state.sqlite`
 * T3 store: `{t3BaseDir}/userdata/state.sqlite`
 *
 * Full migration (projects, threads, messages, checkpoints) is deferred until
 * projection parity tests pass. This entrypoint validates paths and no-ops safely.
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
  // TODO(T3+): stream legacy orchestration events into T3 command log + projections.
  return { migrated: false, reason: "not_implemented" };
}
