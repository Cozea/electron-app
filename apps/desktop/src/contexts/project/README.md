# Ambient project scope

Route params, sync state, project access, and the path/navigation helpers that
answer "which project am I in" for the whole renderer.

This is not the projects feature. `features/projects` owns project identity,
lifecycle, creation and the project sidebar. What lives here is the ambient
answer every other capability needs — workbench, workspace, source-control,
settings and tasks all read it, and while it sat inside `features/projects`
each of them had to import a sibling feature to get it. That single misplacement
accounted for three of the graph's mutual dependencies.

`contexts/` rather than `lib/` because the cluster is context-shaped and because
`YjsProjectContext` already sits one directory up: the codebase had answered
this question once. The route and navigation helpers live here too, beside the
context they serve, rather than being split across two top-level directories.

Nothing here may import from `features/`. That is the whole point, and it is
measured rather than asserted: `ProjectSyncProviderRuntime` still reaches for
the collab session and checkpoint cleanup, because it composes the capabilities
the context exposes rather than being ambient itself, and belongs in app
composition. Both imports are pinned so the exception stays visible.

See `tests/architecture/featureDependencyGraph.test.ts` for the cycles and
`tests/architecture/neutralGround.test.ts` for the pins.
