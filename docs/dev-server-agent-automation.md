# Agent-controlled Dev Server preview

Cozea exposes project previews to the vendored T3 agent runtime through the workbench's built-in Dev Server runtime and surface. It never treats an ordinary Browser tile as spare agent infrastructure.

## Product contract

- One process exists at most per `(workspaceId, laneId)`.
- A process can have zero, one, or several Dev Server surfaces.
- `ensure` reuses a ready process, waits for a process already launching, and coalesces concurrent ensure requests. Manual Restart remains the explicit replace-process action.
- Closing a built-in Dev Server surface detaches its terminal presentation but does not stop the owning process. The process terminal is reaped when the runtime is explicitly stopped or disposed.
- A running process with no built-in surface appears as `Dev Server — Running` in the project's existing sidebar surface list. Selecting it reattaches the singleton surface.
- Browser, Org DevApp, Project DevApp, and Mobile Simulator tiles are outside this automation path.

## Surface placement and ownership

When an assistant needs a preview, Cozea first reuses an unleased built-in Dev Server surface in place. It never moves an existing surface between grid groups.

If no reusable surface exists, Cozea adds an inactive Dev Server tab `within` the requesting assistant's Dockview group and immediately restores the previously active tab. The assistant keeps generating while the background preview mounts. The user may select the tab or drag it into another cell at any time.

Automation control is an expiring lease scoped to the assistant thread. Calls renew the lease. Pointer or keyboard interaction inside the Dev Server tile interrupts the lease and starts a short user-priority cooldown. During that interval another agent request attaches another surface to the same process instead of taking the user's surface or launching a second server.

## T3 lifecycle tools

The vendored T3 preview toolkit adds three Dev Server-specific operations:

| Tool | Process effect | Surface effect |
| --- | --- | --- |
| `dev_server_status` | Read only | Reports the thread-bound surface, if any |
| `dev_server_ensure` | Idempotently starts, joins, or reuses the singleton | Reuses an unleased surface or creates a background one |
| `dev_server_attach` | Never starts or restarts | Reuses or creates a surface for an existing runtime |

`open: true` may reveal a reused surface. A newly created agent surface always remains an inactive background tab until the user selects it. `dev_server_ensure` always reuses an unleased surface when safe; only `dev_server_attach` honors `reuseExistingSurface: false` to request another view, never another process.

`preview_open` only attaches a Dev Server surface. It does not start or restart the server; callers use `dev_server_ensure` first when a process is required.

When these tools are present, the Codex provider instructions route ordinary requests such as “start the dev server” through `dev_server_ensure` before any shell inspection or terminal launch. This keeps natural-language starts inside the same singleton and discovery path as the Play button. Terminal startup remains a fallback only when the Dev Server tools are absent or explicitly report that the operation is unsupported.

Normal `dev_server_ensure` calls omit `command`. Cozea extracts a bounded candidate set from project manifests, its capability catalog, safe README launch lines, and static-site evidence, then ranks those candidates through its tiny macOS Core ML helper. The model scores candidates only; it cannot generate or execute arbitrary shell text. If the helper or model is unavailable, the same feature contract has a deterministic fallback. A command is cached only after readiness succeeds, keyed by the project-evidence fingerprint.

The agent may pass a custom `command` only when the user explicitly supplied or confirmed it. Custom commands should use the brokered `{port}` placeholder, for example `python3 -m http.server {port}`, so a port collision does not create a command/runtime mismatch. If the agent already launched a server itself, it should use `dev_server_attach` and navigate to that known port rather than call ensure and create a duplicate.

The native Swift helper and generated Core ML model live under `native/local-automation-helper`. Development startup builds a debug helper without interrupting an existing app session. Distribution preparation builds an arm64 release helper and copies it with the model into Electron resources. The helper is a long-lived JSON-lines subprocess; a timeout, crash, unsupported platform, or absent model degrades to deterministic ranking rather than blocking Play.

## Supported preview operations

The Cozea host advertises this bounded set:

- `status`, `open`, `navigate`
- `snapshot`
- `click`, `type`, `press`, `scroll`, `waitFor`
- `devServerStatus`, `devServerEnsure`, `devServerAttach`

Snapshots include URL, title, loading state, visible text, an accessibility-oriented interactive-element list with bounds, a PNG screenshot, and the host's bounded action timeline. Locator support is intentionally narrow: CSS selectors plus `text=...` and `role=...[name=...]` forms. Interaction scripts are host-generated; arbitrary page JavaScript is not accepted.

Resize, color-scheme emulation, arbitrary evaluate, and recording are not advertised. The normal flag-gated Browser automation adapter remains a separate legacy surface.

## Runtime bridge

The renderer registers one effective T3 `PreviewAutomationHost` candidate even when several assistant hooks are mounted. It maps T3 environment and thread identifiers to the open Cozea workspace, assistant tile, and leased Dev Server surface. Requests then cross dedicated preload IPC into `WorkbenchBrowserService`; lifecycle ensure/status crosses the dedicated Dev Server IPC into `DevServerService`.

The renderer host may reconnect without changing the process or surface identities. A direct user takeover produces a control-interrupted response so the agent can attach another view deliberately.

Managed preview URLs use `127.0.0.1`, matching the main-process readiness probe. Persisted `localhost` and IPv6-loopback addresses on the same port are treated as the canonical server URL rather than as user navigation overrides. Native preview views are hidden after attachment and again during renderer re-acquisition; measured tile bounds are required before a view may become visible, which prevents a stale pre-reload view from covering the workbench. Re-acquisition also compares the requested preview URL with the native view's authoritative URL, so a renderer that mounts around an already-ready process still navigates instead of leaving a blank browser behind a populated toolbar.

Main-process lifecycle transitions are pushed to every mounted renderer through `devServer:state`. The run store folds those events immediately, including readiness that arrives while a start promise is still pending and stop/exit transitions initiated from another surface. Renderer reloads also reconcile from `DevServerService` without replacing the process.

Development windows and their native preview child views disable Electron background throttling so macOS Computer Use can keep the real surfaces paintable while the automation host owns foreground focus. Packaged builds retain Electron's default background power behavior.

## QA matrix

Verify all of the following before release:

1. Two concurrent `dev_server_ensure` calls produce one process and one run ID.
2. An ensure during launch joins that launch; an ensure after readiness returns immediately.
3. A pre-existing unleased Dev Server surface is reused without activation or reparenting.
4. A competing assistant receives another inactive surface tied to the same process.
5. Pointer or keyboard input interrupts the active lease.
6. Closing the owning surface leaves the process running and exposes the sidebar `Running` row.
7. Selecting the row reattaches a surface without a second process.
8. Browser and DevApp tiles remain unchanged.
9. Snapshot and fixed interaction operations work after reconnect.
10. Electron validation uses Computer Use against the real app; do not use Playwright for this flow.
11. Reloading the renderer around a ready process preserves the run ID, Stop control, canonical URL, and loaded native preview.
