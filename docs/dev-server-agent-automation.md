# Agent-controlled Dev Server preview

> **T3 surface cutover (2026-08-31):** Dev Server and compatibility Project DevApp previews now
> render through the shared T3 `<webview>` host while their process, terminal, readiness, and
> headless reattachment lifecycles remain independent. Agent page interaction remains temporarily
> unavailable until the all-surface automation gate.

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

| Tool                | Process effect                                      | Surface effect                                         |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `dev_server_status` | Read only                                           | Reports the thread-bound surface, if any               |
| `dev_server_ensure` | Idempotently starts, joins, or reuses the singleton | Reuses an unleased surface or creates a background one |
| `dev_server_attach` | Never starts or restarts                            | Reuses or creates a surface for an existing runtime    |

`open: true` may reveal a reused surface. A newly created agent surface always remains an inactive background tab until the user selects it. `dev_server_ensure` always reuses an unleased surface when safe; only `dev_server_attach` honors `reuseExistingSurface: false` to request another view, never another process.

Until the all-surface automation gate, `preview_open` remains unavailable. Callers use
`dev_server_ensure` for process management and may use `dev_server_attach` to retain or create the
corresponding live tile.

When these tools are present, every supported provider routes ordinary requests such as “start the dev server” through `dev_server_ensure` before any shell inspection or terminal launch. This keeps natural-language starts inside the same singleton and discovery path as the Play button. Codex receives the policy as developer instructions, Claude as an append to its system preset, and OpenCode as its per-turn system prompt. The pinned Cursor ACP v0.11.3 schema has no system/developer field, so Cursor receives the same policy in a delimited first prompt block. The policy is omitted when the T3 MCP session is absent; terminal startup remains a fallback only when the Dev Server tools are absent or explicitly report that the operation is unsupported.

Normal `dev_server_ensure` calls omit `command`. Cozea extracts a bounded candidate set from project manifests, its capability catalog, safe README launch lines, and static-site evidence, then ranks those candidates through its tiny macOS Core ML helper. The model scores candidates only; it cannot generate or execute arbitrary shell text. If the helper or model is unavailable, the same feature contract has a deterministic fallback. A command is cached only after readiness succeeds, keyed by the project-evidence fingerprint.

The agent may pass a custom `command` only when the user explicitly supplied or confirmed it. Custom commands should use the brokered `{port}` placeholder, for example `python3 -m http.server {port}`, so a port collision does not create a command/runtime mismatch. If the agent already launched a server itself, it should use `dev_server_attach` and navigate to that known port rather than call ensure and create a duplicate.

The native Swift helper and generated Core ML model live under `native/local-automation-helper`. Development startup builds a debug helper without interrupting an existing app session. Distribution preparation builds an arm64 release helper and copies it with the model into Electron resources. The helper is a long-lived JSON-lines subprocess; a timeout, crash, unsupported platform, or absent model degrades to deterministic ranking rather than blocking Play.

## Temporarily available operations

The host keeps the protocol shape stable but only these operations are functional:

- `devServerStatus`, `devServerEnsure`, `devServerAttach`

`status` reports the live surface as automation-unavailable. `open`, `navigate`, `snapshot`, `click`,
`type`, `press`, `scroll`, and `waitFor` return `PreviewAutomationUnavailableError` without issuing
guest commands or polling.
Resize, color-scheme emulation, arbitrary evaluate, and recording remain unadvertised. There is no
separate flag-gated Browser automation adapter.

## Runtime bridge

The renderer registers one effective T3 `PreviewAutomationHost` candidate even when several
assistant hooks are mounted. It maps T3 environment and thread identifiers to the open Cozea
workspace, assistant tile, and leased Dev Server shell. Lifecycle ensure/status crosses the
dedicated Dev Server IPC into `DevServerService`; rendering uses the separate shared T3 surface
bridge.

The renderer host may reconnect without changing the process or surface identities. A direct user takeover produces a control-interrupted response so the agent can attach another view deliberately.

Managed process probes use `127.0.0.1` and remain authoritative for readiness. Persisted preview URL
overrides are retained as tile data and navigate the same living guest. Guest page failures remain
separate from process health and do not stop or replace the managed runtime.

Main-process lifecycle transitions are pushed to every mounted renderer through `devServer:state`. The run store folds those events immediately, including readiness that arrives while a start promise is still pending and stop/exit transitions initiated from another surface. Renderer reloads also reconcile from `DevServerService` without replacing the process.

Development windows and their native preview child views disable Electron background throttling so macOS Computer Use can keep the real surfaces paintable while the automation host owns foreground focus. Packaged builds retain Electron's default background power behavior.

## HTTP error parity

Process readiness remains separate from page health. The shared T3 guest reports transport errors;
Cozea's response diagnostics show only final blank 4xx/5xx documents and leave framework-rendered
error pages and successful blank documents visible.

## QA matrix

Verify all of the following before release:

1. Two concurrent `dev_server_ensure` calls produce one process and one run ID.
2. An ensure during launch joins that launch; an ensure after readiness returns immediately.
3. A pre-existing unleased Dev Server surface is reused without activation or reparenting.
4. A competing assistant receives another inactive surface tied to the same process.
5. Pointer or keyboard input interrupts the active lease.
6. Closing the owning surface leaves the process running and exposes the sidebar `Running` row.
7. Selecting the row reattaches a surface without a second process.
8. Browser, Dev Server, Project DevApp, and Org DevApp tiles render through the shared T3 host.
9. Every preview interaction fails immediately with `PreviewAutomationUnavailableError`.
10. No legacy browser IPC, native overlay guest, bounds synchronization, or screenshot substitution occurs.
11. Reloading the renderer around a ready process preserves the run ID, terminal, Stop control, and
    persisted preview URL override.
12. Codex, Claude, OpenCode, and Cursor all receive the managed Dev Server routing policy when—and
    only when—the T3 MCP session is attached.
13. Electron validation uses Computer Use against the real app; do not use Playwright for this flow.
