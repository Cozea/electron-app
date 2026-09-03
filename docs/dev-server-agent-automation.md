# Agent-controlled Dev Server preview

> **T3 surface cutover (2026-08-31):** Dev Server and compatibility Project DevApp previews now
> render through the shared T3 `<webview>` host while their process, terminal, readiness, and
> headless reattachment lifecycles remain independent. T3 responsive sizing, capture, recording,
> picker, PiP, appearance, audio, zoom, pointer presentation, and the complete pinned automation
> operation set are active against the same living guests.

Cozea exposes project previews to the vendored T3 agent runtime through the workbench's built-in Dev Server runtime and surface. It never treats an ordinary Browser tile as spare agent infrastructure.

## Product contract

- One managed run exists at most per `(workspaceId, laneId)`. Its default process is the automatically detected frontend.
- Users may add up to six auxiliary processes (for example a backend or worker) from the Dev Server tile. The command and label are stored only on the current device and keyed by the concrete workspace; they are not cloud or collaboration state. Every configured process automatically runs from that workspace's authorized project root.
- Start, Stop, and Restart own the complete run. Auxiliary processes receive separate PTYs and are stopped and reaped with the frontend, so the run cannot leave project services orphaned.
- That coupling is one-directional. An auxiliary process that exits — a wrong command, a crash, or a stop the user issued in its own terminal — is marked stopped in the Logs selector and leaves the frontend and its preview running. Its PTY stays alive so the failure output remains readable.
- A run can have zero, one, or several Dev Server surfaces.
- `ensure` reuses a ready run, waits for a run already launching, and coalesces concurrent ensure requests. Manual Restart remains the explicit replace-run action.
- Closing a built-in Dev Server surface detaches its frontend terminal presentation but does not stop the owning run. The frontend terminal is reaped when the runtime is explicitly stopped or disposed; auxiliary terminals remain owned by the run.
- A managed run with no built-in surface appears as `Dev Server — Running` in the project's existing sidebar surface list. Selecting it reattaches the singleton surface.
- Browser, Org DevApp, and Project DevApp tiles are outside the Dev Server _process-management_
  path, but their living guests are eligible for the same page-automation operations. Mobile
  Simulator tiles remain outside browser automation.
- Development package previews have their own `devapp_preview_ensure` and
  `devapp_preview_attach` lifecycle. They never start or attach a Dev Server process.

## Surface placement and ownership

When an assistant needs a preview, Cozea first reuses an unleased built-in Dev Server surface in place. It never moves an existing surface between grid groups.

If no reusable surface exists, Cozea adds an inactive Dev Server tab `within` the requesting assistant's Dockview group and immediately restores the previously active tab. The assistant keeps generating while the background preview mounts. The user may select the tab or drag it into another cell at any time.

The automation host refreshes its workbench scope after creating that background tab, so the same
request can discover and control the newly registered guest. A retry must never be required merely
to make the new tile enter the thread's eligible-surface set.

Automation control is an expiring lease scoped to the assistant thread. Calls renew the lease. Pointer or keyboard interaction inside the Dev Server tile interrupts the lease and starts a short user-priority cooldown. During that interval another agent request attaches another surface to the same process instead of taking the user's surface or launching a second server.

## T3 lifecycle tools

The vendored T3 preview toolkit adds three Dev Server-specific operations:

| Tool                | Process effect                                      | Surface effect                                         |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| `dev_server_status` | Read only                                           | Reports the thread-bound surface, if any               |
| `dev_server_ensure` | Idempotently starts, joins, or reuses the singleton | Reuses an unleased surface or creates a background one |
| `dev_server_attach` | Never starts or restarts                            | Reuses or creates a surface for an existing runtime    |

`open: true` may reveal a reused surface. A newly created agent surface always remains an inactive background tab until the user selects it. `dev_server_ensure` always reuses an unleased surface when safe; only `dev_server_attach` honors `reuseExistingSurface: false` to request another view, never another process.

`preview_open` without an explicit runtime tab ID follows this same Dev Server workflow. Callers use
`dev_server_ensure` for idempotent process management and `dev_server_attach` to retain or create a
view without starting another process.

When these tools are present, every supported provider routes ordinary requests such as “start the dev server” through `dev_server_ensure` before any shell inspection or terminal launch. This keeps natural-language starts inside the same singleton and discovery path as the Play button. Codex receives the policy as developer instructions, Claude as an append to its system preset, and OpenCode as its per-turn system prompt. The pinned Cursor ACP v0.11.3 schema has no system/developer field, so Cursor receives the same policy in a delimited first prompt block. The policy is omitted when the T3 MCP session is absent; terminal startup remains a fallback only when the Dev Server tools are absent or explicitly report that the operation is unsupported.

Normal `dev_server_ensure` calls omit `command`. Cozea extracts a bounded candidate set from project manifests, its capability catalog, safe README launch lines, and static-site evidence, then ranks those candidates through its tiny macOS Core ML helper. The model scores candidates only; it cannot generate or execute arbitrary shell text. If the helper or model is unavailable, the same feature contract has a deterministic fallback. A command is cached only after readiness succeeds, keyed by the project-evidence fingerprint.

Project-local auxiliary processes do not participate in automatic discovery. The user adds them
explicitly in the tile's process settings, and authoring a command there is the approval for it:
the runtime catalog that gates automatically detected commands does not constrain which binary an
auxiliary process may invoke. The main process still blocks the native-platform command patterns
and supplies the already-authorized project root before the run creates its PTYs. Each auxiliary
PTY carries `BROWSER=none` in its environment and receives the command exactly as typed, so shell
syntax (`cd apps/api && uvicorn main:app`, `source .venv/bin/activate && npm run api`, inline
variable assignments, pipes) behaves as it would in a normal terminal. Because this is the only
path in the app that types into a terminal it just created, the run waits for the login shell to
draw its first prompt before sending the command; input delivered while rc files are still being
sourced is discarded by the shell. The Logs view exposes one selector per process.

Static projects participate in the same discovery path. Cozea recognizes an `index.html` at the
workspace root and the conventional built-output locations `dist/`, `build/`, `out/`, and
`public/`; it serves the matching directory on a brokered loopback port. When several plausible
commands remain, the tile presents the bounded ranked candidates with their evidence instead of
failing with an instruction to use a chooser that is not visible. Choosing one launches that exact
candidate through the normal authorized Dev Server IPC path.

The agent may pass a custom `command` only when the user explicitly supplied or confirmed it. Custom commands should use the brokered `{port}` placeholder, for example `python3 -m http.server {port}`, so a port collision does not create a command/runtime mismatch. If the agent already launched a server itself, it should use `dev_server_attach` and navigate to that known port rather than call ensure and create a duplicate.

The native Swift helper and generated Core ML model live under `native/local-automation-helper`. Development startup builds a debug helper without interrupting an existing app session. Distribution preparation builds an arm64 release helper and copies it with the model into Electron resources. The helper is a long-lived JSON-lines subprocess; a timeout, crash, unsupported platform, or absent model degrades to deterministic ranking rather than blocking Play.

## Available operations

The host advertises status, open, navigate, snapshot, click, type, press, scroll, evaluate, wait,
recording start/stop, responsive resize, color-scheme emulation, `devServerStatus`,
`devServerEnsure`, and `devServerAttach`. There is no separate Browser automation adapter.

An explicit stable runtime tab ID always wins. Without one, the thread's last controlled surface is
used, then the active browser-backed tile in the same workbench. Status includes every eligible live
surface and its kind, title, URL, active state, tab ID, and controller. Main-process navigation
policy remains authoritative for every agent request, including Org DevApp release confinement.
Runtime tab IDs are opaque, process-local handles bounded by T3's 128-character contract; they do
not serialize or expose workbench, project, workspace, or tile identifiers.

## Development DevApp preview tools

The same pinned T3 toolkit exposes two package-development lifecycle operations:

| Tool                    | Package effect                                                 | Surface effect                                                           |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `devapp_preview_ensure` | Opens or reuses a project-relative `cozea-devapp.json` package | Creates or reuses an inactive preview tile; `open: true` reveals it      |
| `devapp_preview_attach` | Never creates a package session or grants capabilities         | Attaches to an existing approved preview by package path or exact tab ID |

Both operations return the development phase, preflight diagnostics, requested capabilities,
worker state, readiness, and the exact runtime tab when a living guest exists. A package that is
invalid or waiting for approval returns immediately with no targetable guest. The assistant cannot
grant requested capabilities; the user must approve them for the current application session.

After approval, snapshot, click, type, press, scroll, evaluate, wait, capture, recording, resize,
and appearance operations address the same guest through its returned runtime tab ID. The package's
`agentInvocable` declaration controls whether its worker may become an autonomous agent surface; it
does not disable explicit user-directed preview inspection or interaction.

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
7. Selecting the row reattaches the process's original PTY and accumulated logs without a second
   process or a replacement empty terminal.
8. Browser, Dev Server, Project DevApp, and Org DevApp tiles render through the shared T3 host.
9. Every advertised operation targets the visible living guest; evaluate, recording, resize, and
   color scheme work on all four browser-backed surface families.
10. No legacy browser IPC, native overlay guest, bounds synchronization, or screenshot substitution occurs.
11. Reloading the renderer around a ready process preserves the run ID, terminal, Stop control, and
    persisted preview URL override.
12. Codex, Claude, OpenCode, and Cursor all receive the managed Dev Server routing policy when—and
    only when—the T3 MCP session is attached.
13. Electron validation uses Computer Use against the real app; do not use Playwright for this flow.
14. Explicit, last-controlled, and active-tile targeting are deterministic and never cross a
    workbench boundary.
15. Direct user input interrupts an active agent operation and returns the T3 control-interrupted
    diagnostic.
16. A newly created inactive Dev Server surface is returned by the same `preview_open` or
    `dev_server_ensure` request, and every returned runtime tab ID decodes through the pinned T3
    result schema.
17. `devapp_preview_ensure` reports invalid and approval-required packages without bypassing the
    gate; after approval, attach returns the living guest and generic snapshot/interaction observes
    the same page the user sees.
18. Hidden development guests capture through CDP and selector automation uses the bundled injected
    runtime; neither path depends on window visibility or runtime Node resolution from the packaged
    Electron output.
19. A project with one configured backend starts one automatic frontend and one backend PTY; Logs
    can select both, and Stop/Restart tears down both.
20. Auxiliary process configuration survives an app restart for that workspace, does not appear in
    another workspace, and is cleared when the local project is deleted.
