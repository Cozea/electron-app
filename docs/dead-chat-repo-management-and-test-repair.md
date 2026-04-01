# Dead Chat, Repo Management, and Test Repair

## Scope

This cleanup tracks three linked fixes:

1. Delete dead assistant chat surfaces that are no longer mounted and are unsafe to keep around.
2. Reconcile provider repository management with the app's real GitHub-first behavior and remove GitLab from that slice.
3. Repair the broken test/module surface by either restoring the small utility modules that still make sense or updating the tests to the live contract.

## Exit Criteria

- No dead `ChatView` / `NativeChatView` surface remains in the repo.
- Repository management is consistently GitHub-only in the picker/provisioner/provider-management slice.
- The targeted failing tests pass:
  - `tests/providerRepositoryManagement.test.ts`
  - `tests/billingErrors.test.ts`
  - `tests/googleReasoningCapabilities.test.ts`
  - `tests/projectBuildState.test.ts`
  - `tests/retryHints.test.ts`
  - `tests/projectRuntimeStore.test.ts`
- The doc is updated after each completed phase with short reference bullets.

## Phase Plan

### Phase 1. Remove dead chat surfaces

- Confirm `ChatView.tsx` and `NativeChatView.tsx` have no live imports.
- Delete them and any now-unused direct references created only for those dead surfaces.
- Keep shared live chat building blocks that still back active components/tests.

### Phase 2. Reconcile repository management to GitHub-only

- Align the repository-management slice with the actual current behavior.
- Remove GitLab from the provider-management library/tests and the repository picker/provisioner surface.
- Keep broader source-control infrastructure untouched unless required for type safety.

### Phase 3. Repair broken tests/modules

- Restore or replace the small utility modules the tests are targeting:
  - billing error parsing
  - retry hint parsing
  - project build state parsing
  - project runtime selector
  - Google reasoning compatibility helpers for the server test surface
- Update provider repository management tests to the GitHub-only contract.

### Phase 4. Verify and summarize

- Run the targeted Vitest suite.
- Run typecheck if the targeted changes affect shared types.
- Record outcomes and any remaining compatibility-only debt.

## Execution Log

### Baseline

- Confirmed `ChatView.tsx` and `NativeChatView.tsx` are unreferenced outside themselves.
- Confirmed `providerRepositoryManagement.ts` is single-provider in implementation, while its test still expects old multi-provider aggregation and partial-result behavior.
- Confirmed five tests fail because their target modules are missing or stubbed, not because of subtle runtime behavior.

### Phase 1. Remove dead chat surfaces

- Deleted the unreferenced dead assistant entrypoints:
  - `src/features/projects/components/assistant/chat/ChatView.tsx`
  - `src/features/projects/components/assistant/chat/NativeChatView.tsx`
- Deleted the stale one-off fixer scripts that only targeted `ChatView.tsx`:
  - `scripts/fix-chatview-modelSelection.cjs`
  - `scripts/fix-context-meter.cjs`
  - `scripts/fix-pull-request-dialog.cjs`
  - `scripts/fix-timeline-import.cjs`
- Kept shared chat primitives like `MessagesTimeline.tsx`, `ComposerPromptEditor.tsx`, and `session-logic.ts` because they still have independent local tests and may still be part of active assistant building blocks.

### Phase 2. Reconcile repository management to GitHub-only

- Narrowed the repository-management library itself to GitHub:
  - `src/lib/git/providerRepositoryManagement.ts`
- Removed GitLab from the visible repository-management and source-control preference surface:
  - `src/components/git/ConnectedRepositoryPicker.tsx`
  - `src/components/git/RepositoryProvisioner.tsx`
  - `src/components/git/VersionControlRepositoryManager.tsx`
  - `src/pages/workspace/SourceControl.tsx`
  - `src/components/Onboarding.tsx`
  - `src/lib/sourceControlDefaultProvider.ts`
  - `src/lib/sourceControlPreferences.ts`
- Kept broader Electron/OAuth infrastructure intact so this pass only changes the user-facing repository-management slice instead of trying to rip GitLab out of every backend path at once.

### Phase 3. Repair broken tests/modules

- Restored small compatibility utility modules instead of reviving dead subsystems:
  - `src/lib/ai/billingErrors.ts`
  - `src/lib/ai/retryHints.ts`
  - `src/pages/projectBuildState.ts`
  - `src/stores/useProjectRuntimeStore.ts`
- Restored the small server compatibility test surface for Google reasoning helpers:
  - `server/src/routes/ai/modelCatalog.ts`
  - `server/src/routes/ai/googleReasoningCapabilities.ts`
  - `server/src/routes/ai/providerHelpers.ts`
- Rewrote `tests/providerRepositoryManagement.test.ts` to match the live GitHub-only contract instead of the old multi-provider aggregation behavior.

### Phase 4. Verification

- `bunx vitest run tests/providerRepositoryManagement.test.ts tests/billingErrors.test.ts tests/googleReasoningCapabilities.test.ts tests/projectBuildState.test.ts tests/retryHints.test.ts tests/projectRuntimeStore.test.ts`
  - passed: 6 files, 23 tests
- `bunx tsc --noEmit --pretty false`
  - passed
- Final spot checks:
  - no remaining `ChatView` / `NativeChatView` references outside this document
  - no remaining `GitLab` references in the GitHub-only repository-management slice
