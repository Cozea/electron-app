# Workspace feature

Owns renderer-side workspace identity, catalog snapshots, project-to-workspace resolution, repair UI, runtime-host state, and project workspace binding actions.

- `hooks/useProjectWorkspaceActions.ts`: relink and close workflows.
- root modules: identity, resolution, runtime state, and repair presentation.

Projects reference workspaces; they do not own workspace mechanics.
