# Browser Surface Modernization: VS Code-Style Main-Owned `WebContentsView` Architecture

**Status:** implementation plan — approved architectural direction, not yet implementation

**Primary repository:** `Cozea/electron-app`

**Secondary repository:** `Cozea/t3code`

**Planning branch:** `plan/browser-wcv-modernization`

**Electron app baseline for this plan:** `6f13aa8c2094052402b4aa47fed13d0bdc87ac65`

**Pinned Cozea T3 baseline for this plan:** `be4668f7b439499f39a659055d0f6ec34ac666b2`

**VS Code reference implementation examined:** `microsoft/vscode@e341a3c1515af84f5f679761d76a05a02af182cd`

**Date:** 2026-09-10 (Asia/Kuala_Lumpur)

---

# 0. Purpose of this document

This document is the authoritative implementation plan for replacing Cozea's renderer-owned, renderer-wide `<webview>` browser host with a VS Code-style main-process-owned `WebContentsView` architecture while preserving Cozea's existing product-level browser concepts, Dev Server semantics, DevApp semantics, T3 automation contract, storage isolation, annotation/picker behavior, recording behavior, and agent surface targeting.

This is intentionally written at an unusually explicit level of detail. An implementation agent must not have to infer the architecture, invent a migration order, decide which subsystem owns state, decide whether a temporary compatibility path is allowed, or guess what constitutes completion.

The plan has five goals:

1. Make browser resizing and movement substantially simpler by removing renderer-owned browser positioning and renderer-wide `<webview>` composition.
2. Move actual Chromium browser ownership to Electron main, where each browser surface is a durable `WebContentsView` associated with a stable Cozea runtime surface id.
3. Keep Cozea's current T3 browser automation capabilities attached to the exact same `WebContents` that the user sees.
4. Preserve Cozea's current Browser / Dev Server / compatibility Project DevApp / Org DevApp / DevApp Preview product semantics and storage boundaries.
5. Make browser presentation a replaceable backend so that a future iframe renderer for deliberately embeddable surfaces can be added without redesigning browser identity or agent targeting again.

This plan is **not** permission to perform opportunistic cleanup elsewhere in the codebase. Browser modernization should be broad where browser ownership requires it and narrow everywhere else.

---

# 1. Architectural decision

## 1.1 Final decision

Cozea will adopt the following architecture:

```text
Renderer / React / Dockview
        |
        | lightweight surface model + layout / visibility commands
        v
Electron main
        |
        | stable BrowserSurfaceView(runtimeTabId)
        v
Electron WebContentsView
        |
        | exact WebContents instance
        +----------------------+
        |                      |
        v                      v
Cozea/T3 automation       DevApp view bridge
        |
        v
same live browser page shown to the user
```

The actual browser is no longer created by React. React no longer renders `<webview>`. React no longer owns browser crash recreation. React no longer keeps the browser alive by hoisting it into a global host. React becomes presentation chrome plus a lightweight proxy to a browser owned by Electron main.

## 1.2 What is copied from VS Code

We are copying architectural principles and selected implementation patterns from the current VS Code Integrated Browser:

- main process owns the native browser instance;
- the workbench owns lightweight browser identity and presentation state;
- the browser has an explicit model/proxy rather than being synonymous with a DOM element;
- session ownership is separate from view ownership;
- layout is explicit: renderer computes a rectangle and main applies native bounds;
- visibility is explicit and independent from browser lifetime;
- browser focus is bridged between the workbench DOM and native browser surface;
- overlay occlusion is handled as a native-surface problem rather than by pretending CSS `z-index` can solve it;
- device emulation has one authoritative state model;
- browser lifetime is independent of Dockview component churn.

## 1.3 What is NOT copied from VS Code

We will **not** transplant VS Code's entire Integrated Browser product implementation.

Specifically, the first migration does **not** replace Cozea's T3 automation with VS Code's Playwright service, synthetic CDP browser groups, agent audiences, or browser tools.

Do not add these in the initial modernization unless a later phase in this document explicitly changes that decision:

- VS Code `PlaywrightService`;
- VS Code `PlaywrightTab`;
- VS Code `BrowserViewGroup`;
- VS Code `CDPBrowserProxy`;
- VS Code browser-agent tool implementations;
- VS Code browser history/favorites UX;
- VS Code trust model;
- VS Code remote tunnel proxy unless independently required later.

Cozea already has a T3 automation contract and product-specific Dev Server / DevApp tool semantics. Replacing those while also replacing browser presentation would multiply risk with little benefit.

---

# 2. Frozen baselines and reference points

Every implementation agent must record the actual branch head before modifying code. Do not assume the SHAs below are still the branch heads when implementation begins. They are the baselines used to write this plan and to explain architectural intent.

## 2.1 Cozea app baseline

Plan reviewed against:

```text
Cozea/electron-app
6f13aa8c2094052402b4aa47fed13d0bdc87ac65
```

At this baseline:

- browser-backed surfaces use one renderer-wide T3 `<webview>` host;
- `BrowserSurfaceSlot` measures Dockview-backed rectangles;
- `browserSurfaceStore` stores presentation geometry;
- `ElectronBrowserHost` renders one `HostedBrowserWebview` per registered surface;
- `HostedBrowserWebview` creates the Electron `<webview>` and handles viewport UI, registration, crash replacement, overlays, and geometry;
- `T3BrowserSurfaceService` prepares storage/session state, receives a renderer-created webview `webContentsId`, validates it, and hands it to the T3 PreviewManager;
- first-party architecture tests explicitly forbid `WebContentsView` and require `webviewTag: true`.

## 2.2 T3 baseline

Plan reviewed against:

```text
Cozea/t3code
be4668f7b439499f39a659055d0f6ec34ac666b2
```

The pinned T3 PreviewManager is already fundamentally `Electron.WebContents`-oriented after registration. Its main blocking assumption is the registration guard requiring a `WebContents` whose `getType()` is `"webview"` and whose `hostWebContents` is the application renderer.

The migration must remove that **type-specific registration assumption** without weakening ownership validation.

## 2.3 VS Code reference

Implementation patterns were reviewed against:

```text
microsoft/vscode
e341a3c1515af84f5f679761d76a05a02af182cd
```

Important reference paths:

```text
src/vs/platform/browserView/common/browserView.ts
src/vs/platform/browserView/electron-main/browserView.ts
src/vs/platform/browserView/electron-main/browserViewMainService.ts
src/vs/platform/browserView/electron-main/browserSession.ts
src/vs/platform/browserView/electron-main/browserViewEmulator.ts
src/vs/platform/browserView/electron-browser/preload-browserView.ts
src/vs/workbench/contrib/browserView/common/browserView.ts
src/vs/workbench/contrib/browserView/common/browserEditorInput.ts
src/vs/workbench/contrib/browserView/electron-browser/browserEditor.ts
src/vs/workbench/contrib/browserView/electron-browser/features/webContentsViewRendererFeature.ts
src/vs/workbench/contrib/browserView/electron-browser/overlayManager.ts
```

Agents must use these as design references, not as files to mechanically copy. Cozea has different workbench primitives, runtime contracts, and licensing obligations for its own resulting source.

---

# 3. Terms used throughout the plan

The following terms have exact meanings in this document.

## 3.1 Surface

A **surface** is a Cozea workbench entity that displays browser-rendered content and has a stable `runtimeTabId`.

Current browser-backed kinds:

```ts
"browser"
"devServer"
"projectDevApp"
"orgDevApp"
"devAppPreview"
```

The surface kind describes product semantics. It must not imply the rendering backend forever.

## 3.2 BrowserSurfaceView

`BrowserSurfaceView` is the proposed main-process object that owns one native `WebContentsView` and all state that is inseparable from that native view.

There is exactly one live `BrowserSurfaceView` per live native-rendered `runtimeTabId`.

## 3.3 BrowserSurfaceModel

`BrowserSurfaceModel` is the proposed renderer-side lightweight proxy for one surface. It exposes current browser state and methods but does not own Chromium.

## 3.4 BrowserSessionRegistry

`BrowserSessionRegistry` is the proposed main-process owner of Electron `Session` objects and Cozea storage-scope rules.

## 3.5 Native renderer

The **native renderer** means the presentation backend using `WebContentsView`.

## 3.6 Embedded renderer

The **embedded renderer** means a possible future presentation backend using a normal DOM `<iframe>` for deliberately embeddable applications.

The embedded renderer is explicitly **not part of the initial migration**.

## 3.7 T3 automation

T3 automation means the currently supported preview operations and associated state, including status, navigation, snapshot, click, type, press, scroll, evaluate, wait, resize, color scheme, recording, Dev Server operations, DevApp preview operations, and DevApp tool invocation.

---

# 4. Non-negotiable invariants

These invariants are architectural tests, not preferences.

## INV-001 — Main owns Chromium

Only Electron main may create or destroy a native browser `WebContentsView` for first-party browser surfaces.

Renderer code must not instantiate `<webview>` after final cutover.

## INV-002 — Stable identity is not DOM identity

`runtimeTabId` is the browser identity. A React mount, unmount, Dockview move, title update, visibility toggle, or toolbar rerender must not create a new Chromium browser unless the browser intentionally crashed beyond recovery or the surface was explicitly destroyed.

## INV-003 — One live native browser per runtimeTabId

The main service must reject or reconcile duplicate creation. It must never silently create two native browser views for the same `runtimeTabId`.

## INV-004 — Browser lifetime and visibility are separate

`setVisible(false)` hides the native view but does not destroy it.

Closing/releasing the surface destroys it according to lifecycle policy.

## INV-005 — Geometry does not live in global application state

High-frequency browser rectangles, native bounds, or pointer-drag geometry must not flow through Zustand or persisted workbench stores.

The renderer may measure a DOM placeholder, but it must send only the latest required bounds to the model/main service.

## INV-006 — T3 controls the exact visible WebContents

Any T3 action targeting a native surface must resolve to the `webContents.id` of the same `WebContentsView` displayed to the user.

No hidden duplicate Chromium instance may be introduced for automation.

## INV-007 — Existing storage boundaries survive

The migration must preserve intentional cookie/localStorage/IndexedDB/service-worker isolation between scopes.

At minimum, preserve the current semantics for:

- global browser storage;
- workspace browser storage;
- ephemeral browser storage;
- published Org DevApp storage keyed by publication semantics;
- unpublished DevApp preview storage keyed by development source.

## INV-008 — DevApp worker bridge remains package-scoped

Changing visual browser ownership must not broaden DevApp worker access, collapse published and development package boundaries, or expose general desktop APIs to DevApp content.

## INV-009 — Native browser cannot paint through application overlays

If a Cozea overlay that is intended to appear above a browser overlaps the browser rectangle, the native browser view must not remain interactable or visibly cover that overlay.

## INV-010 — Focus has one owner

At any time, either the workbench DOM or the browser WebContents receives keyboard focus. Focus transitions must be deliberate, observable, and reversible.

## INV-011 — Dockview floating order maps to native order

For overlapping native browser surfaces, the native child-view order must match Dockview's visual floating order.

CSS z-index alone must never be treated as sufficient for native `WebContentsView` ordering.

## INV-012 — Device emulation has one source of truth

UI resize controls, T3 resize operations, and CDP emulation must not independently fight over viewport state.

## INV-013 — Every phase must leave diagnosable state

No phase may intentionally leave a silent half-migration where the browser is blank and failures are swallowed. During migration, unsupported paths must fail with explicit diagnostics.

## INV-014 — No architecture reversal by grep-only tests

Architecture tests may scan source for forbidden patterns, but they must test meaningful invariants and must not permanently forbid the chosen native architecture merely because an older migration once removed it.

---

# 5. Current architecture to be replaced

At the baseline, the renderer path is approximately:

```text
WorkbenchBrowserTile / WorkbenchDevServerTile / DevApp tile
       |
       +--> useHostedBrowserSurface(descriptor)
       |        |
       |        v
       |    browserSurfaceRegistry (Zustand)
       |
       +--> BrowserSurfaceSlot
                |
                +--> getBoundingClientRect()
                +--> ResizeObserver
                +--> window resize
                +--> capture-phase scroll
                +--> Dockview position events
                |
                v
          browserSurfaceStore (Zustand)

Renderer-wide ElectronBrowserHost
       |
       v
HostedBrowserWebview for each descriptor
       |
       +--> preview.prepareSurface()
       +--> React creates <webview>
       +--> webview.getWebContentsId()
       +--> preview.registerWebview()
       +--> crash recreation
       +--> viewport transforms
       +--> browser overlays
       +--> hidden guest positioning
       |
       v
T3BrowserSurfaceService
       |
       +--> validate renderer-created guest
       +--> T3 PreviewManager.registerWebview()
       +--> DevApp bridge
```

This implementation has real strengths—shared feature behavior, one automation path, stable guest lifetime across tile churn—but it forces the renderer to manually reconstruct integration between a browser DOM object and a Dockview slot that does not actually own that browser.

The migration removes that composition technique, not the product concepts built on top of it.

---

# 6. Target architecture in detail

## 6.1 Process ownership

### Renderer owns

- Dockview tile identity and product chrome;
- URL field UI;
- error/start/loading presentation that belongs in normal DOM;
- device toolbar UI;
- resize handles UI;
- agent control badge/cursor UI where appropriate;
- overlay detection input from the Cozea DOM;
- lightweight browser model proxies;
- layout placeholder measurement;
- persisted workbench metadata.

### Electron main owns

- `WebContentsView` construction;
- `WebContentsView` destruction;
- actual `WebContents` identity;
- native bounds;
- native visibility;
- native child-view ordering;
- browser sessions;
- navigation listeners;
- load/error state;
- favicon / console / find state that comes from WebContents;
- permission policy;
- DevApp visual bridge attachment;
- T3 registration against the live WebContents;
- browser crash ownership / recreation;
- native device emulation application.

### T3 retains

- automation action semantics;
- control sessions;
- pointer events;
- screenshots/snapshots;
- picker/annotation behavior;
- recording/screencast behavior;
- color-scheme automation;
- automation diagnostics;
- dev-server operation contract;
- DevApp preview operation contract.

## 6.2 Proposed main-process classes

The exact filenames may be adjusted only if existing repository conventions make another placement clearly superior. If changed, update this plan or the implementation PR description with the mapping.

Recommended files:

```text
apps/desktop/electron/services/browser/
  BrowserSurfaceView.ts
  BrowserSurfaceSessionRegistry.ts
  BrowserSurfaceNativeHost.ts
  BrowserSurfaceOverlayCoordinator.ts   # only if main-side coordination warrants separate class
  BrowserSurfaceEmulator.ts
  BrowserSurfaceTypes.ts                # electron-main-only internal types if needed
```

`T3BrowserSurfaceService.ts` remains the Cozea product/policy orchestration service initially, but its responsibilities are reduced.

### BrowserSurfaceView responsibilities

- hold `runtimeTabId`;
- hold descriptor snapshot required for policy;
- hold one `WebContentsView`;
- expose `webContents` safely;
- own navigation/load/focus/find/console/favicon listeners;
- own current window/native parent;
- own `_wantsVisibility` and `_hasBeenLaidOut` equivalent state;
- expose `layout(bounds)`;
- expose `setVisible(visible)`;
- expose `focus()`;
- expose `loadURL()` / navigation methods;
- expose screenshot/find/devtools operations as needed;
- notify service when crashed/destroyed;
- attach/detach T3 and DevApp bridges through explicit callbacks, not by reaching into renderer state.

### BrowserSurfaceSessionRegistry responsibilities

- map Cozea storage scope to Electron `Session`;
- create sessions exactly once per scope identity;
- configure permissions/protocols once per session;
- preserve Org DevApp and DevApp Preview protocol registration rules;
- expose whether a partition/session is persistent;
- clear ephemeral storage on final release where current behavior requires it;
- never use a surface runtime id as a persistent storage identity unless the scope is intentionally per-surface.

### BrowserSurfaceNativeHost responsibilities

This may be the refactored `T3BrowserSurfaceService` itself if splitting would create unnecessary delegation. If separate, it owns:

- `runtimeTabId -> BrowserSurfaceView` map;
- get-or-create semantics;
- release semantics;
- window association;
- native ordering;
- state/event publication to preload IPC;
- crash replacement policy;
- attachment of T3 and DevApp integration callbacks.

## 6.3 Proposed renderer model

Recommended file:

```text
apps/desktop/src/features/browser/browserSurfaceModel.ts
```

The model should be a non-React object or small service wrapper. React hooks may subscribe to it, but the model must not require a component to exist in order for the browser to exist.

Conceptual API:

```ts
interface BrowserSurfaceModel {
  readonly runtimeTabId: string;
  readonly descriptor: BrowserSurfaceDescriptor;

  getState(): BrowserSurfaceState | null;
  subscribe(listener: (state: BrowserSurfaceState) => void): () => void;

  ensure(): Promise<void>;
  dispose(): Promise<void>;

  layout(bounds: BrowserSurfaceBounds): Promise<void>;
  setVisible(visible: boolean): Promise<void>;
  setNativeOrder(order: number): Promise<void>;
  focus(): Promise<void>;

  navigate(url: string): Promise<void>;
  goBack(): Promise<void>;
  goForward(): Promise<void>;
  refresh(): Promise<void>;

  findInPage(...): Promise<void>;
  stopFindInPage(...): Promise<void>;
  openDevTools(): Promise<void>;
  setViewport(...): Promise<void>;
}
```

Do not copy this signature mechanically if the existing bridge already exposes equivalent operations. The invariant is the ownership model, not these exact method names.

---

# 7. Agent implementation operating system

This section is mandatory operating procedure for any coding agent executing the plan.

## 7.1 Read-before-write checklist

Before editing any code, the agent must:

- [ ] read repository-root `AGENTS.md` completely;
- [ ] read this plan completely;
- [ ] read `docs/browser-agent-automation.md`;
- [ ] read `docs/workbench-overlay-architecture.md`;
- [ ] read `docs/substrate-t3-pin.md`;
- [ ] inspect current `shared/browserSurfaceTypes.ts`;
- [ ] inspect current `shared/browserSurfaceSessions.ts`;
- [ ] inspect current `T3BrowserSurfaceService.ts`;
- [ ] inspect current `BrowserSurfaceSlot.tsx`;
- [ ] inspect current `HostedBrowserWebview.tsx`;
- [ ] inspect current `ElectronBrowserHost.tsx`;
- [ ] inspect current `t3PreviewAutomationHost.ts`;
- [ ] inspect current architecture tests covering browser removal/parity;
- [ ] verify the current `vendor/t3code` pin;
- [ ] inspect the corresponding pinned T3 PreviewManager source before changing its interface.

Do not rely on this plan's file contents as a substitute for reading the current branch. Files may have evolved after the planning SHA.

## 7.2 Never stop a phase halfway

An agent must not report a phase complete because the main class was created, because a test was added, or because TypeScript compiles.

A phase is complete only when every checkpoint for that phase passes.

If blocked, report:

```text
BLOCKED PHASE: <phase number/name>
FIRST FAILING CHECKPOINT: <checkpoint id>
COMMAND / ACTION: <exact command or reproduction>
OBSERVED FAILURE: <exact concise failure>
CURRENT WORKING STATE: <what is implemented and what remains>
```

Do not describe a partially implemented phase as “done except”.

## 7.3 One architectural owner per concern

When implementing, search for existing ownership before adding state.

Examples:

- if main owns browser visibility, do not add another React visibility truth;
- if T3 owns controller state, do not create a second controller registry;
- if session registry owns partitions, do not construct ad-hoc partitions in tile code;
- if Dockview owns active/floating order, derive from Dockview rather than inventing another persisted ordering model.

## 7.4 No silent fallbacks

During migration, do not silently fall back from native WCV to renderer `<webview>` because a new native operation failed.

Temporary dual-path support must be explicit and keyed by surface migration status, not by `catch { useOldPath(); }`.

## 7.5 No unbounded “while touching this” refactors

Do not combine this migration with unrelated sidebar, collaboration, editor, provider, authentication, Convex, project, or file-system refactors.

---

# 8. Migration state machine

A surface family may be in exactly one of these migration states during implementation:

```text
LEGACY_WEBVIEW
NATIVE_SHADOW       # native view exists for parity tests but is not product-visible
NATIVE_CANARY       # selected family uses native path; other families remain legacy
NATIVE_REQUIRED     # family must use native path; legacy path is test failure
```

The implementation branch may temporarily contain both systems only while at least one surface family is `LEGACY_WEBVIEW` and another is `NATIVE_CANARY`.

The final branch state must be:

```text
browser       -> NATIVE_REQUIRED
devServer     -> NATIVE_REQUIRED
projectDevApp -> NATIVE_REQUIRED
orgDevApp     -> NATIVE_REQUIRED
devAppPreview -> NATIVE_REQUIRED
```

No renderer `<webview>` browser host remains after cutover.

---

# 9. Phase 0 — Reverse obsolete architecture guards and establish measurements

## Objective

Make the repository legally capable of containing the new architecture while preserving current behavior, and establish measurable baseline behavior before changing rendering.

## Required changes

### 9.1 Update architecture documentation

Update `AGENTS.md` browser instructions.

Remove the obsolete rule that categorically forbids:

- `WebContentsView`;
- browser bounds IPC;
- screenshot substitution;
- native-surface occlusion.

Replace it with the new invariants from this plan.

The new instruction must explicitly forbid renderer `<webview>` creation after final cutover and must state that native browser views are owned by main.

### 9.2 Replace legacy-removal architecture test intent

Current `tests/architecture/legacyBrowserRemoval.test.ts` was created to ensure the prior WCV architecture could not accidentally return. It must be rewritten as a migration-aware architecture test.

During early phases it may allow both systems, but it must assert all of the following:

- new WCV source is only in Electron-main code;
- renderer does not directly import Electron `WebContentsView`;
- surface descriptors remain stable;
- T3 automation parity ledger remains complete;
- legacy `<webview>` host remains the active path until a family is intentionally switched.

At final cutover the same test or its replacement must assert:

- no first-party `<webview>` browser surface creation;
- no `webviewTag: true` requirement in app renderer preferences;
- no `will-attach-webview` browser attachment path;
- no `registerWebview` renderer handshake;
- native host exists and is main-owned.

Do **not** merely delete `legacyBrowserRemoval.test.ts`.

### 9.3 Add migration ledger

Create:

```text
docs/browser-webcontentsview-migration-ledger.md
```

It should contain a table:

```text
surface family | active backend | automation parity | storage parity | overlay parity | status
```

The ledger is updated at every phase.

### 9.4 Establish performance baseline

Use existing performance infrastructure where possible.

Record at least:

- one Browser tile resize;
- two Browser tiles side-by-side while resizing split;
- one Browser + one Dev Server resize;
- a floating Browser tile movement;
- device viewport resize;
- hidden/inactive browser CPU behavior;
- browser memory with 1, 3, and 5 live surfaces.

Store raw benchmark notes in the migration ledger or a linked artifact location. Do not commit huge trace binaries to source unless existing perf conventions require it.

## Checkpoint PH0-A — repository compiles unchanged

Run:

```bash
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
bun run test
```

Expected: all pass before native implementation is introduced.

## Checkpoint PH0-B — architecture rules are forward-looking

Verify tests no longer fail merely because Electron-main code contains the token `WebContentsView`, but still fail if renderer code constructs native browser ownership.

## Exit criteria

- [ ] current legacy browser behavior is unchanged;
- [ ] baseline measurements recorded;
- [ ] architecture guard permits controlled WCV work;
- [ ] migration ledger exists;
- [ ] full test suite passes.

Do not proceed to Phase 1 if the repository is already failing before T3 changes.

---

# 10. Phase 1 — Make the pinned T3 PreviewManager accept trusted generic WebContents

## Repository

`Cozea/t3code`

## Objective

Remove T3's accidental dependency on renderer `<webview>` type while preserving all existing automation semantics and tightening ownership validation around an explicit host registration contract.

## Important constraint

Do not rewrite automation internals.

The current T3 manager already operates on `Electron.WebContents` after registration. The migration target is the registration boundary.

## 10.1 Current blocker

The pinned PreviewManager rejects a registration unless roughly:

```ts
wc.getType() === "webview"
wc.hostWebContents === mainWindow.webContents
```

That check was valid for the legacy renderer-created guest architecture. It is invalid for a main-created `WebContentsView`.

## 10.2 Required API change

Rename the conceptual operation from webview-specific to WebContents-specific.

Preferred source-level shape:

```ts
registerBrowserContents(tabId, webContentsId, ownership?)
```

If preserving the old method name temporarily avoids large contract churn, an internal generic method may be added first and the old method can delegate to it. However, the final parent application must not expose a renderer-facing `registerWebview` handshake.

## 10.3 Ownership validation

Do not replace the old check with “any WebContents id is accepted.”

The caller must establish that the WebContents belongs to the Cozea native browser host.

One acceptable pattern:

```text
Electron main BrowserSurfaceNativeHost creates WebContentsView
        -> obtains exact webContents.id
        -> passes id directly to T3 manager within same trusted main-process service
```

Because this is an in-process call from the owning main service, T3 does not need to rediscover renderer parentage.

If T3 still performs independent validation, it should validate a supplied predicate/ownership service rather than checking for `getType() === "webview"`.

## 10.4 Preserve these T3 behaviors exactly

Add regression tests before changing logic for:

- tab lifecycle generation guards;
- zoom reassertion on replacement contents;
- audio mute reassertion;
- control-session debugger ownership;
- controller state;
- pointer event publication;
- snapshot/evaluate/click/type/press/scroll/wait;
- recording/screencast;
- annotation picker;
- color scheme;
- navigation state;
- crash/destroyed contents cleanup.

## 10.5 Test with both content types during transition

During this phase only, the T3 fork should have tests proving the registration logic can accept:

- the existing `<webview>` WebContents path;
- a main-created `WebContentsView` WebContents path or a structurally equivalent test fixture.

This enables parent migration without a flag day across repositories.

## Checkpoint PH1-A — T3 tests

Run the T3 repository's required test/typecheck/lint commands as documented in that repository.

Do not guess commands if its `AGENTS.md` or package scripts differ from the parent repo.

## Checkpoint PH1-B — automation parity

For a test browser page, verify all core operations still target the registered WebContents.

At minimum:

```text
status
navigate
snapshot
click
type
press
scroll
evaluate
waitFor
setColorScheme
recording start/stop
```

## Checkpoint PH1-C — publish/pin readiness

The T3 change must be committed to `Cozea/t3code` and have a stable SHA before updating the parent gitlink.

## Exit criteria

- [ ] T3 generic WebContents registration exists;
- [ ] old webview path remains usable for temporary parent compatibility;
- [ ] automation regression tests pass;
- [ ] ownership was not weakened to arbitrary WebContents acceptance;
- [ ] a committed T3 SHA is available for parent repin.

---

# 11. Phase 2 — Repin T3 and add native-host foundation in Cozea

## Objective

Introduce the new main-process browser substrate without changing which product surface is visible to users yet.

## 11.1 Repin T3 correctly

Follow current repo policy exactly:

- update `vendor/t3code` gitlink;
- update `docs/substrate-t3-pin.md`;
- update any runtime constant required by current pin policy;
- run contract sync only if contract source actually changed;
- run `bun run prepare:t3-runtime`;
- run `bun run prepare:t3-runtime:check`;
- run provider compatibility checks if required by current pin tooling.

Do not manually edit generated contract banners unless the existing sync scripts own them.

## 11.2 Add native session registry

Create `BrowserSurfaceSessionRegistry` and move session construction/configuration out of the monolithic `T3BrowserSurfaceService`.

### Required API

The registry must be able to answer:

```ts
resolve(descriptor): Electron.Session
release(descriptor): Promise<void>
isPersistent(descriptor): boolean
clearScope(...): Promise<void>
```

Exact naming may differ.

### Required behavior

The registry must preserve the current `partitionForDescriptor()` semantics. Extract rather than redesign those rules in this phase.

### Required tests

For every surface kind, assert the resulting session/partition identity remains equal to the legacy implementation's intended identity.

Special tests:

- two workspace Browser surfaces that should share storage still share;
- two ephemeral Browser surfaces that should not share remain isolated;
- two instances of the same published Org DevApp share only where current publication policy intends;
- development DevApp preview never shares the published app session;
- different development sources do not collapse into one session.

## 11.3 Add BrowserSurfaceView

Create the main-owned native browser object.

### Constructor requirements

Inputs should include at least:

```text
runtimeTabId
descriptor
Electron Session
owning BrowserWindow
callbacks or services for state publication / T3 / DevApp bridge
```

### WebPreferences baseline

Start from strict preferences equivalent to current preview safety posture:

```text
nodeIntegration: false
contextIsolation: true unless a specifically reviewed preload requires another setting
sandbox: true
webviewTag: false
webSecurity: true
allowRunningInsecureContent: false
session: resolved Electron Session
focusOnNavigation: false
```

Do not blindly copy current `<webview>` `contextIsolation: false` behavior into WCV. Review the existing picker and DevApp preload assumptions and deliberately choose the WCV preload configuration.

### Initial native bounds

Like VS Code, initialize to an on-screen nonzero rectangle while keeping the native view invisible until first real layout. This avoids platform-specific renderer/compositor startup issues.

Suggested initial state:

```text
bounds 0,0,1024,768
visible false
hasBeenLaidOut false
wantsVisibility false
```

### Parent view

Add the WCV to the BrowserWindow's `contentView`, but keep it hidden until the renderer provides valid bounds.

## 11.4 Add native host registry

Add a main-process map:

```ts
Map<runtimeTabId, BrowserSurfaceView>
```

Methods:

```text
ensureSurface(descriptor)
releaseSurface(runtimeTabId)
layoutSurface(runtimeTabId, bounds)
setSurfaceVisible(runtimeTabId, visible)
setSurfaceOrder(runtimeTabId, order)
focusSurface(runtimeTabId)
```

The first implementation may live inside `T3BrowserSurfaceService` if extracting a separate service would merely forward every method. The map and ownership rules must nonetheless be explicit.

## 11.5 Native shadow mode

Before switching product rendering, create a test-only or explicit development-only path that can construct a native `BrowserSurfaceView`, load a known page, hide it, query state, register it with T3, run automation, and destroy it.

It must not be silently created for every production surface yet.

## Checkpoint PH2-A — compile

Run:

```bash
bun run prepare:t3-runtime:check
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
```

## Checkpoint PH2-B — native lifecycle test

Automated or Electron integration test must prove:

```text
create -> hidden -> layout -> visible -> navigate -> hide -> show -> destroy
```

without creating a renderer `<webview>` for the native test surface.

## Checkpoint PH2-C — same-live-page automation

Run T3 snapshot/evaluate against the main-created native WebContents and verify the observed URL/title/content correspond to the page loaded in that WCV.

## Exit criteria

- [ ] T3 repin complete;
- [ ] native session registry exists;
- [ ] native BrowserSurfaceView exists;
- [ ] native lifecycle works in isolation;
- [ ] T3 controls native WebContents;
- [ ] all existing product surfaces still use legacy renderer path;
- [ ] tests pass.

---

# 12. Phase 3 — Migrate the ordinary Browser surface first

## Objective

Move only `kind === "browser"` onto the native backend. Leave other surface families on the legacy path until the ordinary Browser validates the substrate.

This is the first `NATIVE_CANARY` family.

## 12.1 Add BrowserSurfaceModel registry

Replace browser-specific dependence on `useHostedBrowserSurface()` with a model registry.

The registry should be keyed by `runtimeTabId` and owner-reference-counted only if React churn requires it. The model's existence must not automatically mean the browser is visible.

Recommended responsibilities:

- ensure main surface exactly once;
- subscribe to `onSurfaceStateChange`;
- expose latest state to React through a thin hook;
- serialize operations per surface only where main requires ordering;
- release the main surface when the workbench lifecycle says it is truly gone, not whenever one React child remounts.

## 12.2 Replace BrowserSurfaceSlot for Browser kind

Create a native slot component or refactor `BrowserSurfaceSlot` behind a backend-specific implementation.

For the native browser path, it should:

1. render one ordinary `<div>` placeholder;
2. observe meaningful layout changes;
3. measure `getBoundingClientRect()`;
4. normalize rectangle to CSS-pixel coordinates;
5. derive the host zoom factor if required by main bounds conversion;
6. send `model.layout(bounds)`;
7. send `model.setVisible(surfaceVisible)` separately;
8. send native ordering when Dockview floating order changes.

### Forbidden

Do not write the measured rectangle into a Zustand store merely so another React component can read it.

## 12.3 Layout event strategy

Use event-driven updates.

Sources may include:

- Dockview `onDidLayoutChange`;
- Dockview floating group bounds change;
- `ResizeObserver` on the actual slot;
- window zoom change;
- browser device-emulation UI changes.

Avoid global capture-phase scroll listeners unless a demonstrated Dockview path can move the slot via scrolling without any other observable layout event.

All measurement sources must feed one per-surface animation-frame scheduler:

```text
markDirty()
  if frame already queued -> return
  requestAnimationFrame:
      measure once
      compare against last sent bounds
      if changed -> send layout
```

The last-sent comparison happens before IPC.

## 12.4 Bounds contract

Add a shared explicit bounds type similar to:

```ts
interface BrowserSurfaceBounds {
  windowId: number | string;   // choose existing stable Cozea window identity type
  x: number;
  y: number;
  width: number;
  height: number;
  hostZoomFactor: number;
  cornerRadius: number;
  nativeOrder: number;
  emulation?: {
    scale: number;
  };
}
```

Do not include renderer-only scroll offsets in the native bounds contract.

## 12.5 Rewire Browser tile

`WorkbenchBrowserTile.tsx` should become conceptually:

```text
construct descriptor
resolve BrowserSurfaceModel
subscribe model state
render WorkbenchTileChrome
render NativeBrowserSlot
render DOM start/error/toolbar UI
```

It must not call `useHostedBrowserSurface()` once the Browser family is native-required.

## 12.6 Persisted tile metadata

Continue updating persisted Browser tile URL/title/favicon only from authoritative main/T3 state transitions, not from input text edits.

## 12.7 Navigation controls

Existing Cozea navigation controls should call the model/bridge.

Do not port VS Code's URL bar UI.

## 12.8 Browser find

Existing `BrowserFindOverlay` remains normal DOM UI. `findInPage`/`stopFindInPage` operate on the native WebContents.

## 12.9 Browser DevTools

Opening DevTools for the WCV must target its WebContents. Verify debugger ownership interaction with T3: if DevTools temporarily owns the debugger, T3's current explicit `PreviewAutomationDebuggerAttachedError` behavior must remain understandable and recover when DevTools closes.

## Checkpoint PH3-A — Browser basic function

Manual/electron integration acceptance:

- [ ] open blank Browser tile;
- [ ] navigate to a simple page;
- [ ] back/forward;
- [ ] reload;
- [ ] title updates;
- [ ] favicon updates;
- [ ] find-in-page;
- [ ] zoom;
- [ ] open DevTools;
- [ ] close/reopen tile lifecycle.

## Checkpoint PH3-B — resize

Test continuously resizing the Dockview split for at least 10 seconds.

Acceptance:

- native browser remains visually attached to slot;
- no obvious one-frame oscillation between old/new rectangles;
- no repeated React rendering required to move browser;
- IPC layout calls are coalesced to at most one per animation frame per dirty surface;
- unchanged rectangle is not re-sent.

## Checkpoint PH3-C — browser automation parity

Against the native Browser tile:

- [ ] status;
- [ ] navigate;
- [ ] snapshot;
- [ ] click;
- [ ] type;
- [ ] press;
- [ ] scroll;
- [ ] evaluate;
- [ ] waitFor;
- [ ] recording start/stop;
- [ ] set color scheme;
- [ ] picker/annotation if enabled for Browser.

## Checkpoint PH3-D — session parity

Open two Browser surfaces with workspace storage scope. Log into a controlled test origin or set a cookie in one. Verify intended sharing in the other.

Repeat with ephemeral scopes and verify isolation.

## Exit criteria

- [ ] Browser kind is `NATIVE_CANARY` then `NATIVE_REQUIRED`;
- [ ] no Browser-kind `<webview>` is created;
- [ ] other kinds still function on legacy path;
- [ ] Browser automation parity complete;
- [ ] Browser storage parity complete;
- [ ] resize measurements recorded against baseline.

---

# 13. Phase 4 — Native overlay, focus, clipping, and floating-order integration

## Objective

Make native Browser surfaces behave like real members of the Cozea UI instead of foreign windows laid over it.

This phase is mandatory before migrating multiple surface families.

## 13.1 Overlay classification

Inventory every app overlay that may overlap a browser:

- Radix dropdown menus;
- context menus;
- dialogs;
- popovers;
- tooltips/hover cards if they can overlap content;
- command palette / quick actions;
- notifications/toasts;
- modal sheets;
- Dockview floating headers/controls;
- custom editor overlays;
- tutorial/driver overlays where applicable.

Create one overlay registry/coordinator. Do not special-case each browser tile.

## 13.2 Overlay algorithm

Use the VS Code principle, adapted to Cozea:

```text
DOM overlay state changes
        |
        v
collect relevant visible overlay rectangles
        |
        v
for each visible native browser rectangle
        |
        +--> no overlap -> keep live WCV visible
        |
        +--> overlap -> capture/update placeholder if required
                       hide WCV
                       expose DOM placeholder below overlay
```

The placeholder must belong to the Browser slot's DOM so Cozea chrome and overlay ordering remain normal CSS.

## 13.3 Screenshot policy

Do not automatically copy VS Code's continuous one-second screenshot refresh without measurement.

Preferred policy:

- capture when a surface becomes visible and no recent placeholder exists;
- capture immediately before hiding for an overlay when possible;
- optionally refresh on navigation completion or major page state changes;
- use a bounded freshness timer only if visual discontinuity is unacceptable;
- never start an unbounded screenshot polling loop for every browser without perf evidence.

## 13.4 Overlay race handling

A native view must not flash through a modal because screenshot capture took time.

Safe sequence when an overlay begins:

```text
1. mark browser interaction blocked immediately
2. request screenshot if needed
3. if latest screenshot exists, hide native view immediately and show it
4. if no screenshot exists, hide native view and show neutral placeholder rather than leaking through overlay
5. when fresh screenshot arrives, replace neutral placeholder
```

The user should never be able to click a hidden native browser through a modal.

## 13.5 Focus bridge

Implement explicit focus rules:

### When user clicks browser content

- native WebContents receives focus;
- workbench knows browser is focused;
- browser-native text input works normally.

### When user invokes a Cozea shortcut

Use preload/before-input routing rules to allow command-like keys to reach Cozea without stealing ordinary page editing shortcuts.

### When browser hides

If the browser was focused:

- return focus to the owning BrowserWindow renderer or relevant Dockview tile;
- native WCV then hides.

### When modal appears

- browser interaction becomes blocked;
- focus belongs to modal/workbench.

## 13.6 Keyboard preload

Review current T3 picker/DevApp preloads.

Add or adapt a small browser keyboard preload only if necessary. The preload must:

- not expose Node;
- not expose arbitrary IPC;
- forward only command-like unhandled shortcuts;
- run in subframes only if required and safe;
- preserve browser editing shortcuts.

Use VS Code's keyboard routing design as reference, not as code to blindly duplicate.

## 13.7 Rounded clipping

Use `WebContentsView.setBorderRadius()` where supported by current Electron. Keep DOM placeholder border radius identical.

Verify host zoom conversion before rounding.

## 13.8 Native floating order

Replace CSS `stackingLayer` for WCV surfaces with explicit native order.

Algorithm:

1. derive Dockview location type;
2. derive Dockview floating `aria-level` or a more stable public ordering API if available;
3. compute `nativeOrder`;
4. main host reconciles BrowserWindow `contentView` child order only when order changes;
5. non-floating/docked WCVs use deterministic order below floating WCVs;
6. overlay-hidden WCVs remain hidden regardless of native order.

Do not remove and re-add views on every frame if order did not change.

## Checkpoint PH4-A — overlay matrix

For each overlay class, open it so it overlaps a Browser surface.

Acceptance:

- overlay appears fully above browser;
- browser cannot receive clicks through overlay;
- no browser flash-through during opening/closing;
- after overlay closes, same live page returns without reload.

## Checkpoint PH4-B — focus matrix

Test:

- typing in page input;
- Cmd/Ctrl shortcuts intended for page;
- Cozea workbench shortcut while browser focused;
- opening/closing dialog;
- switching Dockview tabs;
- hiding focused browser;
- returning to browser.

## Checkpoint PH4-C — floating overlap

Create two floating Browser surfaces that overlap.

Verify visual and interactive order follows Dockview order as each is brought forward.

## Exit criteria

- [ ] overlays are correct;
- [ ] focus is correct;
- [ ] native ordering is correct;
- [ ] Browser remains same live WebContents through all operations;
- [ ] no global CSS z-index hack is relied on for WCV ordering.

---

# 14. Phase 5 — Device viewport and emulation modernization

## Objective

Preserve Cozea's device-preview UX while removing CSS-webview-specific viewport coupling and creating one authoritative emulation path.

## 14.1 Keep existing UI

Keep and adapt:

```text
BrowserDeviceToolbar.tsx
BrowserViewportResizeHandles.tsx
browserViewportStore.ts
browserViewportActions.ts
browserViewportLayout.ts
useBrowserViewportResize.ts
```

Do not replace Cozea's UX with VS Code UI.

## 14.2 Separate display rectangle from emulated viewport

For native WCV:

```text
native WCV bounds = displayed rectangle in app
emulated viewport = logical device viewport inside Chromium
scale = relationship between logical viewport and displayed rectangle
```

These must be explicit values rather than implicit CSS transforms around `<webview>`.

## 14.3 Add BrowserSurfaceEmulator

Model it after VS Code's `BrowserViewEmulator` principle:

- renderer is authoritative for desired device profile and available display rectangle;
- main applies `webContents.enableDeviceEmulation()`;
- touch/media/user-agent overrides are applied through native Electron/CDP as needed;
- cross-process navigation re-applies required emulation;
- duplicate equivalent emulation updates are suppressed.

## 14.4 Unify T3 resize

T3 `resize` operations must update the same viewport model used by UI controls.

Do not allow T3 to issue an independent emulation state that UI does not know about.

Preferred flow:

```text
T3 resize request
   -> parent automation host resolves target
   -> commitBrowserViewportChange(runtimeTabId, setting)
   -> renderer/model sends native emulation state
   -> main applies emulator
   -> readiness API reports actual rendered viewport
```

If this round trip is too renderer-dependent for agent-only/headless surfaces, move the authoritative viewport model into the shared/main layer and make UI subscribe to it. Choose one source of truth and document it.

## 14.5 Replace webview DOM viewport reads

Current `t3PreviewAutomationHost.ts` queries:

```text
webview[data-preview-tab]
```

and calls `executeJavaScript()` on the renderer's webview element to read `window.innerWidth/innerHeight`.

Replace with an IPC/main operation such as:

```text
getRenderedViewport(runtimeTabId)
```

which evaluates the current native WebContents or obtains equivalent metrics through CDP.

No renderer DOM query should be required to prove a browser's viewport.

## Checkpoint PH5-A — UI viewport controls

Verify:

- fill mode;
- fixed width/height;
- auto-fit;
- manual scale presets;
- resize rails;
- aspect lock;
- orientation swap;
- DPR override if currently supported;
- mobile/touch behavior;
- user agent behavior if currently supported.

## Checkpoint PH5-B — T3 resize

Run automation resize and verify:

- returned size matches target;
- `window.innerWidth/innerHeight` match expected logical viewport;
- UI toolbar reflects resulting state;
- no competing CSS transform causes double scaling.

## Checkpoint PH5-C — resize performance

Repeat continuous viewport handle dragging.

Acceptance:

- pointer events are frame-coalesced;
- no unbounded React commits per raw pointer event;
- native layout/emulation updates are suppressed when dimensions did not change.

## Exit criteria

- [ ] device preview parity achieved;
- [ ] native emulation is authoritative;
- [ ] T3 and UI share one viewport truth;
- [ ] renderer no longer needs `<webview>.executeJavaScript()` for viewport readiness.

---

# 15. Phase 6 — Migrate Dev Server and compatibility Project DevApp surfaces

## Objective

Move `devServer` and `projectDevApp` to native WCV while leaving process lifecycle semantics unchanged.

## 15.1 Explicit non-goal

Do not refactor Dev Server process ownership, working-copy keying, command detection, ports, or lane semantics as part of browser migration unless a native-browser bug directly requires it.

## 15.2 Surface creation

Existing Dev Server surface controllers continue to create product tile identity and ensure the dev process.

The visual surface now resolves a native BrowserSurfaceModel rather than registering into `ElectronBrowserHost`.

## 15.3 URL navigation

Dev Server initial URL and subsequent server-restart URL behavior must use main-owned browser navigation.

## 15.4 HMR

Verify HMR over the native WebContents behaves exactly as a normal top-level browser page.

Native WCV should not require any proxy solely for HMR.

## 15.5 Process restart behavior

When the dev server restarts:

- do not destroy the browser unless current product semantics require it;
- preserve the native view;
- navigate/reload when server readiness indicates the new process is ready;
- display explicit error/bootstrapping UI while unavailable.

## 15.6 Compatibility Project DevApp

Preserve current interpretation of compatibility Project DevApp as the relevant Dev Server-backed product surface. Rendering backend changes; semantic compatibility behavior does not.

## Checkpoint PH6-A — Dev Server lifecycle

Test:

```text
open -> start process -> load -> edit -> HMR -> stop -> restart -> recover -> close
```

## Checkpoint PH6-B — agent dev-server flow

Test existing operations:

```text
devServerStatus
devServerEnsure
devServerAttach
```

and then page automation against the created native surface.

## Checkpoint PH6-C — multi-surface resize

Run Browser + Dev Server side-by-side and resize continuously.

Measure against Phase 0 baseline.

## Exit criteria

- [ ] `devServer` native required;
- [ ] `projectDevApp` native required;
- [ ] Dev Server process semantics unchanged;
- [ ] HMR works;
- [ ] T3 agent flow works;
- [ ] no renderer `<webview>` for these kinds.

---

# 16. Phase 7 — Migrate DevApp Preview and Org DevApp

## Objective

Move the most policy-sensitive surfaces onto native WCV without weakening package/view/worker boundaries.

## 16.1 Preserve descriptor validation

Keep all existing validation around:

- kind;
- storage scope;
- publication id;
- content hash;
- runtime kind;
- prepared release URL scope;
- development source id;
- allowed navigation.

This logic may move out of `T3BrowserSurfaceService`, but must remain covered by tests.

## 16.2 Preload strategy

Current DevApp view bridge depends on a dedicated preload and MessagePort bootstrap.

For native WCV:

- set the exact reviewed DevApp preload in WebPreferences at WCV construction;
- do not expose the general desktop preload;
- preserve sandboxing;
- preserve package-scoped channel names;
- preserve worker connection generation/revocation behavior.

## 16.3 Worker bridge

The current bridge already operates on `Electron.WebContents.postMessage()`.

Adapt the attachment trigger from “renderer webview registered” to “native BrowserSurfaceView created/navigated and worker is ready.”

Required lifecycle:

```text
native WCV created
   -> DevApp URL loads
   -> worker ready
   -> create MessageChannel(s)
   -> post bootstrap to exact DevApp WebContents
   -> worker stops/restarts
   -> revoke old bridge
   -> create new bridge only for current worker generation
```

## 16.4 Navigation confinement

Preserve existing rules for internal allowed navigation and external-opening behavior.

Do not allow WCV `window.open()` to bypass DevApp scope validation.

Use `setWindowOpenHandler` in main.

## 16.5 Protocol registration

Move or reuse existing per-session protocol registration in the new session registry.

Verify published static and service runtime URLs continue resolving.

## 16.6 DevApp visual/worker independence

Closing/hiding the visual surface must follow current worker ownership semantics. Do not automatically terminate a worker merely because a WCV becomes invisible if the package runtime is intended to persist.

## Checkpoint PH7-A — development DevApp

Test:

- open unpublished DevApp;
- package diagnostics;
- view loads;
- hot reload;
- worker tool catalog;
- worker tool invocation;
- agent visual automation;
- worker restart;
- view bridge reattaches;
- close/reopen.

## Checkpoint PH7-B — published Org DevApp

Test:

- prepared publication loads;
- content-hash confinement;
- static runtime;
- service runtime where available;
- allowed internal navigation;
- blocked/out-of-scope navigation;
- external link behavior;
- worker tool invocation;
- agent visual automation.

## Checkpoint PH7-C — storage isolation

Explicitly prove:

- development preview does not share published app storage;
- separate development source ids remain isolated;
- published publication/session semantics remain as before.

## Exit criteria

- [ ] `devAppPreview` native required;
- [ ] `orgDevApp` native required;
- [ ] worker bridge parity complete;
- [ ] navigation confinement parity complete;
- [ ] storage parity complete;
- [ ] no DevApp renderer `<webview>` remains.

---

# 17. Phase 8 — Full T3 automation, recording, picker, and crash parity

## Objective

Verify all cross-cutting browser capabilities once every surface family uses the native backend.

## 17.1 Automation target resolution

Keep `t3PreviewAutomationHost.ts` product logic:

1. explicit runtime tab id;
2. thread's last controlled live surface;
3. active browser-backed Dockview tile;
4. operation-specific creation/ensure semantics.

Replace only webview-specific assumptions.

## 17.2 Surface inventory

`listSurfaces()` must remain authoritative from main. Inventory must not require the renderer host registry.

For every surface expose:

```text
runtimeTabId
tileId
workbenchSessionKey
kind
title
url
active
controller
backend (optional but useful during migration)
```

## 17.3 Recording

Preserve current recording UX/artifact semantics.

Verify T3 screencast or native frame source attaches to WCV WebContents.

Test:

- start recording;
- wait first frame;
- viewport change during recording;
- navigation during recording;
- stop recording;
- save artifact;
- cleanup after failure;
- only one conflicting recording where current policy requires exclusivity.

## 17.4 Annotation picker

Verify preload messages and capture still operate for native WCV.

Test:

- start pick;
- hover/select element;
- annotation screenshot crop;
- attach/send result;
- cancel;
- navigation during pick;
- browser destruction during pick;
- overlay visibility.

## 17.5 Agent cursor

The cursor overlay currently lives in renderer UI while pointer state comes from T3.

For WCV, coordinate translation must use native slot bounds plus emulator scale. Do not rely on the removed `browserSurfaceStore.content` object unless a smaller explicit presentation metric replaces it.

Define a single function:

```text
browserPagePoint -> appWindowPoint
```

and test it for:

- fill viewport;
- scaled device viewport;
- floating tile;
- workbench zoom.

## 17.6 Crash recovery

Renderer `HostedBrowserWebview` currently handles `render-process-gone` by creating another `<webview>` generation.

Move crash recovery into main.

Policy:

1. BrowserSurfaceView observes `render-process-gone`;
2. publish explicit crashed/error state;
3. decide whether crash is recoverable;
4. if recoverable, create a replacement WCV/WebContents using same descriptor/session;
5. replace native child view atomically;
6. re-register exact new WebContents with T3;
7. reattach DevApp bridge if applicable;
8. restore zoom/audio/device state;
9. restore most recent safe URL;
10. keep runtimeTabId stable;
11. update model state;
12. cap retry/backoff to avoid crash loops.

Do not recreate the entire workbench tile.

## Checkpoint PH8-A — all operations matrix

For each native family, execute all applicable operations from `SUPPORTED_OPERATIONS`.

Record N/A only where product semantics explicitly do not apply.

## Checkpoint PH8-B — crash tests

Induce renderer crash in a controlled test if Electron test infrastructure permits.

Verify stable runtime identity and bounded recovery.

## Checkpoint PH8-C — hidden surfaces

Open at least five browser-backed surfaces, make only one visible, and inspect CPU/memory.

Hidden WCVs must not remain visually composited. If background JS remains active by browser design, document it and decide whether explicit throttling/freezing is required as a separate feature.

## Exit criteria

- [ ] all T3 operation parity complete;
- [ ] recording parity complete;
- [ ] picker parity complete;
- [ ] cursor coordinate mapping correct;
- [ ] crash recovery main-owned;
- [ ] hidden surface behavior measured.

---

# 18. Phase 9 — Delete legacy renderer browser host

## Objective

Remove the temporary dual architecture and make the repository structurally incapable of reintroducing the old renderer-owned browser path accidentally.

## Required deletions or transformations

Delete when no longer referenced:

```text
apps/desktop/src/features/browser/ElectronBrowserHost.tsx
apps/desktop/src/features/browser/ElectronBrowserHostGate.tsx
apps/desktop/src/features/browser/HostedBrowserWebview.tsx
apps/desktop/src/features/browser/hostedBrowserWebviewStyle.ts
apps/desktop/src/features/browser/webviewCrashRecovery.ts
```

Delete or fundamentally replace the renderer host registry:

```text
apps/desktop/src/features/browser/browserSurfaceRegistry.ts
```

Shrink or replace the presentation store:

```text
apps/desktop/src/features/browser/browserSurfaceStore.ts
```

If a store remains for slow UI presentation metadata, it must not contain continuously updated native bounds or browser ownership.

## 18.1 Remove renderer webview enablement

From Electron main BrowserWindow preferences, remove `webviewTag: true` unless another unrelated first-party feature demonstrably still requires it.

Search the whole repository before deciding.

## 18.2 Remove `will-attach-webview` browser path

Remove browser-surface `will-attach-webview` validation/configuration once no browser `<webview>` can be created.

If an unrelated feature uses webview, narrow the handler to that feature instead of deleting blindly.

## 18.3 Remove renderer registration IPC

Delete:

```text
registerWebview(tabId, webContentsId)
```

from:

- shared browser IPC constants;
- preload bridge;
- handler registration;
- T3BrowserSurfaceService parent API;
- contracts if parent-owned;
- tests.

Main already owns the WebContents id; asking renderer to report it is obsolete.

## 18.4 Remove legacy geometry path

Delete any code whose only purpose was:

```text
slot -> Zustand rect -> global host -> fixed positioned webview
```

Do not retain dead compatibility code behind unreferenced flags.

## 18.5 Replace architecture test

Final architecture test must assert:

```text
NO renderer browser <webview>
NO ElectronBrowserHost
NO HostedBrowserWebview
NO browserSurfaceRegistry ownership
NO browser registerWebview IPC
NO browser will-attach-webview path
YES main BrowserSurfaceView uses WebContentsView
YES native bounds IPC/model path exists
YES all five surface families resolve native backend
YES T3 parity ledger has no pending requirement
```

## Checkpoint PH9-A — dead code search

Search for:

```text
<webview
registerWebview
HostedBrowserWebview
ElectronBrowserHost
webviewTag: true
will-attach-webview
browserSurfaceRegistry
```

Every remaining hit must be explained. Browser-surface legacy hits must be zero.

## Checkpoint PH9-B — full repository validation

Run:

```bash
bun run prepare:t3-runtime:check
bun run prepare:devapp-runtime:check
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
bun run test
bun run build
bun run audit:electron-ipc
bun run audit:electron-api-renderer
bun run check:provider-compatibility
```

Run additional browser/navigation/computer-use test suites if current CI defines them as required for changed paths.

## Exit criteria

- [ ] old host physically removed;
- [ ] old IPC removed;
- [ ] old webview enablement removed where browser-specific;
- [ ] all tests pass;
- [ ] all surface families native required.

---

# 19. Phase 10 — Performance acceptance and documentation cutover

## Objective

Prove that the migration actually addresses the problem that motivated it and make new architecture documentation canonical.

## 19.1 Repeat Phase 0 performance scenarios

Use the same machine/profile where possible.

Compare:

- split resize smoothness;
- Browser + Dev Server resize;
- two Browser surfaces;
- floating movement;
- viewport-resize handles;
- shell React commits during resize;
- layout IPC count;
- browser CPU;
- app renderer CPU;
- memory with 1/3/5 surfaces;
- hidden surface behavior.

## 19.2 Required qualitative acceptance

The migration is not successful if resizing merely moved jank from React to native view bounds.

Acceptance requires:

- browser tracks Dockview split without visually lagging multiple frames behind;
- app chrome does not visibly tear around browser;
- no repeated browser recreation during resize;
- overlays remain correct;
- floating order remains correct;
- device viewport resize is responsive;
- normal app UI remains interactive during browser movement.

## 19.3 Required quantitative evidence

Do not invent a universal FPS threshold before measuring baseline. Record at least:

- layout updates per second while resizing;
- duplicate/no-op layout calls;
- renderer commit count if measurable;
- main CPU / renderer CPU samples;
- trace screenshots/markers if supported by existing perf tooling.

If performance is not materially better, profile the native implementation before declaring the architecture complete.

## 19.4 Canonical docs

Update:

```text
docs/workbench-overlay-architecture.md
docs/browser-agent-automation.md
docs/integrated-browser-architecture.md
AGENTS.md
```

Clearly mark older webview architecture documents historical or update them.

Do not leave contradictory canonical docs.

## Exit criteria

- [ ] performance comparison documented;
- [ ] no major regression versus baseline;
- [ ] canonical docs describe WCV architecture;
- [ ] migration ledger says complete;
- [ ] implementation PR is merge-ready.

---

# 20. Detailed file disposition matrix

This matrix is a starting point. Implementation agents must update it in the migration ledger if current branch structure differs.

| Current file / subsystem | Planned disposition | Notes |
| --- | --- | --- |
| `shared/browserSurfaceTypes.ts` | KEEP + EVOLVE | Add native bounds/backend/model contracts; retain product kind descriptor. |
| `shared/browserSurfaceSessions.ts` | KEEP + REUSE | Preserve storage identity logic; session registry should consume it. |
| `shared/browserSurfaceIpc.ts` | MODIFY | Add ensure/layout/visibility/order/focus/read-viewport; eventually remove registerWebview. |
| `apps/desktop/electron/services/T3BrowserSurfaceService.ts` | SPLIT/REFACTOR | Keep Cozea policy + T3 + DevApp orchestration; remove renderer-created guest ownership. |
| `apps/desktop/electron/ipc/registerBrowserSurfaceHandlers.ts` | MODIFY | Route new main-owned lifecycle/layout APIs. |
| `apps/desktop/electron/preload.ts` | MODIFY | Expose model APIs; remove browser registerWebview. |
| `apps/desktop/electron/main.ts` | MODIFY | Native service startup; eventually remove browser `webviewTag` and `will-attach-webview`. |
| `apps/desktop/src/features/browser/BrowserSurfaceSlot.tsx` | REPLACE/ADAPT | Becomes direct native slot measurement sender. |
| `apps/desktop/src/features/browser/browserSurfaceStore.ts` | SHRINK/DELETE | Remove high-frequency rect/content/owner state. |
| `apps/desktop/src/features/browser/browserSurfaceStateStore.ts` | KEEP OR REPLACE WITH MODEL SUBSCRIPTION | State is low-frequency browser state, not geometry. |
| `apps/desktop/src/features/browser/browserSurfaceRegistry.ts` | DELETE/REPLACE | Replace host registry with model registry if needed. |
| `apps/desktop/src/features/browser/ElectronBrowserHost.tsx` | DELETE | No renderer-wide browser host. |
| `apps/desktop/src/features/browser/ElectronBrowserHostGate.tsx` | DELETE | No host gate. |
| `apps/desktop/src/features/browser/HostedBrowserWebview.tsx` | DELETE | Main owns browser. |
| `apps/desktop/src/features/browser/webviewCrashRecovery.ts` | MOVE LOGIC TO MAIN/DELETE | Crash replacement belongs to BrowserSurfaceView/native host. |
| `apps/desktop/src/features/browser/BrowserDeviceToolbar.tsx` | KEEP | Rewire to authoritative native emulation model. |
| `apps/desktop/src/features/browser/BrowserViewportResizeHandles.tsx` | KEEP | Frame-coalesce input and route to one viewport model. |
| `apps/desktop/src/features/browser/useBrowserViewportResize.ts` | KEEP + OPTIMIZE | Avoid raw pointer-event React churn. |
| `apps/desktop/src/features/browser/BrowserFindOverlay.tsx` | KEEP | Model/main WebContents performs find. |
| `apps/desktop/src/features/browser/BrowserSurfaceOverlays.tsx` | KEEP + ADAPT | Cursor/control overlay coordinates from native presentation metrics. |
| `apps/desktop/src/features/browser/AgentBrowserCursor.tsx` | KEEP + ADAPT | Remove dependency on legacy presentation store. |
| `apps/desktop/src/features/browser/useDockviewBrowserSurfaceLayer.ts` | TRANSFORM | Position events + native order instead of CSS browser z-index. |
| `apps/desktop/src/features/workbench/WorkbenchBrowserTile.tsx` | MODIFY | Thin model + slot + DOM chrome. |
| `WorkbenchDevServerTile.tsx` | MODIFY | Same native slot/model backend. |
| `WorkbenchOrgDevAppTile.tsx` | MODIFY | Same native backend, preserve package policy. |
| `WorkbenchDevAppPreviewTile.tsx` | MODIFY | Same native backend, preserve dev package bridge. |
| `apps/desktop/src/substrate/t3PreviewAutomationHost.ts` | KEEP + ADAPT | Remove DOM webview lookup/executeJavaScript assumptions. |
| `apps/desktop/src/features/browser/browserRecording.ts` | KEEP + ADAPT | Frame source remains T3/native WebContents. |
| `tests/architecture/legacyBrowserRemoval.test.ts` | REWRITE | New architecture invariant test. |
| DevApp architecture/security tests | KEEP + UPDATE EXPECTATIONS | Must continue testing same package boundaries. |

---

# 21. Proposed IPC contract

Use existing Cozea schema conventions. Do not hand-roll unvalidated `any` payloads if the surrounding browser contracts are schema-backed.

Conceptual methods:

```ts
ensureSurface(descriptor): Promise<BrowserSurfaceState>
releaseSurface(runtimeTabId): Promise<void>
getSurfaceState(runtimeTabId): Promise<BrowserSurfaceState | null>
listSurfaces(): Promise<BrowserSurfaceInventoryEntry[]>

layoutSurface(runtimeTabId, bounds): Promise<void>
setSurfaceVisible(runtimeTabId, visible): Promise<void>
setSurfaceOrder(runtimeTabId, order): Promise<void>
focusSurface(runtimeTabId): Promise<void>
getRenderedViewport(runtimeTabId): Promise<{width:number;height:number} | null>

navigate(...)
goBack(...)
goForward(...)
refresh(...)
findInPage(...)
stopFindInPage(...)
openDevTools(...)
```

The renderer must not receive the native `webContentsId` merely to send it back to main.

The `webContentsId` may remain in internal state if T3 diagnostics require it, but it is main-owned implementation detail.

---

# 22. BrowserSurfaceView implementation guide

The following is pseudocode-level guidance, not exact copy-paste code.

```ts
class BrowserSurfaceView {
  readonly runtimeTabId: string;
  readonly descriptor: BrowserSurfaceDescriptor;
  readonly view: WebContentsView;

  private currentWindow: BrowserWindow;
  private wantsVisibility = false;
  private hasBeenLaidOut = false;
  private disposed = false;
  private lastBounds: NativeBounds | null = null;
  private lastSafeUrl: string | null = null;
  private listeners = new DisposableStoreLike();

  constructor(args) {
    this.view = new WebContentsView({
      webPreferences: reviewedWebPreferences(args.session, args.preload),
    });

    this.view.setBounds({ x: 0, y: 0, width: 1024, height: 768 });
    this.view.setVisible(false);
    this.currentWindow.contentView.addChildView(this.view);

    this.installListeners();
  }

  async initializeT3() {
    await t3.registerBrowserContents(this.runtimeTabId, this.view.webContents.id);
  }

  layout(bounds) {
    if (sameAsLastBounds(bounds)) return;
    this.lastBounds = bounds;

    // Switch parent window only when changed.
    this.moveToWindowIfRequired(bounds.windowId);

    this.view.setBorderRadius(...);
    this.emulator.applyLayout(...);
    this.view.setBounds(convertCssToNativeBounds(bounds));

    this.hasBeenLaidOut = true;
    this.reconcileVisibility();
  }

  setVisible(visible) {
    this.wantsVisibility = visible;
    this.reconcileVisibility();
  }

  reconcileVisibility() {
    const actual = this.wantsVisibility && this.hasBeenLaidOut && !overlayBlocked;
    if (this.view.getVisible() !== actual) this.view.setVisible(actual);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    detachT3();
    detachDevAppBridge();
    listeners.dispose();
    currentWindow.contentView.removeChildView(this.view);
    this.view.webContents.close(...); // use current Electron-recommended destruction semantics
  }
}
```

Important: verify the correct destruction API for the Electron version actually in the repository at implementation time. Do not assume old Electron `BrowserView` patterns apply to `WebContentsView`.

---

# 23. Layout implementation guide

## 23.1 Renderer scheduler

Each native slot gets one scheduler.

```ts
let scheduled = false;
let disposed = false;
let lastSent: Bounds | null = null;

function scheduleLayout() {
  if (scheduled || disposed) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (disposed) return;
    const next = measure();
    if (equal(next, lastSent)) return;
    lastSent = next;
    void model.layout(next);
  });
}
```

Do not call IPC directly from every `ResizeObserver` callback and every Dockview event independently.

## 23.2 Visibility

Visibility should be computed from product/workbench state, for example:

```text
surface requested visible
AND panel activity says visible
AND no start-state-only DOM replacement
AND no full-page error DOM replacement
```

Overlay occlusion is separate and main/native renderer will further suppress actual WCV visibility.

## 23.3 Hidden layout

A hidden WCV does not need to be moved to `-100000px`. It can remain at last valid bounds and `setVisible(false)`.

## 23.4 Window zoom

Bounds conversion must account for app zoom exactly once.

Add tests for app zoom values such as 80%, 100%, 125%, and 150% if the product supports them.

---

# 24. Overlay implementation guide

## 24.1 Renderer overlay registry

Prefer explicit registration hooks over scanning the whole DOM for every frame.

A practical hybrid:

- known global overlay roots registered centrally;
- MutationObserver detects mount/unmount only;
- ResizeObserver tracks currently visible overlay rectangles;
- browser layout completion can trigger an overlap recompute because browser moved;
- no continuous polling.

## 24.2 Occlusion state

For each native surface:

```ts
interface OcclusionState {
  blocked: boolean;
  reason: "menu" | "dialog" | "popover" | "notification" | "unknown" | null;
  placeholderScreenshot: string | null;
  screenshotCapturedAt: number | null;
}
```

This is UI state and may live in a lightweight store if needed. Native bounds should not.

## 24.3 Partial overlap policy

`WebContentsView` cannot be clipped arbitrarily by DOM overlays. If an overlay meaningfully overlaps the browser, hide the entire native view and show placeholder content underneath.

Do not attempt complex rectangular native hole-punching in the first implementation.

---

# 25. Native ordering guide for Dockview

Represent each visible native browser with:

```text
location = docked | floating
floatingLevel = Dockview public order signal
stableTieBreaker = runtimeTabId or tile creation order
```

Compute a total order.

Main reconciliation should:

1. get desired list of visible native browser views in back-to-front order;
2. compare with last applied order;
3. only mutate `contentView` order if changed;
4. never destroy views to reorder;
5. reapply after a view is moved between BrowserWindows.

Write tests for:

- two docked WCVs;
- one docked + one floating;
- two floating;
- bring-to-front change;
- floating browser over non-browser Dockview content;
- native browser hidden by application overlay.

---

# 26. DevApp migration guide

The DevApp path is especially sensitive. The following behaviors are mandatory.

## 26.1 Development preview

Identity inputs:

```text
devSourceId
workspaceId
laneId
runtime generation
relative package path
```

Do not replace source identity with `runtimeTabId` for storage/worker ownership.

## 26.2 Published app

Identity inputs include:

```text
publicationId
contentHash
runtimeKind
workspaceId
organization context where current policy requires it
```

## 26.3 Bridge bootstrap

The native host must attach the bridge only if:

- descriptor kind is DevApp kind;
- descriptor validation passed;
- correct worker connection is ready;
- current native WebContents is still the surface's active WebContents;
- current runtime generation still matches;
- old bridge is revoked before replacement.

## 26.4 Navigation

Every `will-navigate` and `window.open` target must pass the same allowed-navigation policy as current implementation.

Do not assume a URL is safe because it originated from the DevApp page.

---

# 27. T3 integration guide

## 27.1 Keep product operation names stable

Do not rename agent-facing T3 operations merely because internal browser registration changed.

## 27.2 Main-to-T3 attachment

Preferred native lifecycle:

```text
create native BrowserSurfaceView
  -> obtain wc.id
  -> T3 createTab/ensure tab state
  -> T3 register generic browser contents
  -> attach Cozea listeners
  -> attach DevApp bridge if applicable
  -> navigate
```

Exact create-vs-register ordering should be chosen to preserve current T3 generation/lifecycle locking.

## 27.3 Replacement WebContents after crash

T3 must treat replacement contents similarly to current webview reattachment:

- same tab id;
- new webContents id;
- old control session detached;
- zoom/audio/color scheme restored;
- current state emitted once attached;
- stale events from old contents ignored by attachment/generation guards.

## 27.4 DevTools conflict

Current T3 explicitly detects when another debugger owns the WebContents. Preserve this behavior.

Do not forcibly detach DevTools to let the agent act.

---

# 28. Test matrix

The migration is incomplete until this matrix has explicit coverage.

## 28.1 Surface families

Rows:

```text
Browser
Dev Server
Project DevApp compatibility surface
DevApp Preview
Org DevApp static
Org DevApp service
```

## 28.2 Functional columns

For every applicable row:

```text
create
initial navigation
subsequent navigation
reload
back/forward
focus
hide/show
Dockview tab switch
split resize
floating move
floating reorder
workbench zoom
title
favicon
find
DevTools
crash/recovery
close/release
session cleanup
```

## 28.3 Automation columns

```text
status
open/navigate
snapshot
click
type
press
scroll
evaluate
waitFor
resize
setColorScheme
recording
picker/annotation
controller state
agent cursor
```

## 28.4 DevApp-only columns

```text
protocol resolution
navigation confinement
worker ready
bridge bootstrap
bridge revoke
worker restart
tool catalog
tool invoke
published/development isolation
```

## 28.5 Overlay columns

```text
dropdown
context menu
popover
dialog
notification
command palette / global quick UI
tutorial overlay if applicable
```

---

# 29. Failure playbook

## Failure: native view is blank but page loaded

Check in this order:

1. WCV `setVisible` state;
2. first valid layout received;
3. native bounds nonzero and within BrowserWindow;
4. host zoom conversion;
5. parent `contentView` attachment;
6. overlay coordinator accidentally marking blocked;
7. WebContents crash state;
8. session navigation/load error.

Do not immediately recreate the view.

## Failure: browser lags during resize

Check:

1. duplicate layout scheduling sources;
2. whether each event calls `getBoundingClientRect` immediately rather than through one frame scheduler;
3. no-op IPC sends;
4. main repeated `setBounds` with identical values;
5. emulation reapplied unnecessarily on every bounds update;
6. React state updates coupled to pointer movement;
7. overlay screenshot capture triggered during every resize frame;
8. Dockview itself generating excessive layout events.

## Failure: overlay appears behind browser

Check:

1. overlay registration;
2. overlap rectangle calculation;
3. browser blocked state;
4. native visibility reconciliation;
5. placeholder DOM layer;
6. asynchronous screenshot race.

Do not try to fix native layering with CSS `z-index`.

## Failure: agent automation says no browser

Check:

1. surface inventory contains runtimeTabId;
2. T3 tab exists;
3. native WebContents registered with T3;
4. webContents id still current;
5. control session debugger availability;
6. requested thread/workbench target resolution.

## Failure: DevApp worker tools work but view is blank

Treat visual host and worker runtime independently. Check WCV/session/protocol/view bridge before restarting worker.

## Failure: DevApp view works but worker bridge does not

Check:

1. correct DevApp preload;
2. worker generation;
3. exact WebContents ownership;
4. MessagePort transfer;
5. bridge revocation state;
6. package grant/agentInvocable state.

## Failure: cookies changed unexpectedly

Compare new BrowserSurfaceSessionRegistry scope identity against `browserSurfaceSessions.ts` legacy rules before changing site code or browser settings.

---

# 30. Commit/checkpoint strategy

Implementation should be commit-shaped so failures can be bisected.

Recommended sequence:

```text
1. chore(browser): reverse obsolete webview-only architecture guard
2. test(browser): add native migration ledger and baseline invariants

# in Cozea/t3code
3. refactor(preview): allow trusted generic browser WebContents registration
4. test(preview): cover webview and WebContentsView attachment parity

# parent
5. chore(t3): repin generic browser WebContents support
6. refactor(browser): extract browser session registry
7. feat(browser): add main-owned BrowserSurfaceView host
8. test(browser): cover hidden native surface lifecycle and T3 attachment
9. feat(browser): migrate ordinary Browser tile to native host
10. feat(browser): add Dockview-native layout scheduler
11. feat(browser): add WCV overlay and focus coordinator
12. feat(browser): map Dockview floating order to native child order
13. refactor(browser): move device emulation to native BrowserSurfaceEmulator
14. feat(browser): migrate Dev Server and project DevApp surfaces
15. feat(devapp): migrate development preview view to native browser host
16. feat(devapp): migrate published Org DevApp view to native browser host
17. refactor(browser): move crash recovery to main native host
18. refactor(browser): remove renderer webview host and registration handshake
19. test(browser): enforce final native architecture invariants
20. docs(browser): make native browser architecture canonical
```

Do not force this exact commit count if implementation naturally groups adjacent changes, but preserve bisectable concerns.

---

# 31. Implementation PR evidence template

The final PR description should include this completed table.

```md
## Baselines
- Parent base SHA:
- T3 old pin:
- T3 new pin:
- VS Code reference SHA used:

## Surface migration
| Surface | Native WCV | T3 parity | Storage parity | Overlay parity | Notes |
| --- | --- | --- | --- | --- | --- |
| Browser | | | | | |
| Dev Server | | | | | |
| Project DevApp | | | | | |
| DevApp Preview | | | | | |
| Org DevApp | | | | | |

## Validation
- [ ] prepare:t3-runtime:check
- [ ] prepare:devapp-runtime:check
- [ ] typecheck
- [ ] typecheck:electron
- [ ] typecheck:tests
- [ ] lint
- [ ] test
- [ ] build
- [ ] electron IPC audit
- [ ] renderer API audit
- [ ] provider compatibility

## Manual/native interaction matrix
- [ ] split resize
- [ ] two browser resize
- [ ] Browser + Dev Server resize
- [ ] floating move
- [ ] floating reorder
- [ ] overlay matrix
- [ ] focus matrix
- [ ] device viewport resize
- [ ] crash recovery

## Performance comparison
Before:
After:
Trace/artifact references:

## Legacy removal search
Results for:
- `<webview`
- `registerWebview`
- `HostedBrowserWebview`
- `ElectronBrowserHost`
- `webviewTag: true`
- `will-attach-webview`
```

---

# 32. Final completion checklist

The modernization is complete only when every item below is true.

## Architecture

- [ ] Electron main owns every browser-backed native surface.
- [ ] One native `WebContentsView` exists per live native `runtimeTabId`.
- [ ] Browser lifetime is independent of React component lifetime.
- [ ] Native geometry is not stored in global renderer state.
- [ ] Main applies bounds directly.
- [ ] Visibility is independent from lifetime.
- [ ] Native ordering follows Dockview ordering.
- [ ] Overlays correctly occlude native views.
- [ ] Focus bridge is deterministic.

## T3

- [ ] T3 accepts trusted generic WebContents.
- [ ] T3 no longer requires `getType() === "webview"` for native hosted surfaces.
- [ ] T3 actions target same WebContents shown to user.
- [ ] No second hidden browser is introduced.
- [ ] Controller/pointer state works.
- [ ] Recording works.
- [ ] Picker/annotation works.
- [ ] Color-scheme and resize operations work.

## Surface families

- [ ] Browser native.
- [ ] Dev Server native.
- [ ] Project DevApp compatibility native.
- [ ] DevApp Preview native.
- [ ] Org DevApp native.

## Sessions

- [ ] workspace sharing parity.
- [ ] ephemeral isolation parity.
- [ ] Org DevApp publication isolation parity.
- [ ] development preview isolation parity.
- [ ] ephemeral cleanup parity.

## DevApps

- [ ] development protocol works.
- [ ] published protocol works.
- [ ] view preload works.
- [ ] worker bridge works.
- [ ] worker restart works.
- [ ] navigation confinement works.
- [ ] tool catalog/invoke works.

## Legacy removal

- [ ] renderer browser `<webview>` removed.
- [ ] `ElectronBrowserHost` removed.
- [ ] `HostedBrowserWebview` removed.
- [ ] browser `registerWebview` IPC removed.
- [ ] browser `will-attach-webview` path removed.
- [ ] browser-specific `webviewTag: true` removed.
- [ ] renderer browser geometry ownership store removed or stripped of high-frequency bounds.
- [ ] obsolete architecture tests replaced.

## Quality

- [ ] full validation suite passes.
- [ ] performance comparison recorded.
- [ ] resizing materially improves or remaining bottleneck is explicitly profiled and documented.
- [ ] canonical docs updated.
- [ ] migration ledger complete.

---

# 33. Explicit anti-pattern list

An implementation agent must reject these shortcuts.

## Do not create one hidden WCV and screenshot it into tiles

That would break real interaction and multi-surface semantics.

## Do not create/destroy WCV on every Dockview activation

Use visibility. Preserve live page state.

## Do not send every pointer move directly over IPC

Frame-coalesce and suppress unchanged state.

## Do not keep `browserSurfaceStore` as the native geometry message bus

Send layout directly from slot/model to main.

## Do not keep the renderer `<webview>` as a “fallback just in case” after final cutover

A permanent fallback doubles browser architectures and prevents the cleanup from paying off.

## Do not copy VS Code's screenshot polling loop without profiling

Port the occlusion principle, not unnecessary workload.

## Do not run both VS Code Playwright and T3 debugger automation against the same WebContents

T3 already handles debugger ownership. Two competing automation stacks can break DevTools and control-session assumptions.

## Do not weaken DevApp navigation/session policy because WCV is “trusted main code”

The browser page remains untrusted content relative to the desktop shell.

## Do not let renderer send arbitrary webContents ids to main

Main creates the native browser, so main already knows the id.

## Do not infer browser identity from URL

Use stable `runtimeTabId`.

## Do not infer storage identity from runtimeTabId unless current scope explicitly requires per-surface storage

Use session scope rules.

## Do not attempt to solve native view ordering with CSS

Use native child view ordering plus occlusion.

---

# 34. Future extension point: iframe renderer

This is deliberately deferred until after native WCV cutover is stable.

The target architecture should nonetheless avoid preventing it.

A future renderer selection may look like:

```ts
type BrowserPresentationBackend = "native" | "embedded";
```

Potential policy:

```text
Browser -> native only
arbitrary Dev Server -> native by default
explicit embeddable Dev Server preview -> embedded optional
DevApp view satisfying embedding contract -> embedded optional
worker-only DevApp -> no browser presentation
```

The important requirement now is that **surface identity, session policy, agent target selection, and product semantics are not hard-coded to a React `<webview>`**.

Do not implement iframe support while executing this plan unless it is separately approved after native migration measurements.

---

# 35. Final instruction to implementation agents

Do not reinterpret this work as “replace `<webview>` with `WebContentsView`.” That description is too shallow and will recreate the same architectural coupling in a different API.

The work is:

> Move browser ownership, lifetime, browser state, and native presentation responsibility into Electron main; keep the workbench as a lightweight layout/chrome/model layer; keep Cozea's T3 and DevApp semantics; and make the rendering backend a contained implementation detail.

The migration is successful when a Dockview tile can mount, unmount, move, float, resize, hide, and return while the same main-owned browser continues to exist, and when T3 can operate that exact browser without depending on a renderer-owned `<webview>` element.

If any implementation choice conflicts with that sentence, the implementation choice is wrong unless this plan is explicitly revised.