# Browser `WebContentsView` Modernization — Pinned Source Reference Map

**Purpose:** companion source appendix for `docs/browser-webcontentsview-modernization-plan.md`.

This file exists so an implementation agent does not search moving branches, study an obsolete VS Code browser implementation, copy the wrong file, or guess which upstream concept maps to which Cozea subsystem.

## 0. Source pin policy

For implementation work governed by the modernization plan, use the immutable revisions below as the architectural research baselines unless the plan is deliberately re-baselined.

| Repository | Pinned revision | Role |
| --- | --- | --- |
| `Cozea/electron-app` | `6f13aa8c2094052402b4aa47fed13d0bdc87ac65` | Cozea application baseline used to author the plan |
| `Cozea/t3code` | `be4668f7b439499f39a659055d0f6ec34ac666b2` | T3 PreviewManager baseline currently pinned by Cozea at plan authoring time |
| `microsoft/vscode` | `e341a3c1515af84f5f679761d76a05a02af182cd` | Current Integrated Browser implementation studied for the target architecture |

**Do not substitute `main` for these links during implementation.** If a newer upstream revision is intentionally adopted, first record the new SHA and repeat the relevant comparison. A moving `main` is research input, not an implementation contract.

---

# 1. VS Code Integrated Browser — exact reference files

Repository root at the reviewed commit:

- https://github.com/microsoft/vscode/tree/e341a3c1515af84f5f679761d76a05a02af182cd

Integrated Browser platform directory:

- https://github.com/microsoft/vscode/tree/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView

Integrated Browser workbench directory:

- https://github.com/microsoft/vscode/tree/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView

The files below are the primary implementation references. The modernization agent should inspect these exact files before implementing the corresponding Cozea phase.

## VS-001 — canonical browser contracts

**File**

`src/vs/platform/browserView/common/browserView.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/common/browserView.ts

**Study for**

- browser identity separate from renderer identity;
- `IBrowserViewBounds` shape;
- browser state/event contracts;
- explicit owner/host/session concepts;
- visibility separate from lifetime;
- storage-scope/session-selector concepts;
- screenshot/find/navigation APIs.

**Do not copy**

- VS Code-specific ownership/audience policy;
- VS Code storage-scope names verbatim;
- VS Code command IDs.

**Cozea mapping**

- `shared/browserSurfaceTypes.ts`;
- new native-browser IPC/model contracts.

---

## VS-002 — one native browser instance

**File**

`src/vs/platform/browserView/electron-main/browserView.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserView.ts

**This is the most important upstream file in the migration.**

**Study for**

- `WebContentsView` construction;
- browser `webPreferences`;
- adding/removing the view from a window `contentView`;
- native `setBounds()`;
- native `setBorderRadius()`;
- `setVisible()` semantics;
- focus transfer between workbench and browser;
- page lifecycle events;
- navigation/history state;
- popup/window-open handling;
- browser console collection;
- find-in-page events;
- crash/error state;
- screenshot capture;
- moving the same native view between windows;
- avoiding browser recreation when the editor moves.

**Key architectural rule to port**

A browser page is a main-owned native object. The workbench tells it where to be; the workbench does not create Chromium.

**Cozea mapping**

- new `BrowserSurfaceView` (name can vary, responsibility cannot);
- current browser-owned portions of `T3BrowserSurfaceService.ts`;
- replacement for renderer-created `<webview>` lifecycle.

---

## VS-003 — main-process browser registry/service

**File**

`src/vs/platform/browserView/electron-main/browserViewMainService.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserViewMainService.ts

**Study for**

- id → native browser registry;
- `getOrCreateBrowserView` ownership;
- session resolution before view creation;
- routing model operations to the correct native view;
- state/event fanout;
- destruction semantics;
- keeping renderer code as a proxy rather than native owner.

**Cozea mapping**

- refactored/new main browser host service;
- `T3BrowserSurfaceService` orchestration boundary;
- browser IPC handlers.

---

## VS-004 — browser session ownership

**File**

`src/vs/platform/browserView/electron-main/browserSession.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserSession.ts

**Study for**

- Electron `Session` lifecycle separate from browser-view lifecycle;
- multiple browser views sharing one session deliberately;
- persistent versus in-memory sessions;
- session registry and stable context identity;
- session-level preload registration;
- permission/protocol configuration as session concerns.

**Do not copy**

- VS Code's exact global/workspace/agent policy;
- its trusted-file system without a separate Cozea requirement.

**Cozea mapping**

- `shared/browserSurfaceSessions.ts`;
- session/partition ownership currently embedded in `T3BrowserSurfaceService.ts`;
- proposed `BrowserSessionRegistry`.

---

## VS-005 — native device emulation

**File**

`src/vs/platform/browserView/electron-main/browserViewEmulator.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserViewEmulator.ts

**Study for**

- one authoritative device-emulation state;
- `webContents.enableDeviceEmulation()`;
- viewport/container/host-zoom relationships;
- touch/media/user-agent overrides;
- reapplying emulation after navigation;
- intercepting external CDP emulation so UI and automation do not fight;
- scaling automation input coordinates under emulation.

**Cozea mapping**

- `BrowserDeviceToolbar.tsx` remains UI;
- current `browserViewport*` state/actions are simplified;
- T3 `resize` and `setColorScheme` must converge on the same authoritative model.

---

## VS-006 — browser preload / keyboard bridge

**File**

`src/vs/platform/browserView/electron-browser/preload-browserView.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-browser/preload-browserView.ts

**Study for**

- deciding which keyboard input remains page-native;
- forwarding command-like shortcuts to the workbench;
- subframe preload behavior;
- keeping the preload small and isolated.

**Do not mechanically copy** VS Code command routing. Cozea has its own shortcut and preload contracts.

**Cozea mapping**

- existing preview picker preload;
- DevApp view preload;
- new native-browser shortcut bridge if required.

---

## VS-007 — workbench browser model contract

**File**

`src/vs/workbench/contrib/browserView/common/browserView.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView/common/browserView.ts

**Study for**

- lightweight workbench model proxy;
- model methods forwarding into main;
- state mirrored from main instead of inferred from DOM;
- renderer-side model lifetime separate from an editor component.

**Cozea mapping**

- proposed `BrowserSurfaceModel`;
- `browserSurfaceStateStore.ts` may become a model cache/event projection rather than browser ownership state.

---

## VS-008 — durable editor identity / lazy model resolution

**File**

`src/vs/workbench/contrib/browserView/common/browserEditorInput.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView/common/browserEditorInput.ts

**Study for**

- durable browser identity independent of mounted editor UI;
- lazy model resolution;
- browser metadata such as URL/title/favicon surviving editor churn;
- movement/copy/reopen semantics.

**Do not port the class.** Cozea's workbench tile records already provide durable identity.

**Cozea mapping**

- `runtimeTabId`;
- persisted workbench tile records;
- browser model registry.

---

## VS-009 — renderer/editor layout path

**File**

`src/vs/workbench/contrib/browserView/electron-browser/browserEditor.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView/electron-browser/browserEditor.ts

**Study for**

- the DOM `browser-container` as a positioning stub, not Chromium;
- `getBoundingClientRect()` at layout boundaries;
- contribution-driven layout overrides;
- `model.layout(bounds)`;
- visibility hooks;
- focus synchronization;
- avoiding a renderer-owned native browser object.

**Cozea mapping**

- replacement for `BrowserSurfaceSlot.tsx`;
- Dockview layout/position subscriptions;
- direct model → IPC bounds flow.

---

## VS-010 — WebContentsView renderer adapter

**File**

`src/vs/workbench/contrib/browserView/electron-browser/features/webContentsViewRendererFeature.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView/electron-browser/features/webContentsViewRendererFeature.ts

**Study for**

- isolating renderer-specific behavior behind a replaceable presentation adapter;
- placeholder screenshot behavior;
- native-surface occlusion handling;
- focus handoff;
- native keyboard event forwarding;
- physical-pixel snapping;
- visibility transitions;
- the explicit comment that an in-DOM iframe could replace this renderer contribution.

**Important:** port the state machine and responsibility boundaries, not necessarily its exact screenshot cadence.

**Cozea mapping**

- new Dockview-native browser renderer adapter;
- eventual future iframe renderer seam;
- replacement for global `ElectronBrowserHost` / `HostedBrowserWebview` presentation behavior.

---

## VS-011 — overlay detection

**File**

`src/vs/workbench/contrib/browserView/electron-browser/overlayManager.ts`

**Permanent link**

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/workbench/contrib/browserView/electron-browser/overlayManager.ts

**Study for**

- discovering workbench overlays;
- tracking overlay lifecycle with observers;
- rectangle overlap checks;
- hit-testing to determine the actually painted overlay;
- deciding when a native browser must be hidden.

**Do not copy VS Code CSS selectors.** Cozea must enumerate its own portal/dialog/menu/tooltip/toast/drag layers.

**Cozea mapping**

- new Cozea native-surface occlusion manager;
- `APP_LAYERS`/portal infrastructure;
- Dockview floating browser overlap behavior.

---

# 2. VS Code files that are intentionally NOT first-migration dependencies

These are useful references but are intentionally excluded from the first implementation so the agent does not expand scope.

## VS-X01 — CDP debugger transport

`src/vs/platform/browserView/electron-main/browserViewDebugger.ts`

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserViewDebugger.ts

**Why not port now:** T3 already owns Cozea's `WebContents.debugger` automation path. A second debugger architecture would create conflicts and unnecessary migration risk.

## VS-X02 — synthetic CDP browser group

`src/vs/platform/browserView/electron-main/browserViewGroup.ts`

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserViewGroup.ts

**Why not port now:** useful if Cozea later replaces T3 browser automation with Playwright/CDP grouping; not required to replace `<webview>` rendering.

## VS-X03 — group main service

`src/vs/platform/browserView/electron-main/browserViewGroupMainService.ts`

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/electron-main/browserViewGroupMainService.ts

**Why not port now:** same reason as VS-X02.

## VS-X04 — Playwright service

`src/vs/platform/browserView/node/playwrightService.ts`

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/node/playwrightService.ts

**Why not port now:** Cozea keeps T3 automation in the first migration.

## VS-X05 — Playwright page wrapper

`src/vs/platform/browserView/node/playwrightTab.ts`

https://github.com/microsoft/vscode/blob/e341a3c1515af84f5f679761d76a05a02af182cd/src/vs/platform/browserView/node/playwrightTab.ts

**Why not port now:** same reason as VS-X04.

---

# 3. Cozea baseline files — exact links

All links in this section are pinned to the app baseline used when the plan was authored.

## C-001 — current main browser/T3 integration

`apps/desktop/electron/services/T3BrowserSurfaceService.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/electron/services/T3BrowserSurfaceService.ts

**Migration role:** split browser ownership/session/view concerns from product/T3/DevApp policy. Preserve descriptor validation, navigation confinement, T3 state integration and DevApp bridging.

## C-002 — current renderer browser host

`apps/desktop/src/features/browser/ElectronBrowserHost.tsx`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/ElectronBrowserHost.tsx

**Migration role:** remove at final native cutover.

## C-003 — current renderer-owned browser implementation

`apps/desktop/src/features/browser/HostedBrowserWebview.tsx`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/HostedBrowserWebview.tsx

**Migration role:** source of behavior/parity requirements; remove after its browser lifecycle, viewport, overlay and crash responsibilities have moved to the new architecture.

## C-004 — current geometry slot

`apps/desktop/src/features/browser/BrowserSurfaceSlot.tsx`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/BrowserSurfaceSlot.tsx

**Migration role:** replace with a thin native-surface layout stub that sends deduplicated bounds directly to the browser model/main service rather than a global Zustand presentation store.

## C-005 — current presentation geometry store

`apps/desktop/src/features/browser/browserSurfaceStore.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/browserSurfaceStore.ts

**Migration role:** remove high-frequency browser geometry ownership. Retain only genuinely product-level state if still required.

## C-006 — current descriptor registry

`apps/desktop/src/features/browser/browserSurfaceRegistry.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/browserSurfaceRegistry.ts

**Migration role:** replace browser-lifetime registration with lightweight model/identity registration as needed.

## C-007 — current browser surface contracts

`shared/browserSurfaceTypes.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/shared/browserSurfaceTypes.ts

**Migration role:** evolve product descriptor/state contracts without making `BrowserSurfaceKind` synonymous with a rendering backend.

## C-008 — current storage partition rules

`shared/browserSurfaceSessions.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/shared/browserSurfaceSessions.ts

**Migration role:** preserve semantics exactly unless an explicit migration changes them.

## C-009 — current Dockview browser presentation adapter

`apps/desktop/src/features/browser/useDockviewBrowserSurfaceLayer.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/browser/useDockviewBrowserSurfaceLayer.ts

**Migration role:** retain Dockview position notifications; replace CSS browser stacking with native child-view ordering.

## C-010 — current Browser tile

`apps/desktop/src/features/workbench/WorkbenchBrowserTile.tsx`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/features/workbench/WorkbenchBrowserTile.tsx

**Migration role:** first canary surface. It becomes thin chrome + model wiring + native layout slot.

## C-011 — current T3 automation host

`apps/desktop/src/substrate/t3PreviewAutomationHost.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/apps/desktop/src/substrate/t3PreviewAutomationHost.ts

**Migration role:** preserve product-level target selection and T3 operations; replace DOM `<webview>` viewport introspection with a main/model API.

## C-012 — architecture test that currently forbids WCV

`tests/architecture/legacyBrowserRemoval.test.ts`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/tests/architecture/legacyBrowserRemoval.test.ts

**Migration role:** intentionally reverse and replace its old anti-WCV invariants before native implementation lands.

## C-013 — current architecture rule in AGENTS.md

`AGENTS.md`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/AGENTS.md

**Migration role:** remove the obsolete instruction forbidding `WebContentsView`; replace it with main-owned native browser invariants.

---

# 4. T3 fork — exact source references

## T3-001 — PreviewManager

`apps/desktop/src/preview/Manager.ts`

Pinned permanent link:

https://github.com/Cozea/t3code/blob/be4668f7b439499f39a659055d0f6ec34ac666b2/apps/desktop/src/preview/Manager.ts

**Study/change for**

- current `registerWebview(tabId, webContentsId)`;
- current `wc.getType() === "webview"` registration guard;
- current `hostWebContents` requirement;
- `webContents.fromId()` usage;
- debugger/control-session ownership;
- screenshot/recording/picker operations;
- zoom/audio/color-scheme state reapplication;
- page navigation and current-tab ownership checks.

**Required migration principle**

The T3 manager should accept a browser `WebContents` that was created and authenticated by Cozea main without weakening the invariant that an arbitrary process cannot register an arbitrary Electron `WebContents` as a controlled preview.

The API may be renamed from `registerWebview` to a backend-neutral name such as `registerBrowserContents` as part of the fork change. If renamed, generated contracts/adapters/tests and the parent integration must be changed coherently.

## T3-002 — pin documentation in parent repository

`docs/substrate-t3-pin.md`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/docs/substrate-t3-pin.md

**Migration role:** update after the reviewed T3 change is pushed and the parent gitlink moves.

## T3-003 — T3 runtime preparation

`scripts/prepare-t3-runtime.mjs`

https://github.com/Cozea/electron-app/blob/6f13aa8c2094052402b4aa47fed13d0bdc87ac65/scripts/prepare-t3-runtime.mjs

**Migration role:** use the existing pin validation/build path; do not bypass it with an untracked local T3 checkout.

---

# 5. Official Electron references

These links are documentation references, not implementation source to copy.

## E-001 — `WebContentsView`

https://www.electronjs.org/docs/latest/api/web-contents-view

Use for supported constructor/lifecycle/API behavior. Verify against Cozea's actual Electron version before relying on a newly documented method.

## E-002 — `View`

https://www.electronjs.org/docs/latest/api/view

Use for native view hierarchy concepts and child-view composition.

## E-003 — `BaseWindow`

https://www.electronjs.org/docs/latest/api/base-window

Use for `contentView` ownership and native child-view composition concepts. Cozea currently uses `BrowserWindow`; only the relevant inherited/native view concepts should be applied.

## E-004 — `webContents`

https://www.electronjs.org/docs/latest/api/web-contents

Use for navigation, focus, screenshots, debugger, emulation, input and lifecycle APIs.

## E-005 — Electron `<webview>` warning/current behavior

https://www.electronjs.org/docs/latest/api/webview-tag

Use only to understand the legacy primitive being removed. Do not use it as implementation guidance for the target native architecture.

---

# 6. Source-to-target implementation matrix

| Concern | Primary upstream reference | Cozea target | Port style |
| --- | --- | --- | --- |
| Browser identity/state contract | VS-001 | `shared/browserSurfaceTypes.ts` + new IPC/model types | Adapt |
| Native Chromium ownership | VS-002 | new `BrowserSurfaceView` | Port architecture substantially |
| Main registry/routing | VS-003 | main browser host service / refactored `T3BrowserSurfaceService` | Port architecture |
| Session ownership | VS-004 | `BrowserSessionRegistry` + current partition rules | Port architecture, retain Cozea policy |
| Device emulation | VS-005 | native emulator + existing Cozea UI | Port/adapt |
| Keyboard bridge | VS-006 | Cozea preview/DevApp preloads | Borrow behavior selectively |
| Renderer model | VS-007 | `BrowserSurfaceModel` | Port pattern |
| Durable identity | VS-008 | existing workbench tile + `runtimeTabId` | Keep Cozea implementation |
| Layout stub | VS-009 | thin Dockview-native slot | Adapt heavily |
| Native presentation/occlusion | VS-010 | native renderer adapter | Port state machine/pattern |
| Overlay discovery | VS-011 | Cozea overlay manager | Port concept, rewrite selectors |
| Agent automation | T3-001, not VS-X01..05 | existing T3 automation | Preserve + backend-neutral registration |
| DevApp worker bridge | C-001 | same main-owned WebContents | Preserve/adapt attachment |
| Browser recording | T3-001 + current Cozea recording | existing recording pipeline | Preserve |
| Dockview float order | C-009 | native child-view ordering | Cozea-specific |

---

# 7. Mandatory source-reading checklist for implementation agents

Before changing code in each phase, the implementing agent must read the corresponding source files. "Read" means inspect the actual pinned source, not rely on this summary.

## Before main-owned native browser foundation

Read:

- VS-001
- VS-002
- VS-003
- VS-004
- C-001
- C-007
- C-008

Checkpoint note must state the exact upstream symbols/patterns being adopted and the Cozea-specific differences.

## Before T3 registration migration

Read:

- T3-001
- C-001
- C-011

Checkpoint note must identify every webview-specific assumption found in T3 and classify it as `remove`, `generalize`, or `keep`.

## Before Dockview layout migration

Read:

- VS-009
- VS-010
- C-004
- C-005
- C-009

Checkpoint note must define the exact events that trigger bounds publication and the deduplication rule.

## Before overlay/focus migration

Read:

- VS-006
- VS-010
- VS-011
- Cozea's current portal/layer definitions

Checkpoint note must list every Cozea overlay category that can overlap a browser and how each is detected.

## Before device emulation migration

Read:

- VS-005
- current `BrowserDeviceToolbar.tsx`
- current viewport store/actions/layout files
- T3-001 emulation/color-scheme/input paths

Checkpoint note must name the one authoritative viewport/device state owner after the phase.

## Before final cutover/deletion

Re-read:

- C-002
- C-003
- C-004
- C-005
- C-006
- C-012
- C-013

Nothing is deleted until its behavior is demonstrably owned elsewhere and its parity checkpoint has passed.

---

# 8. Citation discipline for code comments and implementation docs

Do not scatter comments like `copied from VS Code` throughout Cozea source.

When an implementation detail is materially derived from a non-obvious upstream workaround or algorithm, record the permanent pinned source URL in the implementation PR description and, when future maintainers genuinely need the provenance to understand the workaround, in a concise source comment.

Examples that may justify a source comment:

- physical-pixel snapping needed to align a DOM placeholder with WCV bounds;
- an Electron-specific emulation workaround;
- an overlay transition sequencing workaround;
- a browser-focus workaround that would otherwise look unnecessary.

Routine concepts such as `WebContentsView.setBounds()` do not need provenance comments.

The resulting Cozea implementation must remain understandable on its own. These links are research/provenance anchors, not a substitute for naming and documenting Cozea's own invariants.

---

# 9. Source appendix completion checkpoint

This appendix is complete only when:

- [x] the VS Code repository revision is immutable;
- [x] every primary VS Code reference file has a commit-pinned direct link;
- [x] each primary file says what to study and what not to copy;
- [x] intentionally excluded VS Code automation files are listed so agents do not import them by accident;
- [x] Cozea baseline files have commit-pinned links;
- [x] the pinned T3 PreviewManager has a direct immutable link;
- [x] official Electron API references are listed separately from source-code provenance;
- [x] a source-to-target mapping explains where each upstream pattern belongs in Cozea;
- [x] each implementation phase has a mandatory source-reading checklist.
