# Workspace feature

Owns renderer-side workspace identity, catalog snapshots, project-to-workspace resolution, repair UI, and runtime-host state.

Projects reference workspaces; they do not own workspace mechanics. New imports should use `@/features/workspace/...`.
