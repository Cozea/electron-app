# Browser automation removal and T3 parity ledger

The legacy automation adapter for ordinary Browser tiles has been removed. It has no feature flag,
main-process registration, preload surface, renderer bridge, or native guest host. Browser tiles now
render the shared unavailable surface and may open only validated HTTP(S) URLs through the generic
shell API.

The current T3 preview protocol remains registered for Dev Server process management:

- `dev_server_status`, `dev_server_ensure`, and `dev_server_attach` continue to manage the
  `(workspaceId, laneId)` singleton process and its workbench tile shell.
- The reported embedded surface has `available: false`; a running process is reported as
  `headless: true` during this migration.
- `open`, `navigate`, `snapshot`, `click`, `type`, `press`, `scroll`, and `waitFor` fail immediately
  with `PreviewAutomationUnavailableError`. They do not invoke browser IPC or wait for a timeout.

The removed tests' required behavior is recorded in
`shared/browserPortParityLedger.ts`. Every ledger entry is explicitly `pending-t3-port`; the ledger
prevents requirements from disappearing but is not implementation evidence. The direct T3 browser
port must replace each pending entry with executable parity coverage before embedded browsing or
preview interaction is re-enabled.

See [`docs/dev-server-agent-automation.md`](./dev-server-agent-automation.md) for the retained
process-management contract.
