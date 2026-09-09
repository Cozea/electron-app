# UI code quality implementation report

Completed: 2026-09-09

Branch: `codex/ui-code-quality`

Baseline: `c7442654`

This change applies the program in `docs/ui-code-quality-implementation-plan.md` without restoring the rejected `revamp` branch. It preserves the existing product layout and provider/runtime authority while removing correctness defects, duplicate UI infrastructure, unbounded renderer work, and confirmed ownership cycles.

## Finding ledger

| Finding | Disposition | Implementation and evidence |
| --- | --- | --- |
| F01 duplicate primitives | Fixed | Removed the assistant primitive implementations and migrated their consumers to `components/ui`. Toast ownership now also lives in the canonical UI layer. Architecture tests prevent the retired layer from returning. |
| F02 palette/dark mismatch | Fixed | Every dark palette receives the shared `theme-dark` marker at first paint and runtime. Tailwind, terminal, source-control diff rendering, and skill styling consume the same color-mode decision. |
| F03 phantom task context | Fixed | Task defaults come only from discovered pages or files; a project with neither receives an explicit empty selection. |
| F04 duplicated geometry constants | Fixed | Launcher rendering and computation consume one layout contract. Sidebar titles use rendered overflow metrics; remaining canvas callers derive their font from computed style and remeasure after font loading. |
| F05 equivalent layout updates | Fixed | Launcher state compares all semantic layout fields and retains the previous object for equivalent observations. The grid observes its actual remaining-space viewport. |
| F06 whole-set artifact refresh | Fixed | Artifact media caches by thread/base URL and requests only missing or expiring IDs while retaining valid URLs through refresh and retry. |
| F07 per-tile service polling | Fixed | A shared runtime observer owns one timer and one in-flight request per complete runtime identity, aggregates detail demand, publishes start/stop snapshots, and cleans up after the final consumer. |
| F08 mixed controller responsibilities | Fixed with bounded extraction | The active controller now composes dedicated attachment, pending-request, diff-dialog, workspace-root, and status modules. Composer public types moved out of the view. Binding and turn dispatch stay together as the single runtime authority; the timeline and dock runtime remain large cohesive owners rather than being split by line count. |
| F09 neutral code importing feature UI | Fixed | Generic UI owns toast, and platform detection lives in `lib/platform`. Boundary tests keep generic primitives independent of feature UI. |
| F10 primitive type escapes | Fixed in the consolidated layer | Dialog, dropdown, popover, and tooltip wrappers use their underlying typed render/position props without `as any`. |
| F11 hardcoded copy/type escapes | Fixed in touched flows | Removed translation casts from chat and launcher code; launcher labels and asynchronous question labels, placeholders, states, and accessible names are typed English/Spanish keys. |
| F12 typography drift | Fixed | Added the named 22px Settings title token and reconciled the desktop design and typography documents with the 13/12/10px hierarchy. |
| F13 redundant draft writes | Fixed | Atomic text/cursor updates ignore no-ops. Persistence coalesces by dirty draft identity with one transaction in flight. |
| F14 synchronous question storage | Fixed | Question drafts use transactional IndexedDB records, hydrate before editing, retain frozen submission identity, notify other windows, and import legacy localStorage records resumably. |
| F15 dropped cache tail | Fixed | Query cache persistence coalesces a burst into a keyed trailing write and uses generations so clear/delete cannot be undone by a late callback. |
| F16 whole-history projection | Fixed for ordinary deltas | One-message events remap only the changed message and preserve the identity of unchanged messages. Snapshot, rollback, and incompatible events retain the full correctness path. The canonical reducer's array copy remains a documented residual cost. |
| F17 unbounded inactive thread details | Fixed | Thread details use a soft 24-inactive-entry/approximately-32-MiB LRU. Visible, streaming, running, and unresolved-request threads are retained; stale sequence watermarks survive payload eviction. |
| F18 obsolete hook extractions | Fixed | Removed the three confirmed unreferenced hooks (`useAssistantApprovals`, `useAssistantTileBinding`, and `useAssistantTurnSend`), totaling 725 lines at the audited baseline. |
| F19 Skills runtime cycle | Fixed | Shared skill name/description presentation moved to a domain model. `SkillBuildsView` moved to components and no longer imports `AgentSkillsPage`. |
| F20 duplicate destination loaders | Fixed | Route rendering and speculative warming share `destinationModules`; Settings routes use the existing shared `settingsModules`. Lazy chunk and retry behavior remain intact. |
| F21 source-only lifecycle checks | Improved and gated | Composer image acceptance now has behavioral preparation coverage, while the remaining drop-wiring assertion is labeled as an architecture check. Runtime observer behavior has direct deduplication/cleanup tests, and its older source check now verifies the new ownership. |

## Resource and correctness evidence

- One hundred synchronous composer edits produce one draft-storage transaction. With a deliberately blocked transaction, 99 further edits produce one bounded follow-up transaction and retain the latest value.
- Text/cursor-only writes reuse stored attachment signatures and do not put attachment blobs again.
- Question tests cover restart recovery, frozen retry identity, incomplete and multi-select answers, two-window submissions, interrupted migration, and asynchronous writes.
- Thread tests cover retained/pinned eviction, approximate byte limits, separate stale-event watermarks, changed-message identity preservation, and parity with full projection.
- Runtime-observer tests cover shared consumers, non-overlapping slow requests, detail-demand cadence, identity-preserving snapshots, and final cleanup.
- Launcher tests cover narrow capacity, tall tiles, pagination, semantic equality, and the unified geometry values.
- Architecture tests prevent feature imports in generic primitives, retired assistant primitive imports, the former Skills page cycle, duplicate destination imports, obsolete hooks, and touched translation casts.
- Settings architecture tests preserve the removed account-profile footer and require the Back target to track the complete app URL, including query and hash changes.

## Validation

The final integration checks passed:

- `bun run typecheck`
- `bun run typecheck:electron`
- `bun run typecheck:tests`
- `bun run lint`
- `bun run check:navigation-boundaries`
- `bun run test`: 354 files passed, 1 skipped; 2,668 tests passed, 4 skipped
- `bun run build`: production Electron/Vite build completed successfully
- `git diff --check`

Vite continues to report the repository's existing warning that `vitest.config.ts` uses ESM syntax with the native config loader. Node also reports its existing experimental SQLite warning in the full suite.

After this program completed, the renderer performance marks, in-memory navigation metrics, and Electron boot-timing instrumentation were removed at the user's request in preparation for a later PostHog/Sentry replacement. Manual Chromium/CDP profiling scripts remain available.

## Practical limit

These changes remove concrete resize-time React state churn in the launcher and bound several background workloads. They do not prove that all native window-resize jitter is gone. No post-change frame-time trace was captured in this program, and the canonical thread reducer still copies its message array for a delta. A runtime resize trace should be used before attributing any remaining jitter to another subsystem.
