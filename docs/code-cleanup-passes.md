# Code cleanup passes

## Regression review after cleanup

The follow-up review found three additional regressions and corrected them:

- **Add Tile grid measurement:** the viewport exists only in grid view, but its
  effects depended on item count and singleton state. List-to-grid switches could
  mount a viewport without attaching its observer, leaving one-column or stale
  pagination geometry. `useLauncherGridLayout` now attaches measurement and cleanup
  through a React callback ref whenever the actual viewport mounts or changes.
- **Artifact URL retries:** failed renewal preserved the cached URL, whose expiry
  then bypassed the retry deadline. Refresh eligibility and the next timer now
  respect both expiry and failure backoff, preventing an immediate request loop.
- **Running sidebar title tooltips:** the clipped shimmer wrapper concealed the
  actual text overflow. Measurement now targets the base text span and follows
  its DOM lifetime when the title switches between idle and running presentation.

An isolated Electron renderer test reproduced Add Tile's one-column failure
before its correction. It now covers list/grid remounts, width/height changes,
detached viewports, and sidebar overflow across idle/running transitions. It uses
a temporary profile and no production account, message, or project state. Run it
with `bun run test -- tests/workbench/launcherViewportLifecycle.test.ts`; it runs
on macOS and is explicitly skipped elsewhere. Portable artifact refresh tests
cover initial fetch, renewal, and failed renewal of an expired cached URL.

Comparison of 64 extracted function bodies across Tasks, Skills Builds, composer
menus and timeline presentation found unchanged emitted JavaScript. This supports
the extraction review, but cannot establish complete UI behavior equivalence.
Broader cleanup remains paused; T3 is unchanged by this review.

Final verification: renderer, Electron and test typechecks; lint; navigation
boundary checks; production build; and diff checks pass. Full Vitest passes
2,680 tests across 359 files, with four existing skipped tests and one skipped
file. Existing Vite configuration/mixed-import and SQLite experimental warnings
remain. This review did not exercise every provider conversation or native
quit/reopen path and does not establish universal visual equivalence.

## Composer regression correction

The earlier status-component extraction accidentally changed the composer-status
slot from literal null to a React element rendering null. Layout checks use slot
presence, so healthy empty composers incorrectly entered stacked layout. The
status renderer now returns the actual node/null directly. Regression tests cover
healthy, error and cleared-error states; 15 focused tests, renderer/test typechecks,
lint and production build pass. A component rendering null is not interchangeable
with a null slot when a parent uses ReactNode presence for layout.

## Pass 1 — unused code and configuration

Removed unused renderer feature flags (`viewTransitions`, `contentVisibility`,
`browserAgentAutomation`) and obsolete baseline/Codemagic settings for the first
two plus `DATA_ROUTER` and `UTILITY_PROCESS_MANIFEST`. Active flags and their
fallback paths remain supported.

Removed eight completed one-time router migration, blanket `ts-nocheck`, and
package-module reversion scripts. They targeted obsolete source locations and
had no remaining workflow callers. Git history retains them.

Migrated workspace normalization and remote-environment tests/callers to the
canonical APIs, removing the deprecated aliases without changing behavior or
removing tests. Removed empty directories left by the earlier UI and telemetry
cleanup.

Persisted-data migrations, checkpoint services, provider compatibility, preview
protocol compatibility, and T3 remain outside this deletion pass.

## Pass 1 verification

Pass 1 verification: renderer, Electron and test typechecks; lint; production
build; diff whitespace check; 55 existing filesystem, substrate and navigation
tests passed. Docker daemon was unavailable, so the installed Bun toolchain was
used. Vite still reports configuration and mixed static/dynamic import warnings;
those are separate build-organization cleanup candidates.

## Pass 2 — shared filtering chips and error presentation

Added `components/ui/filter-chip.tsx` and adopted it in DevApp Settings, DevApps
Store, Add Tile, Agent Skills and Scheduled Tasks. The primitive owns typography,
active/hover styling and pressed-state semantics; callers retain layout, counts,
labels and selection handlers. The animated Skills category carousel remains a
separate tab presentation with its own moving indicator.

Added `lib/convexError.ts` for transport-decoration removal and caller-specified
fallbacks. Migrated settings, invitation, sharing, project mutation and sidebar
callers. Removed the unused header helper. Existing caller-specific trimming and
fallback behavior are preserved. Added behavioral coverage for multiline messages,
ordinary text, empty decorated errors and non-Error inputs.

Verification: renderer/Electron/test typechecks, lint, production build, diff
check and 837 tests across 90 affected-area test files passed. Existing Vite
configuration and mixed-import warnings remain. No dependencies or T3 changes.

## Pass 3 — application shutdown ownership

The seven shared DevApp, preview and local-automation disposals now have one
application-quit owner. Cleanup starts once, even on repeated or reentrant quit
events, and reports individual synchronous/asynchronous failures without skipping
other owners. Async disposal remains best-effort at quit, as before; this change
does not introduce an awaited Electron quit barrier.

Last-window closure clears the window reference and requests ordinary quit on
Windows/Linux. macOS retains application services for reopening; its existing
close-to-hide policy remains intact. Terminal and Dev Server termination stays
with the existing quit registry. T3 teardown remains unchanged.

Verification: all three typechecks, lint, production build, diff check and 785
tests in Electron, Dev Server, terminal and DevApp suites passed (one skipped).
New tests cover repeated/reentrant cleanup and independent sync/async failures.
Native quit/reopen was not exercised. Existing Vite build warnings remain.

## Remaining passes

## Pass 4a — Tasks and Skills Builds model boundaries

Extracted Skills Builds selection, category grouping, provider counts and loadout
logic into `features/projects/model/skillBuildModel.ts`. Existing behavior tests
now import that model directly; visualization helpers remain in the component.

Extracted task board records, normalization, legacy storage reads, claimant,
marker, deadline and context helpers into `features/tasks/model/taskBoardModel.ts`.
The page keeps React state, mutations and rendering. Preserved storage keys and
legacy normalization. Replaced all six Tasks `any` annotations with the shared
icon adapter and a typed translation function. No visual or protocol changes.

Verification: three typechecks, lint, production build and diff check passed.
271 existing tests across Skills, Tasks, architecture and overlay behavior passed,
plus four new task-model tests. Existing Vite warnings remain.

## Remaining pass 4 work

### Completed pass 4b

Extracted `SkillBuildProviderHub.tsx` with the diagram geometry, wiring, charge
animation and provider nodes intact. Provider icon mapping is shared with the
detail sheet through `skillBuildProviderIcons.ts`. Existing diagram tests now
read the new component source. Extracted `TaskListRow.tsx`, retaining expansion
state, context navigation, marker callbacks and accessible labels.

Verification: all three typechecks, lint, production build, diff check and 275
tests passed. No native visual comparison was performed; existing Vite warnings
remain. T3 is untouched.

Continue splitting assistant surface/controller/timeline, Tasks UI, Skills Builds
visual sections and Electron main by responsibility. Review remaining type
escapes and distinguish current documentation from historical plans. Pass 4 is
in progress; the module-size audit is not yet fully addressed.

### Completed pass 4c

Extracted composer path/slash menu construction, plan titles and question-answer
conversion into `composerMenuModel.ts`. Extracted work-entry preview, status,
heading and expanded-detail formatting into `workEntryPresentation.ts`. Extracted
image upload preparation into `prepareComposerImageUploads.ts`; the controller
still owns settings persistence, dispatch sequencing and draft acknowledgement.
State subscriptions, virtualization, reveal/scroll effects and T3 are unchanged.

Verification: renderer/Electron/test typechecks, lint, production build and diff
check passed. 706 existing assistant/workbench/architecture tests and four new
presentation tests passed; one existing test skipped. No live chat/resize trace
was captured. Remaining component/runtime decomposition is still outstanding.

### Composer regression follow-up

The status extraction accidentally passed a truthy React element when healthy
status rendered nothing. The controller now calls a pure status renderer that
returns literal null, so an empty composer is no longer forced into its expanded
shape. Focused status tests cover that distinction.

Adaptive expansion remains intentional: text gains width and controls move as
the composer grows. Its shell and existing editor/control wrappers now animate
together using Motion layout projection. Padding resolves immediately instead
of interpolating through widths that feed back into line measurement. The editor
stays mounted, and reduced-motion preferences are respected.

Verification: renderer/test typechecks, lint, production build, diff check and
422 assistant/workbench tests passed (one skipped). Live compact and multiline
draft checks retained editor focus and usable controls; no message was sent.
The user confirmed the result. No frame-pacing trace was collected. Existing
Vite warnings remain. Broader cleanup pass 4 is still incomplete.
