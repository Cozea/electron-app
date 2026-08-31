# T3 browser and automation parity ledger

The legacy automation adapter and native browser host are removed. Browser, Dev Server, compatibility
Project DevApp, and Org DevApp tiles now share the pinned T3 manager and one renderer-wide
`<webview>` host. There is no feature flag, blackout surface, `WebContentsView`, or fallback host.

The pinned preview UX is active across all four surface families: responsive/freeform/device sizing,
direct resize rails, aspect locking, rotation, color-scheme emulation, audio state, zoom and favicon
presentation, agent pointer, screenshots, native picture-in-picture, screencast recording, and the T3
element/region/drawing picker. Picker attach/send intent is adapted into Cozea's active assistant
composer while preserving the exact T3 annotation payload and screenshot crop.

The renderer host advertises the complete operation set from pinned T3 revision
`3acdc3b2f9751915b7da12862681413dad363945`: status, open, navigate, snapshot, click, type, press,
scroll, evaluate, wait, recording start/stop, resize, color-scheme emulation, and the three Dev
Server lifecycle operations. Every page operation is routed through T3's manager/CDP control path
to the same living guest shown to the user.

Target selection is deterministic and workbench-confined:

1. An explicit runtime tab ID wins.
2. Otherwise the assistant thread's last controlled live surface is reused.
3. Otherwise the active browser-backed Dockview tile is used.
4. `open` without an explicit target creates or reuses the thread's Dev Server surface; process
   management remains the responsibility of `dev_server_ensure` and `dev_server_attach`.

`status` extends the upstream status payload with the eligible workbench inventory: stable runtime
tab ID, kind, title, URL, active state, and current human/agent controller. Browser, Dev Server,
compatibility Project DevApp, and Org DevApp surfaces are all eligible. Org DevApp navigation still
crosses its main-process release/origin policy, so automation cannot expose an authenticated
loopback URL, cross publications, or bypass external-link routing.

T3's control epoch remains authoritative. Direct pointer or keyboard input interrupts an active
agent operation. Missing or detached guests, invalid selectors, non-editable targets, oversized
evaluation results, disconnection, interruption, and timeouts return bounded diagnostics instead of
falling back to another guest.

The checked ledger in `shared/browserPortParityLedger.ts` records each pinned behavior as `ported`,
`cozea-adapted`, or `shell-inapplicable`. Dockview replaces
T3's right-panel routing and thread mini-player shell; native PiP retains the browser mirroring
behavior. Browser-backed cross-window popout is disabled and restored popouts normalize into the
main workbench, while same-window drag, split, maximize, and float remain supported.

See [`docs/dev-server-agent-automation.md`](./dev-server-agent-automation.md) for the retained
process-management contract.
