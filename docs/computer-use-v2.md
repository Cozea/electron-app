# macOS Computer Use v2 (Embedded Cua Driver)

## Scope and invariants

Computer Use is macOS 14+ only (universal binary supporting both `arm64` and `x86_64`); the rest of Cozea remains cross-platform. The engine is an embedded daemon architecture powered by an official, signed, SHA-256 verified universal fat binary of Cua Driver (`cua-driver`) v0.28.1. Cozea supervises the daemon as an embedded child process communicating over a process-private UNIX domain socket (`/tmp/cz-cua-<pid>-<hash>.sock`), with pure TypeScript line-delimited JSON-RPC client (`CuaSocketClient.ts`).

Accessibility and Screen Recording TCC grants attach to the embedded driver's own code identity (Developer ID Application: Cua AI, Inc.), because the supervised driver process — not Cozea — invokes those APIs. Cozea owns supervision, per-call policy, and auditing; the Settings screen reports the driver's grant status. The runtime exposes the canonical 9-tool contract defined in `native/computer-use-runtime/Sources/CozeaComputerUseCore/Resources/tools.json` and bridges agent calls through the token-authenticated loopback HTTP broker already integrated with T3.

The software cursor uses Cua's native overlay system (`cua.default`), ensuring smooth visual motion without stealing user focus or hijacking the physical mouse pointer. Background actions execute via Apple Accessibility SPI (AX) and targeted Core Graphics events directly against the target application PID/window, preserving background window isolation.

`get_app_state` captures window/AX state and generates a fresh snapshot ID. The seven action tools accept element tokens, coordinate pairs, or cached element indices, and return compact acknowledgements without taking redundant screenshots. Password managers and credential vaults are strictly excluded at discovery and dispatch.

## Architecture and Components

- **Binary Staging (`scripts/prepare-computer-use-runtime.mjs`)**:
  Downloads and stages the official GitHub release universal fat binary of Cua Driver v0.28.1. Verifies SHA-256 hash (`9ba84f64b04fadf7c03520d6af5d821efdd46571b84686248b3498c1ad0113db`), stages executable to `build/computer-use-runtime/cua-driver` with permissions `0755`, and writes `manifest.json` (schemaVersion 3, backend `EmbeddedCuaDriver`, arch `universal`).
- **Daemon Supervisor (`EmbeddedCuaDaemon.ts`)**:
  Spawns and manages the lifetime of `cua-driver serve --embedded --socket <path> --cursor-theme cua.default`. Uses short UNIX socket paths under 80 characters to comply with OS limits. Monitors process health, streams stderr diagnostics, and guarantees clean teardown on app shutdown or reset.
- **Socket RPC Client (`CuaSocketClient.ts`)**:
  Opens one connection per request over the UNIX domain socket, streaming line-delimited JSON requests and responses. Validates every result envelope through a single content gate, enforces request timeouts and a response size budget, and maps `AbortSignal` cancellation to explicit delivery-unknown semantics.
- **Application Exclusions (`ApplicationExclusions.ts`)**:
  Strict security boundary. Disallows observation or interaction with password managers (1Password, Bitwarden, Dashlane, LastPass, NordPass, Proton Pass, Apple Passwords, KeePassXC). Strips them from `list_apps` and immediately rejects targeted operations before daemon invocation.
- **Runtime Broker Service (`ComputerUseRuntimeService.ts`)**:
  Translates the canonical 9 tools (`list_apps`, `get_app_state`, `click`, `perform_secondary_action`, `scroll`, `drag`, `type_text`, `press_key`, `set_value`) to Cua Driver socket calls.
  - Maintains `activeSnapshots` cache mapping `(sessionId, pid, windowId)` to `{ snapshotId, elementTokens }`. When an agent supplies `element_index`, the service injects the cached engine `element_token` and `snapshot_id` to prevent bare-index rejections, falling back to a reconstructed token only for snapshots this process never cached.
  - Validates arguments fail-fast in Electron (element indexes, coordinates, scroll direction/pages, secondary action names): malformed input never reaches the engine as NaN or a silently reinterpreted gesture.
  - Resolves application names and windows dynamically with exact, PID, and bundle-identifier matching.
  - Manages session lifecycle (`turnEnded`, `resetSession`, `resetAll`), policy revocation, and host loopback HTTP broker (`/v1/call`, `/v1/turn-ended`).
- **Canonical Tool Contract (`native/computer-use-runtime/.../tools.json`)**:
  Preserves the single source of truth for the 9-tool schema, synchronized with T3 via `scripts/patch-computer-use-contract.mjs`.

## Tool Specifications and Execution Routing

1. **`list_apps`**:
   Invokes `list_apps` via daemon socket, filtering out excluded password managers. Returns running applications with PID, name, and window count.
2. **`get_app_state`**:
   Invokes `get_window_state` for the target window. Records `snapshot_id` and all element tokens into `activeSnapshots`. Returns formatted AX tree and base64 PNG screenshot (or degraded AX tree if screenshot is disabled).
3. **`click`**:
   Supports `element_index` (resolved to the cached engine `element_token` + `snapshot_id`) or `(x, y)` pixel coordinates — never both. Translates `mouse_button`/`click_count` to the engine dialect (`button`/`count`); `click_method: 'global'` becomes foreground delivery (policy-gated) while other methods are rejected. Background clicks execute without physical cursor movement or focus stealing.
4. **`perform_secondary_action`**:
   Dispatches secondary gestures: `double_click` (same-name daemon tool), `right_click` (also via `context_menu`/`show_menu`), `hover` (via `move_cursor`). Unknown actions are rejected: the engine has no generic action parameter, so forwarding one would silently degrade to a plain click.
5. **`scroll`**:
   Dispatches line or page scrolling to target `pid` and `window_id` in direction (`up`, `down`, `left`, `right`). `pages` defaults to 1 per the contract (T3 passes arguments through without filling schema defaults) and maps to the engine `amount`.
6. **`drag`**:
   Dispatches drag gesture from source coordinates/token to destination coordinates/token via `drag`.
7. **`type_text`**:
   Injects text into target field via background keystrokes or AX value setting.
8. **`press_key`**:
   Dispatches single keys (`press_key`) or modifier chords (`hotkey`, e.g., `["cmd", "c"]`), targeting the specific `pid` and `window_id`.
9. **`set_value`**:
   Directly updates field values via accessibility API (`set_value`).

## Security Invariants

1. **Exclusions**: Credential management applications and vaults cannot be targeted or observed under any circumstance.
2. **Scheduled Policy Hard-Gating**: When a scheduled task policy is `deny`, requests are rejected before socket dispatch.
3. **Global Pointer Protection**: Global physical pointer fallback is disabled by default and requires explicit opt-in in Cozea Settings.
4. **No Environment Poisoning**: Authority is never passed through environment variables (such as `OPEN_COMPUTER_USE`).
5. **Fail-Closed Teardown**: Resetting sessions or revoking policy synchronously flushes in-flight requests and resets the state to `deny`.

## Verification Commands

Observation budgets are `max_tree_nodes`/`max_tree_depth`. There is intentionally no `text_limit`: the embedded engine implements no such argument, so the contract does not advertise one.

```sh
# Verify universal binary staging and manifest
bun run prepare:computer-use:check

# Run the Computer Use suite: static, mocked-translation, and contract tests
# always run. Live daemon tests additionally run on a logged-in Mac GUI
# session and skip headless (the driver needs a window server/pasteboard).
bun run test:computer-use

# Type check Electron and frontend
bun run typecheck:electron
bun run typecheck

# Lint codebase
bun run lint
```
