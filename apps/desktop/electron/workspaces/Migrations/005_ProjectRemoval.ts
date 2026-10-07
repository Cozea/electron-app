import * as SqlClient from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE project_exclusions (
    project_id TEXT PRIMARY KEY REFERENCES local_projects(project_id),
    operation_id TEXT NOT NULL UNIQUE REFERENCES project_operations(operation_id),
    state TEXT NOT NULL CHECK(state IN ('removing', 'removed')), scope_json TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`
  yield* sql`CREATE TABLE project_operation_effects (
    operation_id TEXT NOT NULL REFERENCES project_operations(operation_id), effect_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('requested', 'applied', 'unknown')),
    evidence_json TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(operation_id, effect_id)
  )`
  // Even historical compatibility callers cannot recreate a removed identity.
  yield* sql`CREATE TRIGGER project_exclusion_workspace_insert BEFORE INSERT ON local_workspaces
    WHEN EXISTS(SELECT 1 FROM project_exclusions WHERE project_id = NEW.project_id)
    BEGIN SELECT RAISE(ABORT, 'Project removal excludes new workspace bindings'); END`
  yield* sql`CREATE TRIGGER project_exclusion_workspace_update BEFORE UPDATE ON local_workspaces
    WHEN EXISTS(SELECT 1 FROM project_exclusions WHERE project_id IN (OLD.project_id, NEW.project_id))
    BEGIN SELECT RAISE(ABORT, 'Project removal excludes workspace changes'); END`
  yield* sql`CREATE TRIGGER project_exclusion_lane_insert BEFORE INSERT ON workspace_lanes
    WHEN EXISTS(SELECT 1 FROM project_exclusions WHERE project_id = NEW.project_id)
    BEGIN SELECT RAISE(ABORT, 'Project removal excludes new lanes'); END`
  yield* sql`CREATE TRIGGER project_exclusion_lane_update BEFORE UPDATE ON workspace_lanes
    WHEN EXISTS(SELECT 1 FROM project_exclusions WHERE project_id IN (OLD.project_id, NEW.project_id))
    BEGIN SELECT RAISE(ABORT, 'Project removal excludes lane changes'); END`
  yield* sql`CREATE TABLE project_operation_archive AS SELECT * FROM project_operations WHERE 0`
  yield* sql`CREATE UNIQUE INDEX project_archive_operation_idx ON project_operation_archive(operation_id)`
  yield* sql`CREATE INDEX project_archive_project_idx ON project_operation_archive(project_id, kind)`
  yield* sql`CREATE VIEW project_operation_history AS SELECT * FROM project_operations UNION ALL SELECT * FROM project_operation_archive`
  yield* sql`CREATE TRIGGER project_operation_replay_key BEFORE INSERT ON project_operations
    WHEN EXISTS(SELECT 1 FROM project_operation_archive WHERE operation_id = NEW.operation_id)
    BEGIN SELECT RAISE(ABORT, 'Archived project operation replay key is immutable'); END`
  // Compact diagnostic noise, preserving full intent, resource evidence and replay keys.
  yield* sql`CREATE INDEX project_effects_state_idx ON project_operation_effects(state, updated_at)`
})
