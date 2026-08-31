# T3 browser and automation parity ledger

The legacy automation adapter and native browser host are removed. Browser, Dev Server, compatibility
Project DevApp, and Org DevApp tiles now share the pinned T3 manager and one renderer-wide
`<webview>` host. There is no feature flag, blackout surface, `WebContentsView`, or fallback host.

The pinned preview UX is active across all four surface families: responsive/freeform/device sizing,
direct resize rails, aspect locking, rotation, color-scheme emulation, audio state, zoom and favicon
presentation, agent pointer, screenshots, native picture-in-picture, screencast recording, and the T3
element/region/drawing picker. Picker attach/send intent is adapted into Cozea's active assistant
composer while preserving the exact T3 annotation payload and screenshot crop.

The all-surface automation protocol is the next gate. Until that gate commits:

- `dev_server_status`, `dev_server_ensure`, and `dev_server_attach` continue to manage the
  `(workspaceId, laneId)` singleton process and its workbench tile shell.
- The embedded user surface is available, but the agent-operation adapter still reports it as
  unavailable.
- `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, and `waitFor` fail immediately
  with `PreviewAutomationUnavailableError`. They do not invoke browser IPC or wait for a timeout.

The checked ledger in `shared/browserPortParityLedger.ts` records each pinned behavior as `ported`,
`cozea-adapted`, `shell-inapplicable`, or pending only for the final automation gate. Dockview replaces
T3's right-panel routing and thread mini-player shell; native PiP retains the browser mirroring
behavior. Browser-backed cross-window popout is disabled and restored popouts normalize into the
main workbench, while same-window drag, split, maximize, and float remain supported.

See [`docs/dev-server-agent-automation.md`](./dev-server-agent-automation.md) for the retained
process-management contract.
