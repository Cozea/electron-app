// @ts-nocheck
import * as SqlClient from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"

/**
 * Make filesystem ownership explicit. Existing rows are classified
 * conservatively: only Cozea-created/cloned roots and rows with a historical
 * copy event may be managed, and even those are downgraded when no containing
 * managed root can be proven.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    alter table local_workspaces
      add column storage_ownership text not null default 'attached'
  `

  yield* sql`
    alter table local_workspaces
      add column managed_root_id text
  `

  yield* sql`
    alter table local_workspaces
      add column marker_policy text not null default 'none'
  `

  yield* sql`
    update local_workspaces as workspace
    set storage_ownership = case
      when source in ('create', 'clone') then 'managed'
      when exists (
        select 1 from workspace_events as event
        where event.workspace_id = workspace.workspace_id
          and event.event_type = 'workspace.imported.copy'
      ) then 'managed'
      else 'attached'
    end
  `

  yield* sql`
    update local_workspaces as workspace
    set managed_root_id = (
      select root.root_id
      from local_roots as root
      where workspace.real_path = root.real_path
         or instr(workspace.real_path, root.real_path || '/') = 1
      order by length(root.real_path) desc
      limit 1
    )
    where storage_ownership = 'managed'
  `

  yield* sql`
    update local_workspaces
    set storage_ownership = 'attached', managed_root_id = null
    where storage_ownership = 'managed' and managed_root_id is null
  `

  yield* sql`
    update local_workspaces
    set marker_policy = case
      when storage_ownership = 'managed' then 'required'
      when git_root_path is not null then 'git_private'
      else 'none'
    end
  `

  yield* sql`
    create index if not exists local_workspaces_managed_root_idx
      on local_workspaces(managed_root_id)
  `
})
