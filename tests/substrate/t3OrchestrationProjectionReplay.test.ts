import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  mapSqliteRowToOrchestrationEvent,
  readOrchestrationEventsFromSqlite,
  resetOrchestrationProjectionsForEventReplay,
} from "../../electron/substrate/migrations/t3-orchestration-projection-replay";
import { migrateCozeaAssistantUserdataToT3 } from "../../electron/substrate/migrations/t3-orchestration-userdata";

function createLegacyDatabase(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE orchestration_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_kind TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        stream_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        command_id TEXT,
        causation_event_id TEXT,
        correlation_id TEXT,
        actor_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
      CREATE TABLE projection_threads (
        thread_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        archived_at TEXT,
        runtime_mode TEXT NOT NULL,
        interaction_mode TEXT NOT NULL,
        latest_turn_state TEXT,
        latest_session_status TEXT,
        latest_activity_at TEXT,
        pinned INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE projection_state (
        projector TEXT PRIMARY KEY,
        last_applied_sequence INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type, occurred_at,
        command_id, causation_event_id, correlation_id, actor_kind, payload_json, metadata_json
      ) VALUES (
        'evt-1', 'project', 'proj-1', 1, 'project.created', '2026-01-01T00:00:00.000Z',
        'cmd-1', NULL, 'cmd-1', 'client',
        '{"projectId":"proj-1","name":"Demo"}',
        '{}'
      );
      INSERT INTO projection_threads (
        thread_id, project_id, title, created_at, updated_at, runtime_mode, interaction_mode
      ) VALUES (
        'thread-1', 'proj-1', 'Stale projection', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z',
        'local', 'default'
      );
      INSERT INTO projection_state (projector, last_applied_sequence, updated_at)
      VALUES ('projection.threads', 1, '2026-01-01T00:00:00.000Z');
    `);
  } finally {
    db.close();
  }
}

describe("T3 orchestration projection replay (T6c)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resetOrchestrationProjectionsForEventReplay clears projections but keeps events", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t6c-replay-"));
    tempDirs.push(root);
    const dbPath = path.join(root, "state.sqlite");
    createLegacyDatabase(dbPath);

    const result = resetOrchestrationProjectionsForEventReplay(dbPath);
    expect(result.eventCount).toBe(1);
    expect(result.resetTables).toContain("projection_threads");
    expect(result.resetTables).toContain("projection_state");

    const db = new DatabaseSync(dbPath, { readonly: true });
    try {
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get() as { count: number })
          .count,
      ).toBe(1);
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM projection_threads").get() as { count: number })
          .count,
      ).toBe(0);
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM projection_state").get() as { count: number })
          .count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });

  it("readOrchestrationEventsFromSqlite maps persisted rows to domain events", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t6c-read-"));
    tempDirs.push(root);
    const dbPath = path.join(root, "state.sqlite");
    createLegacyDatabase(dbPath);

    const rows = readOrchestrationEventsFromSqlite(dbPath, 0);
    expect(rows).toHaveLength(1);
    const event = mapSqliteRowToOrchestrationEvent(rows[0]!);
    expect(event.sequence).toBe(1);
    expect(event.type).toBe("project.created");
    expect(event.aggregateKind).toBe("project");
    expect(event.aggregateId).toBe("proj-1");
    expect(event.payload).toEqual({ projectId: "proj-1", name: "Demo" });
  });

  it("migrateCozeaAssistantUserdataToT3 resets projections after sqlite copy", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t6c-migrate-"));
    tempDirs.push(root);
    const legacySqlite = path.join(root, "legacy", "state.sqlite");
    const t3BaseDir = path.join(root, "t3");
    createLegacyDatabase(legacySqlite);

    const result = await migrateCozeaAssistantUserdataToT3({
      legacySqlitePath: legacySqlite,
      t3BaseDir,
    });

    expect(result).toMatchObject({
      migrated: true,
      reason: "copied_legacy_sqlite_and_reset_projections",
      eventCount: 1,
    });
    expect(result.projectionTablesReset).toContain("projection_state");

    const t3Sqlite = path.join(t3BaseDir, "userdata", "state.sqlite");
    const db = new DatabaseSync(t3Sqlite, { readonly: true });
    try {
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM projection_threads").get() as { count: number })
          .count,
      ).toBe(0);
    } finally {
      db.close();
    }
  });
});
