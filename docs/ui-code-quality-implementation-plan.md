# UI code quality and performance implementation plan

Status: implemented on `codex/ui-code-quality`; see `docs/ui-code-quality-completion.md` for the finding ledger, validation, and residual limits.

Source baseline: local merge `c7442654`, integrating typography/UI from `deb92d01` while retaining the repaired navigation runtime from `aa9e3712`. Revalidate against the checkout at execution time. Existing edits in SettingsSidebar and lastWorkbenchRoute, and the dirty T3 submodule, belong to other work and must be preserved.

## Outcome and scope

Establish one UI foundation, explicit feature ownership, predictable state lifetimes, and bounded work during editing, streaming, loading, and layout. Preserve the current desktop product and its recent visual decisions.

This program covers the 21 findings from the UI source audit. It is not a security audit, a product redesign, a dependency upgrade, or a restoration of the rejected `revamp` branch. It does not claim that these findings explain the reported jitter. Broader interaction changes require separate evidence.

The deliverable is a sequence of small, independently reviewable changes with behavior and resource-use evidence. A file-count reduction or a passing source-string test is not acceptance evidence by itself.

## Evidence and priorities

Source findings are confirmed at the audited baseline; runtime impact is unmeasured unless stated otherwise. The isolated draft-repository experiment produced 200 storage writes for 100 paired text/cursor changes. It used an in-memory adapter, not real user drafts or disk timing.

| ID | Finding | Implementation phase | Priority |
| --- | --- | --- | --- |
| F01 | Shared and assistant primitives have divergent implementations | P05 | High |
| F02 | Custom theme classes do not match normal dark variants | P06 | High |
| F03 | Task context assumes `convex/schema.ts` exists | P01 | High |
| F04 | Layout duplicates font metrics and pixel overhead | P07 | Medium |
| F05 | Launcher creates new layout state for equivalent results | P07 | Medium |
| F06 | New artifacts trigger whole-set URL requests | P03 | High |
| F07 | Service runtime polling is owned independently by tiles | P03 | High |
| F08 | Large chat/workbench modules mix unrelated responsibilities | P09 | High |
| F09 | Shared utilities import feature-owned UI and helpers | P08 | Medium |
| F10 | Primitive compatibility wrappers bypass types | P05 | Medium |
| F11 | Hardcoded copy and translation type escapes coexist | P06 | Medium |
| F12 | Typography documentation and token usage drift | P06 | Medium |
| F13 | Composer edits enqueue redundant full-record writes | P02 | High |
| F14 | Question edits synchronously read/write localStorage | P02 | High |
| F15 | Cache throttle can discard the final update | P01 | High |
| F16 | Message projection walks full histories on message updates | P04 | High |
| F17 | Inactive conversation details lack bounded eviction | P04 | High |
| F18 | Unused assistant hook extractions remain beside active code | P08 | Medium |
| F19 | Skills pages have a runtime import cycle | P08 | Medium |
| F20 | Route loaders are repeated outside the warming registry | P08 | Medium |
| F21 | Some lifecycle tests assert source text instead of behavior | P10 | High |

Raw counts such as 226 arbitrary pixel text utilities and 21 files over 1,000 lines identify review areas; they are not mandatory deletion quotas. Preserve intentional differences and useful large modules where their responsibilities are cohesive.

## Architectural decisions

1. `components/ui/` owns domain-neutral primitives. Feature components compose them. Temporary assistant re-exports may preserve import compatibility, but may not contain a second styling or behavior implementation.
2. `app/` owns application composition, route loading, and shared resource coordination. `features/<name>/` owns domain controllers, state, services, and presentation. `lib/` and generic `hooks/` may not depend on feature UI.
3. Feature boundaries expose narrow entry points. Move a utility because of its consumers and responsibility, not merely to fit a folder naming scheme. Avoid broad barrel files that eagerly import whole features.
4. Theme identity and color mode are distinct: retain the selected palette identity and expose a common light/dark mode marker. One resolver drives CSS, terminal colors, and timeline presentation, including first paint.
5. Editable state updates immediately in memory. Persistence has explicit transaction, coalescing, flush, failure, and recovery contracts. Server/runtime state remains authoritative for transcripts and execution.
6. Runtime resources have an identity, a shared owner, reference-counted demand, and explicit cleanup. Presentation visibility alone must not stop a running service or agent.
7. Performance claims require operation counts or measurements on representative data. Preserve immutable identities where meaningful, without introducing stale selectors or skipping required lifecycle updates.

## Invariants throughout the work

- Retain the repaired keep-alive/navigation ownership and the single hosted browser architecture. Preserve provider policies, tile identities, live subscriptions, terminal sessions, and Chat/Artifacts controller lifetime.
- Keep 13px primary text, 12px secondary text, 10px counters, 22px Settings titles, 28px titlebar controls, and 36px search fields unless a documented component exception already applies.
- Tile closure and project archival must not delete drafts, attachments, history, or server-owned transcripts.
- A send acknowledgment clears only its captured content revision. Uncertain sends remain recoverable and are never automatically resent.
- Draft adoption, pending submission identity, storage failure recovery, and history-switch flush semantics remain intact.
- Migrations are additive and recoverable. Never erase old local records before verified new storage commits.
- Do not change Convex schema, authentication, Electron main, provider protocol, Effect pins, or T3 bootstrap as an incidental cleanup. If implementation needs one of these, document the concrete need and resolve scope before proceeding.
- Preserve existing tests. Source checks can remain architectural lint; add behavioral coverage without silently removing tests.

## Delivery sequence

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| P00 | Revalidated inventory and measurable baseline | — |
| P01 | Task context and cache correctness | P00 |
| P02 | Efficient, durable draft persistence | P00 |
| P03 | Shared media and service-runtime resources | P00 |
| P04 | Bounded thread retention and cheaper projections | P00, coordinate with P03 |
| P05 | One typed primitive layer | P00 |
| P06 | Theme, typography, and translation consistency | P05 |
| P07 | Geometry derived from actual layout | P06 |
| P08 | Clear module ownership and route loaders | P01, P05 |
| P09 | Cohesive chat/workbench controllers and views | P02–P05, P08 |
| P10 | Behavioral and architectural regression gates | Starts in P00; finishes after P06–P09 |
| P11 | Integrated validation and documentation | All previous phases |

This dependency graph permits independent work, but does not require concurrent agents. Avoid simultaneous edits to the assistant controller, primitive library, or global CSS. Complete narrow behavior fixes before moving their implementation into new modules.

## P00 — Baseline and coverage inventory

Inspect current callers, tests, import reachability, runtime ownership, and any changes since the audit. Assign every finding one disposition: confirmed and scheduled, already fixed, intentional exception, or requiring additional evidence. Record reasons and source locations.

Use the existing navigation harness and repository container workflow. Use `Dockerfile.agent-checks` for portable checks when Docker is available; native Electron checks use the installed macOS toolchain. Record an unavailable Docker daemon and the actual fallback. Do not install host system packages.

Capture representative fixtures:

- Drafts: 100 paired text/cursor changes; cursor-only updates; supported image attachments; slow and failed storage; two windows editing distinct requests.
- Threads: 100, 1,000, and 5,000 messages, growing activities, streaming into the last message, metadata-only events, and history switches.
- Resources: the same runtime in one and three tiles; hidden/visible/log-view demand; slow responses; artifact additions and expiry.
- UI: shared/assistant control variants, all six palettes plus system mode, Settings, Skills, Store, Tasks, and a mixed workbench.
- Layout: narrow/wide launcher, font loading, long localized labels, unchanged layout results during repeated measurement.

Measure draft writes, attachment puts, queued records, projection visits, resource requests, retained thread payloads, and relevant render commits. Collect production-build CPU/heap evidence separately from development-mode behavior. Record machine/build/fixture parameters with results.

Exit: reproducible baseline, a 21-row finding ledger, and a known failing regression for each correctness defect. Set absolute timing budgets only after measuring P00; deterministic resource budgets below do not depend on hardware.

## P01 — Correct task context and cache writes

Primary files: `features/tasks/pages/TasksPage.tsx`, `app/model/queryCache.ts`.

- Remove repository-specific default file paths. A task uses a real selected context, a valid generated page, or an explicit empty context selection. Resolve existing context conventions before deciding whether context-free tasks are supported; do not manufacture a file to satisfy validation.
- Replace dropped cache writes with a keyed latest-value trailing write. Preserve immediate fresh-query display.
- Make scheduled writes aware of clear/delete generations so a late callback cannot resurrect invalidated data. Handle key changes, failed scheduling, and component departure deliberately.

Acceptance: a non-Convex project never receives a phantom schema path; a burst ending inside the throttle interval persists its final value; clearing before a pending write completes does not restore stale data; returning to a cached project displays the latest accepted snapshot.

## P02 — Draft persistence without redundant work

Primary files: `assistantDraftRepository.ts`, `useAssistantContentDraft.ts`, `questionDraftStore.ts`, `AsyncQuestionPanel.tsx`, and the composer handler in `useWorkbenchAssistantTileController.tsx`.

Deliver in three changes:

1. Add one atomic text-and-cursor update. Ignore unchanged patches. Cursor/preference-only edits do not increment the content revision. Keep existing storage shape initially.
2. Replace one queued closure per edit with a latest-pending-record map per draft. While a transaction is running, supersede intermediate pending snapshots. Flush captures a revision barrier and waits for all changes through it; later edits remain queued. Do not introduce a long debounce or rely on unload callbacks for durability. Preserve at least the existing last-committed recovery semantics.
3. Separate attachment bytes from frequently written draft metadata using an additive IndexedDB migration, and move question drafts behind an asynchronous repository. Reuse storage infrastructure where its transaction and cross-window semantics fit; avoid a generic persistence rewrite.

Store each attachment once per content revision/change and reference it from draft metadata. Migrate old inline Blobs transactionally, retain readable old data until successful conversion, and clean orphaned bytes only after verified ownership checks. Load lightweight draft metadata first and retrieve selected-draft attachments on demand where practical.

For questions, preserve durable command IDs and frozen submissions. Hydrate before edits can overwrite existing records. Use transactional compare/update semantics and cross-window notification so an asynchronous migration does not overwrite another window's submitted answer. Submission must await committed identity before dispatch. Import legacy localStorage records idempotently; interrupted migration must be resumable.

Acceptance:

- 100 ordinary paired composer changes cause no more than 100 record writes; pending intermediate changes collapse under slow storage. An unchanged update causes zero writes.
- Text/cursor changes perform zero additional attachment-Blob puts after the initial attachment commit.
- At most one draft-storage transaction is in flight per repository; queued work is bounded by dirty draft identities, not keystrokes.
- Question input handlers perform zero synchronous storage reads/writes after hydration.
- Tests cover blocked/failed transactions, quota failure, retry, adoption during edits, deletion with queued callbacks, revision-safe acknowledgment, restart recovery, two-window behavior, and migration interruption.
- History replacement waits for a successful flush. Storage errors retain editable in-memory data and preserve the existing recovery path.

## P03 — Share media and service-runtime work

Primary files: `useThreadArtifactMedia.ts`, `chatMediaCache.ts`, `useAuthorizedChatMedia.ts`, `WorkbenchOrgDevAppTile.tsx`.

Unify media resource identity and expiry policy through the existing cache mechanisms where compatible. Request only missing or expired artifacts; keep valid URLs usable while refreshing. Use server-returned expiry rather than a separately hardcoded refresh interval. Bound concurrency, deduplicate requests, cancel unused work, and retain retry behavior. Do not equate hidden chat with an inactive agent.

Move service-runtime observation out of the tile into a shared renderer resource keyed by the complete runtime identity. Prefer existing push notifications if available; otherwise retain polling with one timer and one in-flight request per identity. Combine consumer demand for log detail and refresh cadence. Releasing observation must not release execution ownership.

Acceptance: opening three tiles for one runtime creates one observation loop; slow requests do not overlap; unchanged snapshots retain identity; final observer release clears observation resources; adding artifact N+1 requests only the new artifact when earlier URLs are valid; concurrent consumers share work; URL expiry and failure recovery still work.

## P04 — Bound retained thread data and reduce projection work

Primary files: `features/assistant/model/threadDetailStore.ts`, `substrate/useTileThreadStream.ts`, and thread-derived selectors in the assistant controller.

First add explicit retain/release demand to the thread-detail cache. Pin active subscriptions, running work, pending user actions, and consumers performing operations. Use LRU eviction for unpinned details with configurable count and approximate payload limits; select initial limits from P00 fixture sizes. Treat byte accounting as approximate and validate with heap snapshots. Keep draft storage and lightweight history separate.

Eviction is a reconstructible view-cache operation. It must preserve deletion/sequence safeguards and reload through the existing snapshot-first protocol. An all-pinned cache may exceed its soft limit; report that condition in diagnostics rather than evicting active work.

Then optimize projection based on actual event changes. Reuse mapped messages by stable identity and update changed entries without rebuilding two whole-history maps per text delta. Keep a full-rebuild path for snapshots, reconnects, rollback, and incompatible events. Do not require an upstream protocol change for this phase; if the canonical reducer still copies an array, report that residual cost explicitly.

Acceptance: opening many inactive histories reaches the configured retained-detail bound; active/pending threads survive; evicted threads reopen correctly; stale events cannot resurrect deleted state. For one changed message, remapping and projection-index updates are bounded by the changed set, unchanged message objects remain identical, and correctness matches the full projection across randomized event sequences. Measure remaining reducer, array-copy, and rendering costs on all three history sizes.

## P05 — Consolidate primitives with typed compatibility

Primary directories: `components/ui/`, `features/assistant/ui/`.

Inventory each duplicate's API, visuals, ref behavior, sizing, focus handling, scrolling, and composition. Start with Button/Input/Badge; follow with Tooltip/Popover/Menu; migrate Dialog/ScrollArea after their differences are understood.

Choose one implementation per primitive in `components/ui`. Preserve useful feature-specific composition as named feature components. Add explicit variants for justified differences rather than flattening them into accidental defaults. Temporary assistant imports re-export the canonical implementation and have a recorded removal milestone.

Replace `as any` adapters with valid render/element prop types and type tests for supported composition. Centralize icon prop typing where wrappers add value; remove wrappers that merely obscure the library API.

Acceptance: one behavior/styling implementation per generic primitive; equivalent variants render consistently across features; refs, keyboard use, disabled states, nested dialogs, body portals, and scroll ownership survive migration. No new dependency or second compatibility framework is required.

## P06 — Theme, text tokens, and translations

Primary files: `index.css`, `lib/theme.ts`, pre-paint theme initialization, `lib/xtermTheme.ts`, chat theme resolution, and translation resources.

Expose a common color-mode marker derived from the chosen palette. Make Tailwind dark variants use it while preserving palette-specific tokens and stored preferences. Update first-paint initialization and runtime application together. Migrate terminal/timeline consumers to the same resolver. Remove individual theme patches only after equivalent behavior is verified.

Use the merged typography scale as the default. Add a named Settings-title token and semantic component variants where needed. Inventory arbitrary values and retain documented exceptions for branding, code editors, diagrams, and library geometry; do not replace every pixel literal mechanically. Reconcile `docs/desktop-design.md` and `docs/ui-typography.md`.

Remove translation type escapes by adding or correcting actual keys. Move user-visible hardcoded placeholders, shared accessible labels, and status strings to the existing translation system, preserving literal protocol values and provider-supplied text. Verify existing locale fallback behavior; do not invent untranslated keys to make checks pass.

Acceptance: light/dark/navy/wine/clay/forest and system switching work at first paint and runtime; representative controls, terminal, and timeline agree on mode; no font-normalizing global override returns; locale switching and long labels remain usable; touched translation keys typecheck without casts.

## P07 — Geometry from the actual surface

Primary files: `WorkbenchSelectionTile.tsx`, `workbenchSelectionLauncherLayout.ts`, sidebar measurement helpers.

Use a flex/grid layout that allocates a real remaining-space viewport to the launcher. Measure that viewport instead of subtracting 220/132px overhead. Keep cell dimensions in a single layout contract consumed by both rendering and computation. Compare semantic layout results before updating React state; preserve page clamping when item count or available space changes.

Use actual overflow metrics for sidebar titles when possible. If canvas measurement remains necessary, derive computed font metrics and actual reserved space, update after font loading, and avoid layout reads during render.

Acceptance: repeated observations yielding the same rows/columns/page count cause no React layout-state update; all launcher items remain reachable at narrow widths, across font loading and translations; sidebar titles reflect actual truncation. Preserve current layout behavior and measure rendering cost without claiming a complete jitter fix.

## P08 — Module ownership, dead code, and destination loading

Move shared Skills formatting/constants into a domain presentation module used by both pages. Move app-wide toast ownership out of the assistant feature, and platform/shortcut helpers into neutral infrastructure. Keep thread-specific toast policy at the feature boundary.

Audit import reachability using TypeScript-aware analysis, including dynamic imports, tests, scripts, package entry points, and generated registration. Remove the three unreferenced assistant hooks only after confirming they are obsolete; do not restore old logic simply because an extracted file exists. Review other candidates independently.

Make route construction and prewarming consume the same leaf-module loader definitions. Preserve route-specific exports, loading states, retry behavior, and lazy chunk boundaries. Keep the registry free of static page imports. A dynamic import cycle through a registry is not automatically a runtime defect; eliminate the confirmed static Skills cycle.

Acceptance: no page-to-page utility imports in the repaired area; shared infrastructure no longer imports feature UI; no duplicate route/module mapping for migrated destinations; the three obsolete hooks have no remaining references; navigation/back/Settings-return tests and production Electron navigation pass.

## P09 — Split responsibilities in the active controllers

Primary files: `useWorkbenchAssistantTileController.tsx`, `CozeaChatSurface.tsx`, `MessagesTimeline.tsx`, `useWorkbenchDockviewRuntime.ts`, then Tasks/Skills/Settings page hotspots.

Extract from the active implementation in behavior-preserving steps. Target responsibilities: thread binding/context, draft editing, send lifecycle, provider selection, pending requests, artifact resources, history placement, composer presentation, and timeline presentation. The controller remains a small composition point; views receive cohesive view models and explicit commands rather than dozens of unrelated props.

Move feature-owned public types out of view modules. Keep subscriptions close to the consumers that need them, with stable empty values and semantic equality. Split broad contexts only where measurements show unrelated updates reaching consumers; do not replace prop drilling with a global mutable store by default.

For each large module, document the selected boundaries and retained responsibilities. Do not impose an arbitrary line-count threshold or extract hooks that remain unused.

Acceptance: draft editing does not remount the editor or invalidate unrelated timeline rows; streaming does not recreate unrelated provider menus; history/Chat/Artifacts switches preserve documented ownership; all provider kinds retain their capabilities; no controller becomes a second runtime authority. Operation-count and render evidence must show equivalent or reduced work.

## P10 — Regression and convention enforcement

Add behavioral tests alongside each earlier phase. Finish with a small set of TypeScript-aware import rules and focused component integration tests.

Enforce: neutral primitives cannot import feature UI; no new imports of retired assistant primitives; page utilities do not create page cycles; duplicate route loader mappings do not return; touched code has no new unsafe primitive/translation casts. Existing exceptions need an owner and a concrete reason. Avoid regex rules that prohibit every arbitrary Tailwind value or every cross-feature type import.

Supplement source-string lifecycle checks with tests that mount the relevant composition and observe lifetimes, subscriptions, resource cleanup, and stored state. Retain source checks as clearly labeled architecture guards where they still add value. Preserve existing Electron correctness tests; they do not substitute for draft-write, memory, or streaming measurements.

Acceptance: each F01–F21 row links to its implementation and executable validation or documented exception. New tests assert user-visible behavior or resource contracts and fail for the original defect, rather than mirroring helper internals.

## P11 — Integration, documentation, and handoff

Run targeted tests after each change and the full suite at integration milestones. Before each commit, run the required typecheck; for source changes, run relevant lint/build checks. Final verification uses:

```sh
bun run typecheck
bun run typecheck:electron
bun run typecheck:tests
bun run lint
bun run test
bun run check:navigation-boundaries
bun run build
bun run test:navigation:unit
bun run build:navigation-test
bun run test:navigation:electron
bun run perf:navigation
```

Run existing interaction measurements when affected, but interpret them only for their covered scenarios. Introduce focused UI resource benchmarks during P00–P04; record their final commands rather than claiming an existing script covers those cases. No cloud deployment is needed for this plan.

Verify production Electron with representative Settings, Skills, Store, Tasks, mixed tiles, long conversations, draft images, storage failures, theme switching, and history reopening. A real provider send is a separate user-directed check; replayed protocol fixtures can validate most lifecycle behavior without spending provider quota.

Update the following as their contracts change: root `AGENTS.md` for short ownership rules, `docs/desktop-design.md`, `docs/ui-typography.md`, `docs/assistant-chat-history.md`, `docs/assistant-artifacts.md`, and relevant navigation/overlay docs. Release/provider docs change only if their behavior is affected.

Final handoff contains the completed finding ledger, before/after measurements with limitations, executed checks, retained exceptions, and migration/recovery notes. Keep screenshots, traces, and heap dumps outside source control; commit concise reproducible fixtures and benchmark code.

## Commit and recovery strategy

- Use a dedicated `codex/ui-code-quality` branch when execution begins, starting from the then-current accepted checkout. Preserve unrelated edits and re-evaluate overlapping work first.
- Prefer one reviewable concern per commit. Separate storage migration from cosmetic changes, and primitive migration from controller extraction.
- Keep compatibility re-exports temporary and record their removal criteria. Avoid long-lived dual implementations or broad feature flags that double the behavior matrix.
- Preserve old persisted data until migration validation completes. A source revert may not reverse a storage upgrade; verify old-reader behavior and provide a forward recovery path before shipping migrations.
- Do not push main, publish releases, or deploy backend changes as part of this implementation program without the corresponding explicit request.

## Completion criteria

All 21 findings have a verified disposition; high-priority correctness/resource issues are fixed; one primitive/theme/loader authority exists for migrated code; storage and live-runtime invariants pass; resource use is bounded where specified; measured performance does not regress on representative fixtures; documentation agrees with shipped code. Remaining intentional exceptions are explicit and narrow. Completion is not defined by deleting a target number of files or declaring all possible UI issues solved.
