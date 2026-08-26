# Agent browser automation MVP (Track C)

Wave 0 Track C from `docs/t3code-implementation-plan.md`.

## Flag (default OFF)

| Name | Value |
|------|--------|
| Canonical flag | `cozea.browser.agentAutomation` |
| Main-process env | `COZEA_BROWSER_AGENT_AUTOMATION=1` (also `true` / `on` / `yes`) |
| Renderer mirror | `VITE_FF_BROWSER_AGENT_AUTOMATION=1` (optional UI awareness; **not** sufficient alone) |

When the main-process flag is unset or off, every automation call returns `{ ok: false, error: { code: "disabled", ... } }` except `status`, which reports `enabled: false`.

## Tool surface

Wired to the existing workbench browser host (`WorkbenchBrowserService` / `workbenchBrowser:*` IPC):

| Tool IPC | Purpose |
|----------|---------|
| `browserAutomation:status` | Flag state + already-open tile list |
| `browserAutomation:navigate` | Load a URL in an **already-open** tile |
| `browserAutomation:snapshot` | Title + visible text + a11y-lite interactive list |
| `browserAutomation:click` | Click by CSS selector |
| `browserAutomation:type` | Type into selector (or focused editable) |

Renderer helpers: `src/features/projects/browser/browserAgentBridge.ts`  
Preload: `window.electronAPI.browserAutomation.*`

## Safety policy

1. **No tile creation** — automation never calls `ensureTile`. The user must open a browser tile first.
2. **Project-scoped navigate** — only `http(s)://localhost|127.0.0.1|::1` URLs (loopback previews). Public / arbitrary cross-origin navigation is rejected (`url_not_allowed`).
3. **Flag default off** — no agent path runs without an explicit env opt-in.
4. **Out of scope** — Playwright fleet, unrestricted browsing, CDP attach.

## Flagged demo path

1. Quit Cozea if running.
2. Start with the flag on, e.g.:

   ```bash
   COZEA_BROWSER_AGENT_AUTOMATION=1 bun run dev
   ```

3. Open a project workbench and add a **Browser** tile (or open a localhost preview tile).
4. From DevTools console in the main window (or any code path using the bridge):

   ```js
   const status = await window.electronAPI.browserAutomation.status()
   // status.result.enabled === true; note an open tileId

   await window.electronAPI.browserAutomation.navigate({
     tileId: "<open-tile-id>",
     url: "http://127.0.0.1:5173/",
   })

   const snap = await window.electronAPI.browserAutomation.snapshot({
     tileId: "<open-tile-id>",
   })
   // snap.result.title / snap.result.visibleText
   ```

5. Optional: `click` / `type` with CSS selectors from `snap.result.interactiveElements`.

## Dependencies

**Zero new packages.** Uses Electron `webContents.executeJavaScript` on the existing `WebContentsView` host.

## Tests

- `tests/electron/browser-automation/BrowserAutomationAdapter.test.ts` — adapter policy + tool behavior with a mock host
- `tests/electron/browser-automation/urlPolicy.test.ts` — loopback URL gate
- `tests/electron/browser-automation/flags.test.ts` — default off
