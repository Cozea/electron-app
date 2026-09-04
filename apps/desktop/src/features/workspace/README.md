# Workspace feature

Owns the mechanics: catalog snapshots, project-to-workspace resolution, repair
UI, runtime hosts, and project workspace binding actions.

- `hooks/useProjectWorkspaceActions.ts`: relink and close workflows.
- root modules: resolution, runtime hosting, policy, and repair presentation.

It does not own the answer to "which workspace am I in". That is ambient — the
workbench header, the project sidebar and the workbench surface all need it —
so identity lives in `contexts/workspace` and the runtime record in
`lib/workspaceRuntimeStore`, where reading them does not mean importing this
feature.

Projects reference workspaces; they do not own workspace mechanics.
