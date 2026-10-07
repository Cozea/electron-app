import * as SqlClient from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

/** Add local authority without rekeying workspaces, lanes or disk markers. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE local_projects (
      project_id TEXT PRIMARY KEY,
      local_name TEXT,
      fallback_name TEXT NOT NULL,
      slug TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'removed')),
      cloud_project_id TEXT UNIQUE,
      shared_name TEXT,
      shared_status TEXT,
      shared_identity_key TEXT,
      shared_observed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `
  yield* sql`
    CREATE TABLE project_operations (
      operation_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES local_projects(project_id),
      kind TEXT NOT NULL CHECK (kind IN ('create', 'attach', 'repair', 'remove', 'share', 'delete_shared', 'github_repo')),
      state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'unknown', 'failed', 'completed', 'cancelled')),
      stage TEXT NOT NULL DEFAULT 'requested' CHECK (stage IN ('requested', 'prepared', 'effect_applied', 'binding_committed', 'completed')),
      details_json TEXT NOT NULL,
      request_details_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `
  yield* sql`CREATE INDEX project_operations_project_idx ON project_operations(project_id)`
  yield* sql`CREATE INDEX project_operations_state_idx ON project_operations(state, updated_at)`

  // These historical workspace/cache IDs were allocated by cloud project
  // creation. Preserve them as local keys and unvalidated cloud associations.
  // No identity, membership or path ownership is inferred from this projection.
  yield* sql`
    INSERT INTO local_projects (
      project_id, fallback_name, slug, status, cloud_project_id,
      shared_name, created_at, updated_at
    )
    SELECT ids.project_id,
      COALESCE(NULLIF(TRIM(cache.name), ''),
        (SELECT NULLIF(TRIM(w.label), '') FROM local_workspaces w
          WHERE w.project_id = ids.project_id ORDER BY w.is_active DESC, w.created_at LIMIT 1),
        'Local project'),
      COALESCE(NULLIF(cache.slug, ''), 'project'), 'active',
      CASE WHEN SUBSTR(ids.project_id, 1, 4) = 'lpj_' THEN NULL ELSE ids.project_id END,
      NULLIF(TRIM(cache.name), ''),
      COALESCE((SELECT MIN(w.created_at) FROM local_workspaces w WHERE w.project_id = ids.project_id), cache.updated_at),
      COALESCE((SELECT MAX(w.updated_at) FROM local_workspaces w WHERE w.project_id = ids.project_id), cache.updated_at)
    FROM (
      SELECT project_id FROM local_workspaces
      UNION SELECT project_id FROM local_projects_cache
    ) ids
    LEFT JOIN local_projects_cache cache ON cache.project_id = ids.project_id
  `
})
