import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  migrateCozeaAssistantUserdataToT3,
  resolveLegacyAssistantSqlitePath,
} from "../../electron/substrate/migrations/t3-orchestration-userdata";

describe("T3 orchestration userdata migration", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveLegacyAssistantSqlitePath honors COZEA_ASSISTANT_HOME", () => {
    const home = path.join(os.tmpdir(), "cozea-legacy-home-test");
    expect(
      resolveLegacyAssistantSqlitePath({ COZEA_ASSISTANT_HOME: home } as NodeJS.ProcessEnv),
    ).toBe(path.join(home, "userdata", "state.sqlite"));
  });

  it("copies legacy sqlite bundle when T3 database is absent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t3-migrate-"));
    tempDirs.push(root);
    const legacyDir = path.join(root, "legacy", "userdata");
    const t3BaseDir = path.join(root, "t3");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacySqlite = path.join(legacyDir, "state.sqlite");
    const legacyDb = new DatabaseSync(legacySqlite);
    legacyDb.exec("CREATE TABLE migration_probe (value TEXT NOT NULL)");
    legacyDb.prepare("INSERT INTO migration_probe (value) VALUES (?)").run("legacy-db");
    legacyDb.close();

    const result = await migrateCozeaAssistantUserdataToT3({
      legacySqlitePath: legacySqlite,
      t3BaseDir,
    });

    expect(result).toEqual({
      migrated: true,
      reason: "copied_legacy_sqlite_bundle",
      eventCount: 0,
      projectionTablesReset: [],
    });
    const t3Sqlite = path.join(t3BaseDir, "userdata", "state.sqlite");
    const t3Db = new DatabaseSync(t3Sqlite, { readonly: true });
    const row = t3Db.prepare("SELECT value FROM migration_probe").get() as { value: string };
    t3Db.close();
    expect(row.value).toBe("legacy-db");
  });

  it("skips when T3 sqlite already exists", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t3-migrate-skip-"));
    tempDirs.push(root);
    const legacySqlite = path.join(root, "legacy.sqlite");
    fs.writeFileSync(legacySqlite, "legacy-db");
    const t3BaseDir = path.join(root, "t3");
    fs.mkdirSync(path.join(t3BaseDir, "userdata"), { recursive: true });
    fs.writeFileSync(path.join(t3BaseDir, "userdata", "state.sqlite"), "existing");

    const result = await migrateCozeaAssistantUserdataToT3({
      legacySqlitePath: legacySqlite,
      t3BaseDir,
    });

    expect(result.reason).toBe("t3_sqlite_already_present");
  });
});
