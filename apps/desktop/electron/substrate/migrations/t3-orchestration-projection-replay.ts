import { DatabaseSync } from "node:sqlite";

import type { OrchestrationEvent } from "@cozea/assistant-contracts";

/** Projection tables rebuilt by T3 `ProjectionPipeline.bootstrap` on server start. */
export const ORCHESTRATION_PROJECTION_TABLES = [
  "projection_projects",
  "projection_threads",
  "projection_thread_messages",
  "projection_thread_activities",
  "projection_thread_sessions",
  "projection_turns",
  "projection_pending_approvals",
  "projection_thread_proposed_plans",
] as const;

export interface ResetOrchestrationProjectionsResult {
  readonly resetTables: ReadonlyArray<string>;
  readonly eventCount: number;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  const row = db
    .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { present: 1 } | undefined;
  return row !== undefined;
}

export function countOrchestrationEvents(dbPath: string): number {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
  } catch {
    return 0;
  }
  try {
    if (!tableExists(db, "orchestration_events")) {
      return 0;
    }
    const row = db.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get() as {
      count: number;
    };
    return row.count;
  } finally {
    db.close();
  }
}

/**
 * Clears orchestration projection tables and cursors so the vendored T3 server
 * replays `orchestration_events` on first boot after a legacy sqlite copy.
 */
export function resetOrchestrationProjectionsForEventReplay(
  dbPath: string,
): ResetOrchestrationProjectionsResult {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch {
    return { resetTables: [], eventCount: 0 };
  }
  try {
    if (!tableExists(db, "orchestration_events")) {
      return { resetTables: [], eventCount: 0 };
    }

    const eventCount = (
      db.prepare("SELECT COUNT(*) AS count FROM orchestration_events").get() as { count: number }
    ).count;
    if (eventCount === 0) {
      return { resetTables: [], eventCount: 0 };
    }

    const resetTables: string[] = [];
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const table of ORCHESTRATION_PROJECTION_TABLES) {
        if (tableExists(db, table)) {
          db.exec(`DELETE FROM ${table}`);
          resetTables.push(table);
        }
      }
      if (tableExists(db, "projection_state")) {
        db.exec("DELETE FROM projection_state");
        resetTables.push("projection_state");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return { resetTables, eventCount };
  } catch {
    return { resetTables: [], eventCount: 0 };
  } finally {
    db.close();
  }
}

export interface SqliteOrchestrationEventRow {
  readonly sequence: number;
  readonly eventId: string;
  readonly type: string;
  readonly aggregateKind: string;
  readonly streamId: string;
  readonly occurredAt: string;
  readonly commandId: string | null;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly payloadJson: string;
  readonly metadataJson: string;
}

export function mapSqliteRowToOrchestrationEvent(row: SqliteOrchestrationEventRow): OrchestrationEvent {
  return {
    sequence: row.sequence,
    eventId: row.eventId,
    type: row.type,
    aggregateKind: row.aggregateKind as OrchestrationEvent["aggregateKind"],
    aggregateId: row.streamId,
    occurredAt: row.occurredAt,
    commandId: row.commandId,
    causationEventId: row.causationEventId,
    correlationId: row.correlationId,
    payload: JSON.parse(row.payloadJson) as OrchestrationEvent["payload"],
    metadata: JSON.parse(row.metadataJson) as OrchestrationEvent["metadata"],
  } as OrchestrationEvent;
}

/** Read persisted orchestration events (ordered) for migration validation. */
export function readOrchestrationEventsFromSqlite(
  dbPath: string,
  fromSequenceExclusive = 0,
): ReadonlyArray<SqliteOrchestrationEventRow> {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readonly: true });
  } catch {
    return [];
  }
  try {
    if (!tableExists(db, "orchestration_events")) {
      return [];
    }
    return db
      .prepare(
        `SELECT
          sequence,
          event_id AS eventId,
          event_type AS type,
          aggregate_kind AS aggregateKind,
          stream_id AS streamId,
          occurred_at AS occurredAt,
          command_id AS commandId,
          causation_event_id AS causationEventId,
          correlation_id AS correlationId,
          payload_json AS payloadJson,
          metadata_json AS metadataJson
        FROM orchestration_events
        WHERE sequence > ?
        ORDER BY sequence ASC`,
      )
      .all(fromSequenceExclusive) as SqliteOrchestrationEventRow[];
  } finally {
    db.close();
  }
}
