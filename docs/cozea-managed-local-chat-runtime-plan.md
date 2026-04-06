# Cozea-Managed Local Chat Runtime Plan

Status: Implementation in progress

Last updated: 2026-04-04

Owner: Codex + project team

## Implementation Snapshot

Current implementation status:

- Phase 1: completed
- Phase 2: partially completed
- Phase 3: in progress
- Phase 4: partially completed
- Phase 5: not started
- Phase 6: partially completed
- Phase 7: partially completed
- Phase 8: partially completed

Landed in the current pass:

- Electron now tracks local chat runtime status instead of assuming startup succeeded.
- The preload bridge now exposes runtime status to the renderer in addition to the WebSocket URL.
- The workbench chat tile now waits for runtime readiness before trying config loads and snapshot sync.
- The workbench chat tile now shows explicit starting and unavailable runtime states instead of only “syncing.”
- Electron and the renderer bridge now emit explicit local chat bridge lifecycle logs for runtime start, readiness, reuse, reconnects, and restart scheduling.
- The renderer WebSocket bridge now makes its singleton reuse explicit, so switching projects or adding agent tiles reuses the existing app-lifetime bridge instead of creating a new one.
- The assistant runtime status IPC bridge is now registered eagerly and idempotently in Electron main so preload can query runtime status without waiting for later app setup steps.
- Renderer-side native API and WebSocket bridge singletons now live on `window`, not only in module scope, so they survive module churn and behave more like true app-lifetime bridges.
- Desktop runtime boot now provides the same startup service layer expected by the CLI path, fixing the missing `CliConfig` service failure during Electron-managed startup.
- Runtime exit monitoring now attaches after the fiber is assigned in Electron main, fixing a race where a fast crash could leave a dead fiber cached and block real restart attempts.
- A focused regression test now locks down the desktop chat runtime wiring, covering startup layer provisioning, eager bridge registration, and safe runtime fiber replacement.
- The runtime sqlite client now uses the installed Effect package's real reactivity entrypoint, fixing the `effect/dist/Reactivity.js` module-resolution crash during Electron-managed startup.
- Workbench config hydration now does one initial `server.getConfig()` load and then patches local state from runtime push events instead of repeatedly refetching full config on every update.
- Desktop dev smoke now reaches `runtime-ready` after migrations and orchestration startup, confirming the Electron-managed bridge can bring the local chat runtime up successfully.
- The workbench agent binding effect no longer self-cancels on its own config/store updates, which prevents duplicate thread creation loops before the tile can persist its assigned `threadId`.
- Multi-agent workbench binding now treats `assistantProjectId` and `threadId` as binding outputs rather than effect triggers, so adding a second agent for the same workspace no longer leaves the new tile stuck in a permanent “binding” state after its thread is created.
- The visible chat shell has been extracted into a reusable `CozeaChatSurface` component, and the workbench tile now acts more like a runtime-aware host than the whole chat app.
- The extracted chat surface now uses the canonical `MessagesTimeline` rendering stack, T3-style composer header states for approvals and user-input prompts, image expansion, and checkpoint revert wiring instead of the earlier custom summary-card message view.
- The workbench composer shell now uses the older Cozea visual structure again for the input area itself: centered compact width, soft rounded container, plain prompt region, and a distinct controls row underneath while preserving the current local-runtime chat behavior.
- The composer layout has been tuned further toward the historical Cozea input spacing: more bottom inset from the tile edge, model selection kept in the primary shell row, and the chat/access pills restored to a separate secondary row beneath the input.
- The secondary composer row now matches the old Cozea hierarchy more closely by carrying the chat/access pills on the left and the context-window display on the right instead of keeping usage inside the primary input row.
- The shared composer editor now forces long placeholder copy to stay on a single truncated line instead of wrapping to a second line inside the Cozea-style input shell.
- The shared timeline now omits per-message timestamps entirely for both user and assistant messages, keeping the older Cozea-style message presentation cleaner while preserving the lightweight user-message actions row outside the pill.
- The user-message action controls now use the same quiet ghost-hover language as the secondary composer controls instead of always-visible outlined icon containers.
- The assistant changed-files summary card now uses the same borderless `bg-secondary` surface as the composer shell, so follow-up detail blocks feel visually tied to the input system instead of floating on a separate card treatment.
- The changed-files header actions are now icon-only ghost controls with tooltips/labels instead of full text buttons, reducing visual weight and aligning them with the rest of the Cozea chat controls.
- Fresh assistant tiles now mirror T3’s first-send title behavior: the first user prompt immediately becomes the thread title in the runtime and the Dockview header/tab, instead of leaving tiles stuck on generic labels like `AI Agent 2`.
- Claude sessions now flow their SDK session summaries back through the same normalized `thread.metadata.updated` runtime event used by Codex, so later CLI-supplied thread renames propagate into Cozea thread state and tile headers instead of stopping at the first-prompt seed title.
- The imported chat primitives now resolve through Cozea’s real folder layout again, including local alert wrappers, proposed-plan helpers, clipboard helpers, theme resolution, and native API paths, so the shared chat surface can boot in Vite without the copied T3 import drift.
- Cozea now has an assistant-side UI compatibility layer for the imported chat primitives, covering button sizes/variants, alerts, dialogs, command menus, grouping, toggles, sidebar trigger access, and toast calls that the original T3 components expect.
- The active assistant UI primitives are being replaced with direct T3-style implementations instead of thin Cozea wrappers, including `button`, `badge`, `input`, `alert`, `toggle`, `menu`, `popover`, `tooltip`, `group`, `scroll-area`, `autocomplete`, `command`, `dialog`, and the real Base UI toast manager/provider.
- The markdown renderer now treats `@pierre/diffs` highlighter contracts as type-only imports, matching the actual runtime export surface and preventing Vite from crashing on nonexistent JS exports like `DiffsHighlighter`.
- The shared chat markdown renderer now imports its LRU cache from the canonical assistant library path instead of the old stubbed store cache, keeping the port on the real T3-derived implementation.
- The shared chat markdown renderer also now imports diff theme/hash helpers from the canonical assistant diff utility instead of the stubbed global diff store, preventing Vite crashes on missing exports like `fnv1a32`.
- The imported chat timeline/rendering stack now consistently uses type-only imports for TS-only contracts such as `ExpandedImagePreview`, preventing Vite from looking for nonexistent runtime exports during the port.
- The assistant tile chrome now derives its visible title from the live chat thread and shows activity/loading state beside that title instead of inside a separate status strip.
- Duplicate `assistant/` utility files that matched `assistant/chat/` byte-for-byte now re-export the canonical `assistant/chat/` modules instead of carrying separate copies.
- The first Cozea branding pass removed leftover inherited runtime strings from provider status, Codex app-server metadata, and checkpoint commit metadata.
- The dead legacy `agentChat` store path and its stale Electron API surface were removed.
- Workbench persistence is now scoped to `projectId + laneId`, so each lane keeps its own Dockview layout, active tile, and tile inventory instead of sharing one project-wide workspace state.
- The project sidebar now renders a multilevel Cozea tree modeled on T3’s compact hierarchy: current-project header, active-lane chip, quick add actions, then projects -> lanes -> agents/surfaces with lane switching wired to real workbench state.
- Lane rows now derive their agent/surface contents from the persisted lane-scoped workbench, so agent thread titles, provider icons, and active tool rows survive route changes and lane switches.
- Sidebar lane navigation now opens the correct project workbench, switches the active lane through Electron first, and can focus an existing tile or spawn a new one through workbench route params.
- The new sidebar tree now subscribes to lane-scoped workbench state through a shallow-memoized selector, fixing the React/Zustand infinite render loop caused by returning a fresh lane-workbench object on every render.
- The native workbench browser now keeps the requested URL authoritative while a navigation is in flight, preventing stale `did-start-loading` state from echoing the previous URL back into the store and causing repeated browser refresh loops.
- The integrated workbench browser now has a native find-in-page session and browser-keyboard command bridge closer to VS Code: `Cmd/Ctrl+F` opens a real find widget with live match counts, `Cmd/Ctrl+L` focuses the URL bar, native browser focus can still trigger find/url commands through Electron, and browser-local reload/back-forward/find-next/zoom shortcuts now work even when focus is inside the page itself.
- The Cozea project sidebar has been simplified to rely on the existing selection/highlight model instead of redundant project/lane summary cards: quick-create actions stay in the header, the standalone workbench button is removed, project settings/sync now live in per-project overflow menus, and lane refresh now lives in the active lane row menu.
- The project navigation is now visually closer to T3’s sidebar language: favicon-or-folder project marks, flatter menu-row geometry, hover-revealed row actions, quieter uppercase section labels, softer active fills, and lightweight inline status indicators instead of heavier chip/card treatments.
- The sidebar now enforces a single active target at a time with route-aware priority: visible agent/surface rows win on workbench, otherwise the active lane row is highlighted on empty workbench states, and only non-workbench project pages highlight the project row.
- The current project row in the sidebar now reuses the same branch-switching dropdown pattern as the workbench header, so branch/lane switching stays consistent instead of introducing a separate static branch display just for navigation.
- The sidebar navigation has since been simplified again to keep lanes explicit as collapsible rows under each project, removing the experimental project-row lane selector and restoring the clearer project -> lanes -> agents/surfaces hierarchy.
- Lane rows are now real disclosures with per-lane open state and centered single-line metadata, so the chevron reflects actual expansion instead of acting like a decorative branch marker.
- Sidebar project icons now preserve their original image aspect ratio instead of being visually rounded into a square badge treatment.
- Workspace switching has been folded into the bottom user menu so both the global app sidebar and the project sidebar can drop the redundant top workspace-switcher control.
- The bottom user menu’s workspace switch action now opens through a real Electron-backed native context menu, backed by a newly wired generic `showContextMenu` bridge instead of an inline custom list.
- Project creation now runs through one shared modal instead of the old prompt/build flow: empty projects create a connected GitHub remote up front, repository import browses connected repos first, local-folder import now requires or provisions a remote before saving, and the new flow promotes created projects straight into active workbench state instead of leaving them in the old draft-only path.
- Workspace and team settings routes now share a dedicated route-level settings shell that mirrors the user-settings drawer language, grouping supported surfaces under `Workspace` and `Team` while automatically collapsing personal workspaces down to the smaller relevant set.

## Goal

Port everything required for local multi-agent chat to run inside Cozea as a first-class, Cozea-managed system.

This plan covers two linked outcomes:

1. Make the local chat runtime architecture complete and reliable inside the workbench.
2. Refactor the current assistant path to remove unnecessary code, duplicate utilities, stale compatibility layers, and leftover foreign branding.

## Guardrails

- Local-first execution stays non-negotiable.
- Primary chat inference continues through on-machine CLIs and local provider runtimes.
- Convex and the Fastify backend remain product infrastructure, not the primary paid AI execution path.
- Workbench tiles stay native to Dockview.
- We do not grow the current half-ported tile shell further. We replace it with a proper Cozea chat surface and a thin workbench host.

## Deep Study Summary

### What is already strong and worth keeping

The repo already contains a substantial local chat backend and contract stack:

- `electron/assistant-runtime/`
- `shared/assistant-contracts/`
- `shared/assistant-shared/`
- `src/lib/nativeApi.ts`
- `src/lib/wsNativeApi.ts`
- `src/stores/assistant-wsTransport.ts`
- `src/stores/assistant-store.ts`
- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`

The repo also already contains reusable chat UI primitives that should become the canonical surface instead of staying partially orphaned:

- `src/features/projects/components/assistant/chat/ChatHeader.tsx`
- `src/features/projects/components/assistant/chat/MessagesTimeline.tsx`
- `src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx`
- `src/features/projects/components/assistant/chat/ProviderModelPicker.tsx`
- `src/features/projects/components/assistant/chat/ContextWindowMeter.tsx`

The workbench already has the right multi-agent persistence direction:

- `src/stores/useProjectWorkbenchStore.ts`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- `src/features/projects/pages/ProjectWorkbenchPage.tsx`

### Main problems discovered in the current implementation

#### 1. Runtime boot is not supervised enough

Current boot is optimistic:

- `electron/main.ts` marks the runtime as started immediately after calling `startAssistantRuntime()`.
- There is no readiness handshake before the renderer starts using the WebSocket URL.
- There is no strong restart or degraded-state path if startup fails before the server binds.

This is the main reason the renderer can end up in endless reconnect and “syncing” loops.

#### 2. Renderer transport hides runtime failure too aggressively

Current behavior is too silent:

- `src/stores/assistant-wsTransport.ts` reconnects forever.
- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts` swallows snapshot refresh failures.
- `WorkbenchAssistantChatTile.tsx` can show “Syncing local runtime” when the runtime is actually unavailable.

Important clarification from the study:

- The current loop is not “syncing local history forever.”
- `src/stores/assistant-store.ts` only persists small renderer preferences like project expansion/order.
- The visible loop is repeated failed config and snapshot fetches against a dead or unavailable runtime.

#### 3. The workbench tile is too monolithic

`src/features/projects/components/workbench/WorkbenchAssistantChatTile.tsx` currently owns:

- workspace binding
- project/thread lifecycle bootstrapping
- config loading
- message rendering
- composer behavior
- request dispatch
- approval/user-input handling
- diff modal behavior
- tile chrome status logic

That is too much responsibility for a tile host. It makes the port fragile and blocks a clean reuse path for other surfaces.

#### 4. The assistant UI path contains duplicated code

The assistant path currently has duplicate utility modules in both:

- `src/features/projects/components/assistant/`
- `src/features/projects/components/assistant/chat/`

Examples confirmed in the study:

- `chat-scroll.ts`
- `composerInlineChip.ts`
- `timelineHeight.ts`
- `timestampFormat.ts`
- `turnDiffTree.ts`
- `types.ts`
- `session-logic.ts`

Some are direct copies. Some are re-export shims. Together they make the source of truth unclear.

#### 5. Old chat-era residue still exists

There is still legacy residue from the older Electron-local chat path:

- `src/stores/useAgentChatStore.ts`
- `shared/electronApiTypes.ts` still declares `agentProvider` and `agentChat`

The code search shows the new local runtime path is the real backend now, while these older pieces remain as misleading leftovers.

#### 6. Import and naming drift increased during the half-port

The current assistant/chat path mixes:

- `@/`
- relative imports
- `~/` imports in copied files

There are also still leftover T3-branded strings in runtime/provider/checkpointing code and tests that need to be removed in the final Cozea-owned path.

#### 7. Some earlier docs are now stale

The current architecture docs still reference older services that are no longer present. The new plan needs to become the single source of truth for the local chat migration.

## Architectural Decision

We will not replace Cozea with a separate app model.

We will keep the current Cozea desktop product shell and port the full local chat stack into a clean Cozea-managed architecture by:

- retaining the local orchestration/runtime core that already exists
- hardening runtime boot and transport readiness
- extracting a reusable chat surface from the current assistant UI pieces
- turning the workbench tile into a thin host
- deleting legacy chat residue and duplicated assistant-path utilities
- renaming the ported system so it reads as Cozea-owned rather than inherited

## Target Architecture

### Layer 1: Cozea Local Chat Runtime

Canonical responsibility:

- local provider registry
- local CLI lifecycle
- orchestration commands/events
- project/thread persistence
- approvals and user-input requests
- attachments
- checkpoints and diffs
- thread terminal integration
- provider status/config

Current basis:

- `electron/assistant-runtime/`

Target outcome:

- this becomes the single local runtime authority for chat
- no parallel `agentChat` or `agentProvider` path remains

### Layer 2: Cozea Desktop Chat Bridge

Canonical responsibility:

- start and supervise the local runtime
- expose the runtime endpoint and readiness state to renderers
- translate runtime availability into stable preload APIs

Current basis:

- `electron/main.ts`
- `electron/preload.ts`

Target outcome:

- renderer never guesses whether the runtime is alive
- endpoint, readiness, and failure state come from one bridge

### Layer 3: Cozea Chat Client

Canonical responsibility:

- WebSocket transport
- connection state
- config/snapshot fetching
- domain-event subscription
- normalized error handling
- read-model hydration into renderer state

Current basis:

- `src/lib/nativeApi.ts`
- `src/lib/wsNativeApi.ts`
- `src/stores/assistant-wsTransport.ts`
- `src/stores/assistant-store.ts`
- `src/features/projects/components/workbench/useAssistantRuntimeSync.ts`

Target outcome:

- one explicit client for local runtime interaction
- no silent retry loops that mask offline state

### Layer 4: Cozea Chat Surface

Canonical responsibility:

- thread header
- timeline
- composer
- approvals
- user-input prompts
- proposed plans
- context window display
- diff and terminal affordances

Current basis:

- `src/features/projects/components/assistant/chat/*`

Target outcome:

- one reusable chat surface component tree
- workbench tile becomes a thin wrapper around this surface

### Layer 5: Cozea Workbench Chat Host

Canonical responsibility:

- map workbench project path to runtime project
- map one tile to one thread
- persist tile metadata
- duplicate/open/focus tiles

Current basis:

- `src/stores/useProjectWorkbenchStore.ts`
- `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- `src/features/projects/pages/ProjectWorkbenchPage.tsx`

Target outcome:

- multi-agent behavior stays native to the workbench
- chat UI logic is no longer trapped in the tile host

## What Must Be Ported Fully For Chat To Run

The final Cozea chat system must cover all of the following, not just the composer UI:

- runtime boot and readiness
- runtime config loading
- provider discovery and status refresh
- workbench project -> runtime project binding
- tile -> thread ownership
- prompt send
- streaming assistant output
- interrupt
- approvals
- user-input responses
- model/provider/runtime/interaction switching
- image attachments
- context window tracking
- proposed plans and plan-mode state
- checkpoint diff retrieval
- terminal event integration
- restart-safe persistence and rehydration
- multiple simultaneous agent tiles
- clear offline/degraded runtime UX

## Keep / Replace / Remove

### Keep as canonical

- `electron/assistant-runtime/` runtime core and orchestration model
- `shared/assistant-contracts/` and `shared/assistant-shared/` semantics
- multi-agent workbench tile persistence in `useProjectWorkbenchStore`
- reusable chat primitives under `src/features/projects/components/assistant/chat/`

### Replace or reshape

- `WorkbenchAssistantChatTile.tsx`
  - replace with a thin tile host + extracted chat controller/surface
- runtime boot in `electron/main.ts`
  - replace fire-and-forget startup with supervised readiness-aware startup
- `assistant-wsTransport.ts`
  - keep core transport idea but add explicit connection status and failure semantics
- `useAssistantRuntimeSync.ts`
  - stop silent failure behavior and bind sync to real connection state

### Remove after the new path is stable

- `src/stores/useAgentChatStore.ts`
- unused `agentProvider` and `agentChat` contract surface in `shared/electronApiTypes.ts`
- duplicate assistant utility files where one copy can become canonical
- temporary compatibility shims added only for the partial UI port
- stale docs that describe non-existent local chat services
- leftover T3-branded strings in runtime/user-visible copy/tests

### Audit before removing

- `providerAuth`
- `localAiRuntime`

These may still matter elsewhere in the app, but they should not remain ambiguous with the local chat runtime path.

## Naming And Branding Plan

The final system should read as Cozea-owned everywhere the user or the codebase sees it.

### User-facing naming

- replace leftover “T3 Code” strings with Cozea wording
- rename desktop/runtime labels to Cozea equivalents

### Codebase naming

Recommended end state:

- `electron/assistant-runtime/` -> `electron/chat-runtime/` or `electron/cozea-chat-runtime/`
- `shared/assistant-contracts/` -> `shared/chat-contracts/`
- `shared/assistant-shared/` -> `shared/chat-shared/`
- `src/features/projects/components/assistant/` -> `src/features/projects/components/chat/`

Recommended rollout strategy:

- first stabilize behavior under the current paths
- then do the mechanical namespace rename with tests in place

This avoids mixing runtime stabilization bugs with mass-move rename churn.

## End-To-End Plan

## Phase 0: Freeze The Source Of Truth

Goal:

Use this document as the implementation source of truth.

Actions:

- Review and approve the target architecture in this document.
- Record deviations here instead of letting ad hoc notes drift elsewhere.
- Treat the older T3-named workbench plan as superseded.

Exit criteria:

- The team approves this plan before implementation begins.

## Phase 1: Runtime Boot, Supervision, And Readiness

Goal:

Make the local runtime either available or explicitly unavailable, never ambiguously “syncing.”

Current implementation update:

- Electron now owns a real runtime status machine with `idle`, `starting`, `ready`, and `error` phases instead of assuming that `startAssistantRuntime()` succeeded.
- The preload bridge exposes runtime status through `assistantRuntime:getStatus` and the matching status event channel, and that IPC registration now happens eagerly and idempotently in Electron main.
- Desktop startup now provides the same service layer stack that the CLI runtime path expects, which fixed the missing `CliConfig` dependency failure that previously killed the runtime before it bound its WebSocket port.
- Runtime exit monitoring now attaches only after the live fiber is assigned in Electron main, which fixed a fast-crash race that could leave a dead fiber cached and block real restart attempts.
- Electron and the renderer now emit shared `[CozeaChatBridge]` lifecycle logs so runtime boot, readiness, restart scheduling, and bridge reuse can be debugged from one timeline.
- The desktop runtime persistence layer now imports Effect reactivity from the package entrypoint that actually exists in this repo version, which resolves the repeated `Cannot find module ... effect/dist/Reactivity.js` startup failure.

Actions:

- Replace optimistic `ensureAssistantRuntimeStarted()` behavior with supervised startup.
- Add a readiness handshake before renderer config/snapshot requests run.
- Surface runtime status to the renderer through preload instead of a static default-only URL contract.
- Add restart/backoff behavior if runtime startup dies after Electron boots.
- Capture startup errors in a user-actionable form.

Exit criteria:

- Renderer can reliably distinguish `connecting`, `ready`, `offline`, and `failed`.
- Dead runtime no longer looks like endless sync.

## Phase 2: Transport And Read-Model Consolidation

Goal:

Make the renderer-side local chat client explicit and dependable.

Current implementation update:

- The renderer-side native API and WebSocket client are now stored as explicit app-lifetime singletons on `window`, which makes bridge reuse visible and prevents accidental per-tile bridge churn during module reloads or project switching.
- Workbench config hydration now performs one initial `server.getConfig()` request and then patches local state from runtime push events, instead of repeatedly refetching the full config on every update.
- The workbench binding flow now depends only on binding-relevant tile/runtime inputs, so internal snapshot and config updates no longer interrupt thread assignment mid-flight.

Actions:

- Consolidate connection state handling in the WebSocket client layer.
- Add connection listeners or a small connection-state store instead of hiding transport state inside `WsTransport`.
- Update config loading and snapshot refresh to respect runtime readiness.
- Stop swallowing runtime sync failures in the global sync hook.
- Ensure the assistant store persists only renderer-local UI preferences, not misleading “history sync” semantics.

Exit criteria:

- Chat surfaces can render accurate runtime state without guessing.
- The transport contract is usable by both workbench and future non-workbench surfaces.

## Phase 3: Extract A Real Cozea Chat Surface

Goal:

Stop using the workbench tile as the main chat implementation.

Current implementation update:

- `WorkbenchAssistantChatTile.tsx` now keeps runtime/project/thread binding and command dispatch logic, while the visible chat UI lives in `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx`.
- The extracted surface now owns the real `MessagesTimeline` path, provider/error banners, approval and user-input composer states, image expansion, and checkpoint revert affordances instead of the earlier inline bubble and summary-card rendering.
- This phase is still in progress because the workbench host still owns some surface-facing controller logic and the tile is not yet using the broader `ChatHeader`/terminal/diff shell from the full desktop chat experience.

Actions:

- Build a dedicated Cozea chat surface component from the existing primitives.
- Move message rendering onto `MessagesTimeline`.
- Move header actions onto `ChatHeader`.
- Keep the T3-inspired composer behavior, but make it Cozea-owned and fully integrated.
- Extract chat commands, approval actions, user-input handling, and diff actions into controller hooks instead of keeping them inline in the tile file.

Exit criteria:

- The workbench tile mostly hosts and wires the chat surface.
- The chat surface is reusable outside the current tile if needed.

## Phase 4: Full Workbench Integration

Goal:

Make the workbench host responsible only for workbench concerns.

Current implementation update:

- The assistant tile chrome now reflects live chat state more directly: the visible tile title follows the bound thread title, and loading/running state is surfaced beside that title in the chrome.
- The workbench host now delegates message representation, turn diff opening, thread-error dismissal, and checkpoint revert initiation into the shared chat surface instead of rendering tile-specific summaries for those states.

Actions:

- Keep one tile -> one thread ownership.
- Keep workbench project -> runtime project binding explicit.
- Preserve multi-agent duplication/open behavior.
- Thread terminal and diff affordances through the reusable chat surface instead of custom tile-only logic.

Exit criteria:

- Multiple agent tiles behave independently and persist cleanly.
- Chat UI behavior is no longer buried inside a tile implementation.

## Phase 5: Runtime Feature Completion

Goal:

Ensure the final Cozea-managed path supports the whole local chat feature set.

Actions:

- Validate prompt send/stream/interrupt flows.
- Validate approvals and user-input response flows.
- Validate attachment persistence and preview URLs.
- Validate plan mode and proposed-plan rendering.
- Validate checkpoint diff retrieval and display.
- Validate thread terminal integration and runtime project scripts.
- Validate provider/model/runtime/interaction switching against the runtime contract.

Exit criteria:

- The Cozea chat path supports all features currently expected from the local agent workflow.

## Phase 6: Assistant-Path Refactor And Cleanup

Goal:

Remove duplicated and unnecessary code once the new path is stable.

Current implementation update:

- The duplicated `assistant/session-logic`, `assistant/chat-scroll`, `assistant/timelineHeight`, `assistant/timestampFormat`, `assistant/turnDiffTree`, and `assistant/types` files now act as thin re-export bridges to the canonical `assistant/chat/` modules.
- This cleanup is intentionally intermediate: the old import surface still exists for compatibility, but the duplicated logic bodies are gone.

Actions:

- Collapse duplicate `assistant/` and `assistant/chat/` utility files down to one source of truth.
- Normalize imports to one alias style.
- Delete legacy `useAgentChatStore`.
- Remove unused `agentChat` and `agentProvider` interfaces if the audit confirms they are dead.
- Remove compatibility wrappers added only to make the partial port compile.
- Update stale docs to point at the Cozea local chat runtime architecture.

Exit criteria:

- The assistant/chat code path has one source of truth for each concern.
- Dead code and stale abstractions are removed rather than merely bypassed.

## Phase 7: Cozea Naming Pass

Goal:

Finish the rename from inherited naming to Cozea-owned naming.

Actions:

- Replace leftover T3-branded strings in runtime/provider/checkpointing/user-visible copy.
- Rename paths and namespaces from `assistant` to `chat` where approved.
- Keep temporary re-export bridges only if needed for a short migration window.

Exit criteria:

- The shipped system reads as Cozea-owned in user-facing copy and code organization.

## Phase 8: Verification And Rollout

Goal:

Ship the architecture change safely.

Current implementation update:

- `tests/assistantChatRuntimeImports.test.ts` now verifies that desktop runtime boot still provides the startup layer expected by the runtime program, registers the runtime-status IPC bridge before app readiness, and clears cached runtime fibers safely on exit.
- The same focused runtime wiring test now also verifies that the sqlite client uses the installed Effect reactivity import path, so the Electron-managed runtime does not regress back to the missing-module crash.
- Manual desktop dev verification now shows the full bridge startup sequence reaching `runtime-ready` instead of restart-looping on runtime boot errors.

Actions:

- Add runtime boot smoke coverage.
- Add transport connection-state coverage.
- Add workbench multi-agent smoke coverage.
- Add tests for prompt send, interrupt, approvals, user-input responses, and diff retrieval.
- Run manual desktop checks for runtime-unavailable behavior.

Manual acceptance checklist:

- Open project workbench.
- Create two agent tiles.
- Both tiles bind to the same workspace without fighting each other.
- Send a prompt and receive a streamed response.
- Interrupt a running turn.
- Complete an approval flow.
- Complete a user-input flow.
- Open a diff for a completed turn.
- Restart the app and recover tile/thread bindings.
- Kill the runtime or force it offline and confirm the UI shows an explicit offline/degraded state instead of endless syncing.

Exit criteria:

- Local chat works end to end inside Cozea.
- Workbench multi-agent flows are stable.
- The assistant path is substantially smaller and clearer than today.

## Success Criteria

- Cozea has one clear local chat runtime architecture.
- Multi-agent workbench chat works end to end without cloud inference routing.
- Runtime startup and failure states are explicit and actionable.
- The workbench tile is a thin host, not the whole chat app.
- Duplicate assistant-path utilities are collapsed.
- Legacy `agentChat` residue is removed.
- T3-branded wording is gone from the shipped local chat path.

## Recommended Implementation Order

To minimize risk, implementation should happen in this order:

1. Runtime supervision and readiness
2. Transport/read-model cleanup
3. Chat surface extraction
4. Workbench host slimming
5. Feature-complete validation
6. Dead-code removal
7. Naming/path rename pass

This order keeps behavior stabilization ahead of mechanical cleanup.
