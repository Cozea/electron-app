# Plan 001 — Require authentication on the assistant-runtime WebSocket server

- **Status**: TODO
- **Written against**: commit `8a807045` (branch `feat/local-workspace-catalog-rearchitecture`; the working tree was dirty when this plan was written — see Drift check)
- **Category**: security
- **Effort**: S–M (about a day including tests)
- **Risk of change**: low–medium (one handshake path; renderer reconnect must keep working)

## Why this matters (context for an executor who has seen nothing else)

Cozea is an Electron desktop AI-IDE. The Electron main process boots a local AI runtime — an Effect-TS WebSocket server listening on `ws://127.0.0.1:3773` — that can **edit files on disk, run terminals, and execute git commands** on behalf of the chat UI.

The server supports an auth token, but the desktop boot path never sets one, so in every shipped build the gate is skipped and **any local process, and any web page open in any browser on the machine (WebSocket connections are not blocked by the same-origin policy), can connect and drive the runtime**. This is a local-RCE-equivalent hole: a malicious website can open `new WebSocket("ws://127.0.0.1:3773")` and issue runtime requests while Cozea is running.

## Current state (verified excerpts)

`electron/assistant-runtime/wsServer.ts:994-1016` — the gate exists but is conditional:

```ts
httpServer.on("upgrade", (request, socket, head) => {
  socket.on("error", () => {});

  if (authToken) {
    let providedToken: string | null = null;
    try {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);
      providedToken = url.searchParams.get("token");
    } catch {
      rejectUpgrade(socket, 400, "Invalid WebSocket URL");
      return;
    }

    if (providedToken !== authToken) {
      rejectUpgrade(socket, 401, "Unauthorized WebSocket connection");
      return;
    }
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});
```

`electron/assistant-runtime/boot.ts:19-31` — the desktop boot path (used by the Electron app) passes no token:

```ts
export function startAssistantRuntime() {
  const input: CliInput = {
    mode: Option.some("desktop"),
    ...
    authToken: Option.none(),
    ...
  };
```

`electron/assistant-runtime/main.ts:181` — the only fallback is an env var nobody sets in production: `authToken: firstDefinedEnv("COZEA_ASSISTANT_AUTH_TOKEN")`. `main.ts:276-280` resolves precedence input → env → bootstrap; `main.ts:327` passes it into `ServerConfig`; `main.ts:403-407` already logs `authEnabled: Boolean(authToken)` and deliberately strips the token value out of the logged config — keep that property.

How the renderer learns the WS URL today (the token must ride the same path):

- `electron/main.ts:75-77`: `ASSISTANT_RUNTIME_WS_URL` defaults to `ws://127.0.0.1:3773`, then `ASSISTANT_RUNTIME_WS_URL_ARG = \`--cozea-assistant-ws-url=${ASSISTANT_RUNTIME_WS_URL}\``.
- `electron/main.ts:1278`: that arg is injected into the BrowserWindow via `webPreferences.additionalArguments`.
- `electron/preload.ts:20-21, 39-46, 1049`: preload parses `--cozea-assistant-ws-url=` from `process.argv`, falls back to `DEFAULT_ASSISTANT_WS_URL = 'ws://127.0.0.1:3773'`, and exposes it as `electronAPI.assistantRuntime.getWsUrl()` (line 1049: `getWsUrl: () => assistantWsUrl`).
- `electron/main.ts:486, 632`: the same `wsUrl` is also pushed through the `assistantRuntime:status` bridge (`AssistantRuntimeBridgeStatus.wsUrl`).

`startAssistantRuntime()` from `boot.ts` is called from the Electron main process (grep `startAssistantRuntime` in `electron/main.ts` for the exact site), so main can generate the token and hand it to both sides without it ever leaving the process boundary except via the preload argv (which only Cozea's own windows receive).

## Implementation steps

Work on a branch off the current feature branch or main as the maintainer prefers. **Use `bun` for all package/script commands. Run tests with `bunx vitest run <file>` (Node, never `bun --bun`).**

1. **Generate a per-launch token in the Electron main process.**
   In `electron/main.ts`, where `ASSISTANT_RUNTIME_WS_URL` is defined (around line 75), generate a token once at module scope or app-ready: `crypto.randomBytes(32).toString("hex")` (import `node:crypto`). If `COZEA_ASSISTANT_AUTH_TOKEN` is set in the environment, prefer it (preserves the existing manual-override behavior for external/dev tooling).
   - Verify: `rg "randomBytes" electron/main.ts` shows the new call; no token value is ever passed to `console.log`/logger.

2. **Pass the token to the runtime.**
   Change `startAssistantRuntime()` in `electron/assistant-runtime/boot.ts` to accept an options object `{ authToken?: string }` and forward it: `authToken: options?.authToken ? Option.some(options.authToken) : Option.none()`. Update the call site in `electron/main.ts` to pass the generated token. Keep the function's signature backward-compatible (optional arg) so any other callers don't break — check callers with `rg "startAssistantRuntime" electron/`.
   - Verify: `bun run typecheck:assistant-runtime` passes.

3. **Deliver the token to the renderer over the existing argv channel.**
   In `electron/main.ts`, append the token to the URL the renderer receives: build `ASSISTANT_RUNTIME_WS_URL_ARG` from a URL with `?token=<token>` (use `new URL(...)` + `searchParams.set("token", token)` rather than string concat so a pre-existing query in `COZEA_ASSISTANT_RUNTIME_WS_URL` survives). Lines 486 and 632 push `wsUrl` through the status bridge — make sure those use the same tokenized URL (extract one helper, e.g. `getAssistantRuntimeWsUrl()`).
   The preload (`electron/preload.ts` `resolveAssistantWsUrl`) needs no change if the token rides the URL.
   - Verify: launch `bun run dev`, open DevTools console in the app window, run `window.electronAPI.assistantRuntime.getWsUrl()` — it must end with `?token=…`.

4. **Make the server reject when no token is configured in desktop mode.**
   In `electron/assistant-runtime/wsServer.ts` upgrade handler (current lines 994-1016): keep the existing comparison, but remove the silent-open fallback for the desktop path. Concretely: the `if (authToken)` guard becomes — if `authToken` is absent, log a one-time warning (`auth disabled: no token configured`) and only allow it when an explicit opt-out flag is set (add `allowUnauthenticated` to `ServerConfig`, default false, settable only via a new CLI flag `--allow-unauthenticated` in `main.ts` next to `authTokenFlag` at line 461). Otherwise reject the upgrade with 401. This keeps the standalone-CLI dev workflow possible without silently shipping an open server.
   - Verify: `bunx vitest run tests/electron/assistant-runtime/wsServer.test.ts` passes (update existing fixtures that boot the server without a token to either pass a token or set the opt-out — prefer passing a token so the tests cover the real path).

5. **Defense in depth: Origin and Host checks.**
   In the same upgrade handler, before the token check: if the request carries an `Origin` header, reject any value that is not the app's own origins (dev: the `devUrl` from `ServerConfig`; packaged: `file://` or the app protocol — derive from existing config rather than hardcoding). Also reject when `Host` is present and is neither `127.0.0.1:<port>` nor `localhost:<port>` (DNS-rebinding defense). Non-browser clients that send no Origin still pass to the token check (the token is the real gate; Origin is belt-and-braces against browsers).
   - Verify: a unit test connects with `headers: { Origin: "https://evil.example" }` and a valid token → expect 4xx rejection.

6. **Run the full verification gate.**
   - `bun run typecheck` (renderer; expected: pass)
   - `bun run typecheck:assistant-runtime` (expected: pass)
   - `bun run lint` (expected: pass)
   - `bunx vitest run` (expected: same results as baseline — note the pre-existing known failure below)
   - Manual smoke: `bun run dev`, open a project, send a chat message, open a terminal tile — everything reconnects and works.

## Test plan

Extend `tests/electron/assistant-runtime/wsServer.test.ts` (it already boots the server; follow its existing setup helpers as the pattern):

- upgrade with correct `?token=` → connection succeeds, welcome message arrives.
- upgrade with missing token → 401, socket closed.
- upgrade with wrong token → 401.
- upgrade with valid token but hostile `Origin` → rejected.
- no `authToken` configured and no opt-out → server rejects connections (or refuses to start — match whatever step 4 implemented).

## Hard boundaries

- In scope: `electron/assistant-runtime/wsServer.ts`, `electron/assistant-runtime/boot.ts`, `electron/assistant-runtime/main.ts` (flag/config plumbing only), `electron/main.ts` (token generation + URL arg), `tests/electron/assistant-runtime/wsServer.test.ts`.
- Out of scope: `electron/preload.ts` (should not need changes; if it does, stop and re-read step 3), the message protocol itself, provider code under `electron/assistant-runtime/provider/`, anything in `src/` (the renderer reads the URL opaquely), the Fastify `server/`.
- Do NOT log or persist the token value anywhere. `main.ts:403` already destructures it out of the logged config — preserve that.
- Do NOT add `// @ts-nocheck` to any file (repo rule).

## Repo conventions the executor must follow

- Effect-TS here is the **effect-smol snapshot**, not mainline Effect v3: `effect/Context` does not exist (use `effect/ServiceMap`); `Effect.fork` is `forkScoped`/`forkIn`. Read the "Effect (effect-smol) pin" section of `AGENTS.md` before touching `wsServer.ts`/`main.ts`.
- `@effect/vitest` `it.effect` runs under a TestClock — `Effect.sleep` hangs; use `it.live` for real-time tests.
- TypeScript: explicit types, no `any`; interfaces for object shapes.

## Done criteria (machine-checkable)

1. `rg "authToken: Option.none\(\)" electron/assistant-runtime/boot.ts` → no longer the unconditional desktop value (replaced by plumbed option).
2. `bunx vitest run tests/electron/assistant-runtime/wsServer.test.ts` → all green, including the five new auth cases.
3. `bun run typecheck && bun run typecheck:assistant-runtime && bun run lint` → exit 0.
4. With the app running (`bun run dev`), this Node one-liner exits with an error (handshake rejected): `node -e "const ws=new (require('ws'))('ws://127.0.0.1:3773'); ws.on('open',()=>{console.log('OPEN - FAIL');process.exit(1)}); ws.on('error',()=>{console.log('rejected - OK');process.exit(0)})"`.

## Pre-existing failure — do not chase

`tests/electron/assistant-runtime/main.test.ts` has 11 CLI-boot timeout failures at clean HEAD (`8a807045`), unrelated to this work. If it fails identically before and after your change, it is not your regression. (If your change adds a required flag that breaks CLI boot fixtures, that IS yours — distinguish by running the suite once before starting.)

## Drift check

This plan cites line numbers from a dirty working tree at `8a807045`. Before editing, re-locate each excerpt with `rg` (`rg "Unauthorized WebSocket connection" electron/assistant-runtime/wsServer.ts`). If the upgrade handler has materially changed (e.g. auth was already added), STOP and report back instead of improvising.

## Escape hatches

- If `startAssistantRuntime` has callers outside `electron/main.ts` that cannot supply a token, STOP and report the call sites.
- If the renderer has any second WS client that connects without going through `getWsUrl()` (grep `ws://127.0.0.1:3773` in `src/` — at plan time there were none), STOP and list them.
- If existing wsServer tests rely on tokenless connections in more than ~10 places, prefer adding a shared test helper that boots with a fixed token instead of editing every site; if that still balloons, report back.

## Maintenance note

Future reviewers: any new way of launching the runtime (CLI mode, utility process, web mode) must thread a token or explicitly set `allowUnauthenticated`. Watch for new `additionalArguments` consumers — the token is visible in the window's argv by design (same trust domain), but must never be written to logs, crash reports, or telemetry.
