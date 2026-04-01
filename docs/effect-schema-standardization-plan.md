# Effect Schema Standardization Plan

## Summary

This plan standardizes the codebase on the currently installed `effect` API and removes the temporary compatibility shim in `shared/assistant-contracts/effect-polyfill.ts`.

Right now the app boots only because a polyfill translates older schema helper usage into the runtime API exposed by the installed `effect` package. That is a useful short-term bridge, but it is not a stable long-term state.

The goal of this plan is to:

1. Choose one canonical `Schema` API surface.
2. Rewrite contract and runtime code to that surface directly.
3. Delete the polyfill.
4. Add guardrails so we do not drift back into mixed schema styles.

This document is meant to be the persistent reference for the standardization work so it remains usable if working context gets compacted later.

## Problem Statement

The repo currently mixes:

- direct `Schema` usage from `effect`
- a local compatibility wrapper in `shared/assistant-contracts/effect-polyfill.ts`
- old helper conventions that do not match the installed runtime API
- both array-form and variadic-form `Schema.Union(...)`

That mismatch has already caused real startup failures in Electron main, including:

- missing helpers such as `Schema.nonEmptyString`
- missing helpers such as `Schema.pattern`
- missing helpers such as `Schema.greaterThanOrEqualTo`
- incompatible `Schema.Union(a, b)` vs `Schema.Union([a, b])` expectations

The result is that schema behavior is no longer obvious from reading the code. Some files compile only because the polyfill silently rewrites their intent at runtime.

## Canonical Target

The standard should be:

- `import { Schema } from "effect"`
- no imports from `./effect-polyfill`
- no repo-local schema compatibility aliases
- one explicit `Schema.Union(...)` form everywhere
- direct use of the installed runtime’s combinators and validators

### Canonical Rules

These are the rules the codebase should converge on:

- Use `Schema.Union([A, B, C])` consistently.
- Use `Schema.Literal("a")` only for true single-value tags.
- Use `Schema.Literals([...])` for multi-value enums and option sets.
- Use `Schema.optionalKey(...)` where optional struct fields are intended.
- Use explicit installed-runtime validators such as `Schema.isMinLength(...)`, `Schema.isMaxLength(...)`, `Schema.isPattern(...)`, `Schema.isGreaterThanOrEqualTo(...)`, and `Schema.isLessThanOrEqualTo(...)`.
- Keep schema decode/encode paths explicit; do not hide API differences behind local wrappers unless they are permanent project-level abstractions.

If the installed `effect` package changes later, we should update code to that API directly, not reintroduce another repo-local compatibility facade.

## Current Compatibility Surface

### Primary Compatibility Layer

- `shared/assistant-contracts/effect-polyfill.ts`

This file currently rewrites several older schema helper calls into newer runtime calls, including:

- `Schema.Union(...)`
- `Schema.Literals(...)`
- `Schema.optionalKey(...)`
- length/pattern/numeric validator helpers
- `Schema.decodeTo(...)`

That makes it the main migration choke point and also the main source of hidden behavior.

### Contract Files Using The Polyfill

The compatibility wrapper is currently imported in multiple contract files under `shared/assistant-contracts`, including:

- `shared/assistant-contracts/server.ts`
- `shared/assistant-contracts/git.ts`
- `shared/assistant-contracts/providerRuntime.ts`
- `shared/assistant-contracts/terminal.ts`
- `shared/assistant-contracts/keybindings.ts`
- `shared/assistant-contracts/ws.ts`

Tests under the same directory also import the polyfill directly.

### Non-Contract Files Still Using Legacy Patterns

Renderer persistence code still uses old helper names in places, even where it imports `Schema` from `effect` directly. Current examples include:

- `src/stores/composerDraftStore.ts`
- `src/stores/assistant-composerDraftStore.ts`

Those files currently contain usage like:

- `Schema.Literals(...)`
- `Schema.optionalKey(...)`

### Mixed `Schema.Union(...)` Shapes

The repo currently uses both of these shapes:

- variadic style: `Schema.Union(A, B, C)`
- array style: `Schema.Union([A, B, C])`

Current examples:

- variadic style in `shared/assistant-contracts/terminal.ts`
- array style in `electron/assistant-runtime/persistence/Layers/OrchestrationEventStore.ts`
- array style in `electron/assistant-runtime/persistence/Services/OrchestrationCommandReceipts.ts`
- array style in `electron/assistant-runtime/orchestration/Services/RuntimeReceiptBus.ts`

This inconsistency is one of the direct reasons the polyfill became necessary.

## Scope

This standardization sweep includes:

1. Contract schemas in `shared/assistant-contracts/**`
2. Renderer schema persistence/state code in `src/**`
3. Assistant runtime schema usage in `electron/assistant-runtime/**`
4. Contract tests affected by the migration
5. CI/repo guardrails to prevent regression

This sweep does not include:

- rewriting non-`Schema` Effect runtime primitives such as `Effect`, `Layer`, `Stream`, `Queue`, or `Ref` unless needed by schema migration
- changing business logic unrelated to schema compatibility
- changing package versions as the first move

## Execution Targets

- [x] Document the exact installed `effect` schema API shapes we are standardizing on.
- [x] Audit all `Schema` compatibility call sites and group them by migration pattern.
- [x] Convert `shared/assistant-contracts/**` off the polyfill.
- [x] Convert renderer state/persistence files using legacy schema helper names.
- [x] Convert assistant runtime files that still rely on mixed schema styles.
- [x] Delete `shared/assistant-contracts/effect-polyfill.ts`.
- [x] Add a regression check for banned legacy schema patterns.
- [x] Verify typecheck, tests, and real Electron boot without the polyfill.

## Execution Order

### Step 0: Freeze the target API

Before rewriting files, explicitly confirm the installed runtime behavior for:

- `Schema.Union(...)`
- `Schema.Literal(...)`
- optional field modeling
- string/array/object length validators
- pattern validators
- decode helpers

Output for this step:

- a short list in this doc naming the exact canonical forms we will use

When this step is complete, add short bullets under the execution log answering:

- what the installed runtime expects
- which old helper names are banned
- whether any project-level helper should remain permanent

### Step 1: Full audit

Inventory all remaining uses of:

- `./effect-polyfill`
- `Schema.Literals`
- `Schema.optionalKey`
- variadic `Schema.Union(...)`
- old validator helpers that only exist because of the shim
- any `Schema.decodeTo(...)` usage

Group them by rewrite pattern instead of treating each as a unique bug.

Output for this step:

- categorized hit list by migration pattern

When this step is complete, add short bullets under the execution log answering:

- which directories are affected
- which patterns are most common
- which files are highest risk for runtime boot

### Step 2: Convert shared contracts first

Migrate `shared/assistant-contracts/**` from:

- `import { Schema } from "./effect-polyfill"`

to:

- `import { Schema } from "effect"`

Rewrite legacy helper usage in those files to the canonical API.

This step comes first because these contracts sit on the boundary between renderer and Electron main, and they are the most likely to break app boot.

Output for this step:

- all contract files using direct `effect` imports
- contract tests updated to the canonical forms

When this step is complete, add short bullets under the execution log answering:

- which contract patterns were rewritten
- whether any contract semantics changed
- what boot/runtime errors disappeared

### Step 3: Convert renderer persistence and stores

Normalize schema usage in renderer-side state/persistence code, especially:

- `src/stores/composerDraftStore.ts`
- `src/stores/assistant-composerDraftStore.ts`
- any other renderer persistence/state file still using old helper names

The goal here is to remove the last “legacy helper” habits from app code outside the contracts layer.

Output for this step:

- renderer stores and persistence code using only the canonical API

When this step is complete, add short bullets under the execution log answering:

- which renderer files changed
- whether persisted state shape changed or remained compatible
- whether any migration code was required

### Step 4: Normalize assistant runtime schema usage

Sweep `electron/assistant-runtime/**` for mixed schema styles and standardize them.

This includes:

- converting array vs variadic union differences
- aligning any lingering helper usage
- removing “mixed style” files where old and new schema conventions coexist

Output for this step:

- consistent schema usage throughout the assistant runtime

When this step is complete, add short bullets under the execution log answering:

- which runtime subsystems were touched
- whether any persistence or IPC schema changed
- what verification was run

### Step 5: Delete the shim

Once all live imports are gone:

- delete `shared/assistant-contracts/effect-polyfill.ts`
- confirm nothing imports it
- confirm no code still depends on its helper semantics

Output for this step:

- no polyfill file
- no polyfill imports

When this step is complete, add short bullets under the execution log answering:

- what was deleted
- what repo-wide checks confirmed removal
- whether any fallback compatibility code remains

### Step 6: Add guardrails

Add a repo check or CI guard that fails on:

- imports from `./effect-polyfill`
- `Schema.Literals`
- `Schema.optionalKey`
- variadic `Schema.Union(...)`
- any other explicitly banned legacy helper names from this migration

Output for this step:

- a repeatable automated check that keeps the repo standardized

When this step is complete, add short bullets under the execution log answering:

- what the guard checks for
- how it is run locally
- where it should live in CI

### Step 7: Verification

Verification must include all of:

- contract tests in `shared/assistant-contracts/**`
- repo typecheck
- any focused runtime tests impacted by schema changes
- real `bun run dev` boot to confirm Electron main, preload, and renderer still start

Output for this step:

- final verification summary in this doc

When this step is complete, add short bullets under the execution log answering:

- which commands passed
- which runtime paths were smoke tested
- whether any known residual issues remain

## Risks

### Biggest Risk

The biggest risk is not TypeScript breakage. It is runtime schema semantics subtly changing while still typechecking.

Examples:

- a field becoming required vs optional by accident
- a union changing decode order or acceptance behavior
- validator semantics changing between old helper shorthand and current explicit combinators

### Highest-Risk Areas

- `shared/assistant-contracts/**`
- Electron main boot path
- WebSocket contract schemas
- persistence schemas used by renderer stores
- assistant runtime persistence projections and event schemas

### Safety Rule

Prefer explicit local rewrites to hidden compatibility wrappers. If a rewrite changes semantics, record that clearly in this document before merging it.

## Exit Criteria

This task is complete only when all of the following are true:

- no file imports `./effect-polyfill`
- `shared/assistant-contracts/effect-polyfill.ts` is deleted
- no banned legacy schema helper names remain
- all schema code uses the canonical API surface
- repo checks prevent regression
- Electron dev boot works without schema compatibility runtime crashes

## Execution Log

### Step 0: Initial audit

- Confirmed the repo currently depends on `shared/assistant-contracts/effect-polyfill.ts` as the live compatibility shim.
- Confirmed several shared contract files import the shim directly, including `server.ts`, `git.ts`, `providerRuntime.ts`, `terminal.ts`, `keybindings.ts`, and `ws.ts`.
- Confirmed renderer store code still uses legacy helper names such as `Schema.Literals(...)` and `Schema.optionalKey(...)`.
- Confirmed the repo currently mixes variadic and array-form `Schema.Union(...)`, which is one of the direct compatibility faults already seen at runtime.
- Confirmed the highest-risk migration surface is the contract boundary between `shared/assistant-contracts/**` and `electron/assistant-runtime/**`.

### Step 1: Freeze the target API

- Confirmed the installed runtime is `effect@4.0.0-beta.25`.
- Confirmed the installed runtime accepts `Schema.Union([A, B])` and rejects variadic `Schema.Union(A, B)`.
- Confirmed the installed runtime supports `Schema.Literals(...)`, `Schema.optionalKey(...)`, and `Schema.decodeTo(...)`, so those can remain as canonical usage where appropriate.
- Confirmed `Schema.Literal("a", "b")` is not a safe multi-value enum form in this runtime; it decodes like the first literal only, so multi-value enums must use `Schema.Literals([...])`.
- Confirmed the installed runtime does not expose shorthand helpers such as `Schema.pattern(...)`, `Schema.maxLength(...)`, `Schema.minLength(...)`, `Schema.greaterThanOrEqualTo(...)`, `Schema.lessThanOrEqualTo(...)`, or `Schema.nonEmptyString`.
- Confirmed the canonical validator shape should therefore use the installed `is*` helpers directly, such as `Schema.isPattern(...)`, `Schema.isMinLength(...)`, `Schema.isMaxLength(...)`, `Schema.isGreaterThanOrEqualTo(...)`, and `Schema.isLessThanOrEqualTo(...)`.

### Step 2: Full audit

- Confirmed `./effect-polyfill` is imported by 19 files, all under `shared/assistant-contracts/**` including both contract sources and tests.
- Confirmed the only runtime-incompatible helper usages are concentrated in shared contracts, not spread evenly through the whole repo.
- Confirmed the incompatible helper families are:
  - variadic `Schema.Union(...)`
  - shorthand validator helpers such as `Schema.maxLength(...)`, `Schema.minItems(...)`, `Schema.pattern(...)`, `Schema.greaterThanOrEqualTo(...)`, and `Schema.lessThanOrEqualTo(...)`
- Confirmed renderer store files such as `src/stores/composerDraftStore.ts` and `src/stores/assistant-composerDraftStore.ts` use `Schema.Literals(...)` and `Schema.optionalKey(...)`, but those are supported by the installed runtime and do not require semantic rewrites.
- Confirmed assistant runtime files already use array-form `Schema.Union([..])` in the known high-risk persistence/orchestration paths.
- Confirmed the highest-risk files for real boot are the shared contracts consumed by Electron main: `terminal.ts`, `orchestration.ts`, `ws.ts`, `providerRuntime.ts`, `server.ts`, `git.ts`, `keybindings.ts`, and `settings.ts`.

### Step 3: Convert shared contracts first

- Converted all shared contract sources and tests off `./effect-polyfill` and onto direct `Schema` imports from `effect`.
- Rewrote every shared-contract use of unsupported shorthand validators to the installed runtime `is*` forms, including length, numeric-bound, and pattern checks.
- Normalized every shared-contract union to `Schema.Union([..])`, including the large event/command unions in `orchestration.ts`, `providerRuntime.ts`, `terminal.ts`, `ws.ts`, `git.ts`, and `server.ts`.
- Corrected all real enum/option-set schemas to use `Schema.Literals([...])` instead of multi-value `Schema.Literal(...)`, which this runtime decodes incorrectly.
- Fixed the keybindings schemas so `KeybindingsConfig` and `ResolvedKeybindingsConfig` are real schemas again instead of relying on the old polyfill-mediated shorthand construction.
- Preserved contract semantics intentionally: optional fields, literal/tag unions, and decode pipelines were kept on supported runtime helpers rather than being reinvented.

### Step 4: Convert renderer persistence and stores

- Normalized the remaining renderer-side schema imports to `import { Schema } from "effect"` in `src/hooks/useLocalStorage.ts`, `src/stores/composerDraftStore.ts`, and `src/stores/assistant-composerDraftStore.ts`.
- Kept renderer persistence semantics unchanged: supported helpers such as `Schema.Literals(...)`, `Schema.optionalKey(...)`, and existing persisted state shapes remain intact because they are valid on the installed runtime.
- No renderer migration code was required for this schema standardization pass because the renderer files were using supported APIs; only the import path was non-canonical.

### Step 5: Normalize assistant runtime schema usage

- Audited the assistant runtime for mixed schema styles and confirmed the high-risk persistence/orchestration files already use array-form `Schema.Union([..])`.
- No assistant-runtime persistence or IPC schema needed semantic rewrites in this pass beyond consuming the now-standardized shared contracts.
- The main runtime-facing stabilization came from removing non-canonical shared contract behavior at the boot boundary, which is where Electron main had been failing.

### Step 6: Delete the shim

- Deleted `shared/assistant-contracts/effect-polyfill.ts`.
- Confirmed there are no remaining imports of `./effect-polyfill` anywhere in live code or tests.
- No fallback compatibility code remains for the removed shorthand helpers; the codebase now calls the installed `effect` API directly.

### Step 7: Add guardrails

- Added `scripts/check-effect-schema-standardization.mjs` as a repo-level regression check.
- Added `npm run check:effect-schema` to run that guard locally and in CI.
- The guard currently fails on:
  - `./effect-polyfill` imports
  - `effect/Schema` imports
  - unsupported shorthand helpers such as `Schema.maxLength(...)`, `Schema.pattern(...)`, `Schema.greaterThanOrEqualTo(...)`, and related variants
  - variadic `Schema.Union(...)`
  - multi-value `Schema.Literal(...)` usage instead of `Schema.Literals([...])`

### Step 8: Verification

- `npm run check:effect-schema` passed.
- `bun run typecheck` passed.
- `bun run typecheck:assistant-runtime` passed.
- Added `vitest.contracts.config.ts` so the contract/runtime schema tests could actually run outside the repo’s default `tests/**/*.test.ts`-only Vitest config.
- `bunx vitest run --config vitest.contracts.config.ts` passed with 8 files and 82 tests passing.
- Fresh `bun run dev` boot succeeded after the migration: Electron main built, preload built, the renderer dev server started, and Electron reached runtime startup without schema compatibility crashes.
- Residual runtime noise remained limited to the existing non-fatal `shiki` unused-import warning from `@pierre/diffs` and the existing SQLite experimental warning from Electron/Node.
