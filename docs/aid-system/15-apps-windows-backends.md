# D15 — Application preparation, window targeting and qualified input routes

**Purpose:** provide reliable foreground bootstrap and explicit target selection before or after observations. **Baseline failures:** windowless Finder loop, sharing-indicator selection, PID-only keyboard/drag. **Sources:** NSWorkspace [S11](29-research-register.md#s11), AX [S12](29-research-register.md#s12), public input [S17](29-research-register.md#s17). Private SkyLight remains optional, source-derived compatibility code, not a public platform guarantee.

## 1. Application identity and preparation

An application handle contains verified bundle identity/path, PID, launch identity and grant scope. `aid.apps.get/list` are read operations. `aid.apps.prepare({app, launch, unhide, reopen, foreground})` is an explicit mutation capability that works before a screenshot exists. Resolve installed bundle identity using platform services, not shell `open` or a fuzzy first filename match.

Opening through NSWorkspace is asynchronous; verify the actual returned/running application and launch identity. Where SDK support permits, disallow unexpected running-application substitution when exact bundle identity matters. Activation is an attempt, not proof of focus. Wait on workspace/focus evidence within a bounded preparation deadline; return candidates or failure rather than clicking whatever became frontmost.

Do not call `NSApp.activate` to activate the target: in the driver that refers to the driver. Use the intended running application. Do not assume launching or reopening every app creates a standard document window.

## 2. Windowless bootstrap

A valid application-level grant can inspect the app menu bar and send an explicitly programmed, documented foreground shortcut such as new-window without a content screenshot. That resolves the circular requirement “need window to observe, need observation to create window.” A generic app preparation step may use launch/reopen, discovered menu actions or an explicit application shortcut; its receipt records which route was used.

There is no invented universal `AXCreateNewWindow`. If the app exposes no useful window/menu and refuses reopening, return `NO_USABLE_WINDOW` with available app state. The model may ask the user or choose another explicit capability, not secretly manipulate the filesystem and pretend window creation succeeded.

## 3. Candidate-first resolver

Collect viable AX window candidates and WindowServer candidates for the verified process. Match pairs by ownership, geometry, known window identity where available, role/subrole and title as supplemental evidence. Rank **pairs**, not “choose first AX window then hope it matches.” Cache the selected identity/generation and revalidate on every dependent action.

Prefer an explicit `windowId` handle supplied by the program. Otherwise return a unique focused content candidate if the evidence supports it. When several legitimate content windows remain, expose candidates with bounds/title/role/focus and require selection. Do not silently choose the largest window or the first dictionary entry.

Known capture sharing UI is excluded from default content selection using multiple properties—owned/system relationship, role/subrole, title/identifier and geometry pattern—recording the reason. The string `WindowSharingSessionButton` alone should not exclude a legitimate document with that title, and “smaller than100px” must never globally discard menus/popovers/dialogs. Small genuine windows remain addressable explicitly.

## 4. Scene lineage and blocking UI

Track parent/owner relations for sheets, menus, popovers and app-wide menu bars. A dialog can become the correct active target but does not inherit the document's old surface authorization. Selection/navigation APIs return new handles or focus lineage with explicit transitions. An unexpected modal invalidates pending document input until the program observes/selects it.

Focus validation covers frontmost PID, intended focused/main window evidence, relevant focused control and known occlusion. After an explicit activation, verify resulting state; after user takeover, stop rather than endlessly activating again. Window movement/resizing returns new geometry generation and invalidates in-progress held gestures under D11.

## 5. Backend selection

Define `DeviceBackend` methods for capability probe, preflight, prepare, submit and cleanup, returning precise route and submission certainty. Profiles are keyed by OS build, architecture, app/version, operation type, foreground/background state, input mode and observed qualification evidence. Supported symbols do not equal qualified application behavior.

Default routing:

- Unambiguous semantic control operation in `visible-ui`: qualified AX action, with visible causal pointer presentation when appropriate.
- Spatial pointer/keyboard/scroll/drag in foreground: qualified public system-event route.
- `physical-ui`: physical event route only; semantic substitution is disabled for validation.
- Explicit background mode: only qualified targeted routes, never silent foreground stealing.
- Optional SkyLight: eligible operations only, isolated SPI, precise diagnostics; never required for basic foreground completion.

A known pre-dispatch unsupported backend may fall through to another permitted route. Once any potentially effectful event/focus recipe is submitted, an uncertain response must not automatically switch and repeat. Capture/re-observe and let the program decide.

## 6. SkyLight treatment

Preserve source/provenance and isolate undocumented symbols/event fields. Diagnostics distinguish disabled-by-configuration, unsupported/untested OS, missing symbols, operation-ineligible and runtime failure. The old14–26 range is a compatibility policy, not proof that newer macOS blocks the framework. Changing that range requires live qualification, not merely successful `dlsym`.

The inherited dual-channel primer/focus recipe can produce application-specific behavior. Do not tune its sleeps from intuition or call it universally more deterministic. Record side-effect boundaries, best-effort release/synthetic-focus cleanup and all uncertain results. Foreground public input removes the need for this recipe on ordinary tasks.

## 7. Settings, policy and recovery

Replace the product concept “global pointer fallback” with an explicit control mode/consent model, while preserving deny/master-disable semantics during cutover. Ordinary users should not need to choose private backend names. Developers can select profiles for experiments; the visible UI reports active target, route category and qualification limitations.

App launch/window changes are real side effects and receive receipts. Do not mark all preparation read-only. App exclusions remain centralized for discovery and every alias-resolution route; public IDs are not exemptions. Hidden password-manager/browser-secret UI remains a privacy limitation covered in D19, not solved by a bundle list alone.

## 8. Implementation and acceptance

Evolve `AppDirectory` and `WindowRegistry` into separate application registry, candidate matcher, focus controller and scene-lineage service. Existing AX generation/WindowServer ownership checks remain useful. Extract backend profile/route logic from `ActionRouter` so all device classes use the same eligibility and certainty rules.

**WIN-01:** windowless Finder is prepared through UI-capable app operations. **WIN-02:** sharing indicator is excluded without rejecting legitimate small dialogs. **WIN-03:** multiple windows require explicit unambiguous selection. **WIN-04:** app/PID/window reuse invalidates handles. **WIN-05:** activation is verified and never calls the driver's own NSApp by mistake. **WIN-06:** modal lineage blocks old-surface input. **ROUTE-01:** all foreground device classes have qualified public paths. **ROUTE-02:** uncertain dispatch never causes automatic second-route input. **ROUTE-03:** private missing-symbol and OS-policy failures are distinct. **ROUTE-04:** mode/settings revoke immediately. G05/G06/G09 record actual Finder/Safari/drawing outcomes rather than inferring them from source builds.
