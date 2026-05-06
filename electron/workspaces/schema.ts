export const CREATE_LOCAL_PROJECTS_CACHE = `
create table if not exists local_projects_cache (
  project_id   text    primary key,
  slug         text,
  name         text,
  repo_provider text,
  repo_full_name text,
  repo_url     text,
  default_branch text,
  shared_branch text,
  updated_at   integer not null
);
`

export const CREATE_LOCAL_ROOTS = `
create table if not exists local_roots (
  root_id        text    primary key,
  path           text    not null,
  real_path      text    not null,
  kind           text    not null,
  label          text,
  created_at     integer not null,
  updated_at     integer not null,
  last_scanned_at integer
);
create unique index if not exists local_roots_real_path_idx
  on local_roots(real_path);
`

export const CREATE_LOCAL_WORKSPACES = `
create table if not exists local_workspaces (
  workspace_id                 text    primary key,
  project_id                   text    not null,
  root_id                      text,
  label                        text,
  root_path                    text    not null,
  real_path                    text    not null,
  project_root_relative_path   text    not null default '.',
  project_root_path            text    not null,
  git_root_path                text,
  git_dir_path                 text,
  git_head_branch              text,
  git_origin_url               text,
  git_repo_identity_json       text,
  filesystem_device            text,
  filesystem_inode             text,
  filesystem_birthtime_ms      integer,
  filesystem_mtime_ms          integer,
  filesystem_volume_id         text,
  marker_workspace_id          text,
  marker_project_id            text,
  marker_path                  text,
  verification_status          text    not null,
  verification_reason          text,
  verified_at                  integer,
  source                       text    not null,
  is_active                    integer not null default 0,
  workspace_revision           integer not null default 1,
  created_at                   integer not null,
  updated_at                   integer not null,
  last_opened_at               integer
);
create index if not exists local_workspaces_project_idx
  on local_workspaces(project_id);
create index if not exists local_workspaces_real_path_idx
  on local_workspaces(real_path);
create unique index if not exists local_workspaces_unique_project_root_idx
  on local_workspaces(real_path, project_root_relative_path);
`

export const CREATE_WORKSPACE_LANES = `
create table if not exists workspace_lanes (
  lane_id                      text    primary key,
  workspace_id                 text    not null,
  project_id                   text    not null,
  kind                         text    not null,
  branch                       text,
  shared_branch                text,
  worktree_path                text,
  worktree_real_path           text,
  project_root_relative_path   text    not null default '.',
  project_root_path            text    not null,
  git_root_path                text,
  git_dir_path                 text,
  is_active                    integer not null default 0,
  created_at                   integer not null,
  updated_at                   integer not null,
  last_opened_at               integer
);
create index if not exists workspace_lanes_workspace_idx
  on workspace_lanes(workspace_id);
create index if not exists workspace_lanes_project_idx
  on workspace_lanes(project_id);
`

export const CREATE_WORKSPACE_CONFLICTS = `
create table if not exists workspace_conflicts (
  conflict_id          text    primary key,
  project_id           text,
  workspace_id         text,
  candidate_path       text    not null,
  candidate_real_path  text,
  existing_workspace_id text,
  existing_project_id  text,
  reason               text    not null,
  details_json         text,
  status               text    not null,
  created_at           integer not null,
  resolved_at          integer
);
`

export const CREATE_WORKSPACE_EVENTS = `
create table if not exists workspace_events (
  event_id     text    primary key,
  workspace_id text,
  project_id   text,
  event_type   text    not null,
  details_json text,
  created_at   integer not null
);
`

export const CREATE_WORKSPACE_SETTINGS = `
create table if not exists workspace_settings (
  key        text    primary key,
  value      text    not null,
  updated_at integer not null
);
`
