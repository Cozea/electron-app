# Navigation runtime completion report

The persistent navigation runtime repair is accepted for merge at source candidate
`c0738b5980a607b38f4aa8591b3cb4e0a25dbbfb`. It is based on the original audited
baseline `073df5230d2400684434ea6b7db27b0aafc72ddc` and integrates with `main` at
`8e65b729e47c0c1bdfdd8555f55f0338cc95223f`.

This report replaces the withdrawn report from the incomplete
`deb92d01c83e323680ff7ff5443ac69c248a537b` implementation. Every result below
comes from executable checks; no fixture-count or print-only runner is treated as
evidence.

## Delivered architecture

- The project shell owns a persistent workbench surface outside changing route
  content. Ordinary navigation hides the surface without unmounting its Dockview
  instances.
- Retained workbenches have revision-scoped project, workspace, and lane identity,
  a bounded three-instance presentation set, frozen per-session contexts, and
  explicit hidden-presentation behavior.
- Workspace resolution and lane knowledge use shared keyed resources with one
  in-flight operation per key and generation, active-demand leases, stale-result
  rejection, and bounded idle eviction.
- Renderer activation flows through the sequenced presentation controller. Main
  validates commands against the committed catalog binding, rejects stale epochs
  and revisions, and owns foreground/resident leases.
- Desktop records are persisted through a real worker thread with granular dirty
  records, commit watermarks, joined flushes, retryable failures, asynchronous
  hydration, and schema-aware non-destructive migration.
- The superseded activation IPC, route-owned workbench page, legacy whole-store
  writers, duplicate polling paths, and false-positive performance runner were
  removed or replaced by enforced boundaries.

## Exact-head validation

GitHub Actions `Navigation Runtime Validation` run
[`34246756206`](https://github.com/Cozea/electron-app/actions/runs/34246756206),
attempt 2, tested the PR merge candidate containing source candidate `c0738b598…`.

| Gate | Result |
|---|---|
| Locked dependencies and pinned T3 bundle | Passed |
| Navigation unit suites | 12 files, 70 tests passed |
| Renderer, Electron, and test TypeScript checks | Passed |
| Full unit suite | 350 files passed, 2 skipped; 2,635 tests passed, 12 skipped |
| Production application compilation | Passed |
| Dedicated production-path renderer build | Passed |
| Real Electron correctness under xvfb | Passed |
| Real Electron resident-warm benchmark | 100 samples; p95 **46 ms**, budget 75 ms |

The Electron correctness run launches the compiled application and drives the
production project layout over CDP. It verifies an actual Store departure,
preservation of the same shell/surface/Dockview on return, A/B/A retention,
three-instance LRU behavior across A/B/C/D, stable workspace identity after a
folder move, a higher binding revision, creation of the revision-qualified main
session, disposal of the superseded session, and removal of its old Dockview.

`Computer Use Native` run
[`34246756268`](https://github.com/Cozea/electron-app/actions/runs/34246756268)
also passed its host, release, and debug jobs at the same source candidate.

## Correctness evidence added during repair

Regression coverage includes real legacy Zustand/layout envelopes, interrupted
and failed migration, worker restart and atomic replacement, flush joining and
edits arriving during writes, hydration/clear races, durable-only layout cloning,
revision conflicts, stale presentation commands, omitted terminal binding
revisions, workspace relocation rollback, non-ENOENT path failures, resource
generation races, persistent-host ownership, and prohibited legacy boundaries.

CodeRabbit's 20 inline findings were verified against current code, corrected
where applicable, acknowledged by the bot, and resolved. Later top-level findings
covering transactionality, activation ownership, and layout-clone ordering were
also corrected before this candidate.

## Interpretation

The measured 46 ms value is the hosted Linux/xvfb production-path result, not a
universal hardware promise. Platform-specific native build and packaging checks
are green; a physical-device performance survey remains normal release monitoring,
not a substitute for or exception to the automated merge gate above.
