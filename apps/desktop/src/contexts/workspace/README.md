# Ambient workspace scope

Which local workspace a surface is bound to, and the one resolution that
answers it.

`useWorkspaceIdentity` is the canonical precedence — the ready resolution
first, then the project route, then the sync context — and `ActiveWorkspaceContext`
is the provider it reads. `features/workspace` still owns the real work:
resolving, binding, repairing, and hosting a workspace runtime. What lives here
is only the answer to "which workspace is this", which the workbench header, the
project sidebar and the workbench surface all need.

While the identity hook sat inside `features/workspace`, the workbench had to
import a capability it composes just to name its own workspace, which closed a
cycle. The runtime store moved to `lib/workspaceRuntimeStore` at the same time
and for the same reason; it is state, not a context, so it sits beside the
workbench store.

Nothing here may import from `features/`.

See `tests/architecture/featureDependencyGraph.test.ts` for the cycles and
`tests/architecture/neutralGround.test.ts` for the invariant.
