# Workspace Runtime QA

Updated: 2026-04-17

This is the manual scenario matrix for the retained multi-workspace runtime model.

## Core paths

### 1. Relink without mutating the live workspace

1. Open project A on root X.
2. Start a terminal and open a browser tab.
3. Use `Relink Local Folder` from the workbench header or project sidebar.
4. Pick root Y for the same project.
5. Confirm the route moves to Y.
6. Confirm the X workspace is still listed internally as a separate background runtime and was not rebound in place.
7. Confirm Y inherited the prior layout only if Y had no path-scoped layout yet.

Expected:

- no terminal/browser ownership bleed from X into Y
- no rejected cross-root rebinding errors after the route switch
- Y starts as its own `workspaceId`

### 2. Explicit close stops only the chosen workspace

1. Open project A on root X.
2. Start a terminal or dev server.
3. Use `Close Workspace`.
4. Accept the confirmation.
5. Confirm the route stays on the project shell but no local root is attached.
6. Confirm terminal/dev-server bindings for X are gone.
7. Confirm the project does not immediately auto-reattach to X on route refresh.

Expected:

- the closed root is suppressed until an explicit reopen or relink
- `workbenchSession.closeSession` is called for sessions owned by X
- runtime lifecycle becomes `closed`

### 3. Background-hot retention

1. Open project A on root X.
2. Start a long-running terminal command.
3. Switch to project B or another root.
4. Wait 30-60 seconds.
5. Return to project A on X.

Expected:

- the terminal is still alive
- the workspace remained `background-hot`
- no process was killed during the route switch

### 4. Background-frozen sync trimming

1. Open project A on root X.
2. Leave it with no running terminals, dev server, native preview, or active sync.
3. Switch away for more than 10 minutes.
4. Inspect lifecycle/debug output.
5. Return to X.

Expected:

- lifecycle transitions to `background-frozen`
- frozen runtimes are omitted from hosted sync providers and Yjs interest roots
- returning to X remounts the runtime cleanly

### 5. Same-project multi-root isolation

1. Open project A on root X.
2. Open project A on root Y.
3. Put different browser tabs and layouts in each.
4. Switch back and forth.

Expected:

- layouts remain path-scoped
- browser storage/workbench state remain path-scoped
- terminals and previews bind to the correct root every time

## Logging checks

Watch for:

- lifecycle transition logs from `WorkbenchSessionManager`
- ownership mismatch warnings for stale or cross-root terminal/browser bindings
- no repeated rebinding between unrelated roots

## Release gate

Do not mark the retained-workspace model complete unless all scenarios above pass on a real dev build with at least two distinct local roots.
