// @ts-nocheck
import * as SqlClient from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

/**
 * Enforce the single-active invariants that the code previously only assumed:
 * at most one active workspace per project and one active lane per workspace.
 * Existing duplicates (from pre-transaction races) are deactivated keeping the
 * most recently updated row, so the indexes can be created on dirty catalogs.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    update local_workspaces set is_active = 0
    where is_active = 1
      and rowid not in (
        select rowid from (
          select rowid, row_number() over (
            partition by project_id order by updated_at desc, rowid desc
          ) as rn
          from local_workspaces where is_active = 1
        ) where rn = 1
      )
  `

  yield* sql`
    update workspace_lanes set is_active = 0
    where is_active = 1
      and rowid not in (
        select rowid from (
          select rowid, row_number() over (
            partition by workspace_id order by updated_at desc, rowid desc
          ) as rn
          from workspace_lanes where is_active = 1
        ) where rn = 1
      )
  `

  yield* sql`
    create unique index if not exists local_workspaces_active_unique_idx
      on local_workspaces(project_id) where is_active = 1
  `

  yield* sql`
    create unique index if not exists workspace_lanes_active_unique_idx
      on workspace_lanes(workspace_id) where is_active = 1
  `

  yield* sql`
    create index if not exists workspace_events_created_idx
      on workspace_events(created_at)
  `
})
