# Plan 003 — Typecheck the whole Electron main process (and close the fmt gate)

- **Status**: TODO
- **Written against**: commit `8a807045` (dirty working tree; see Drift check)
- **Category**: DX / correctness-prevention
- **Effort**: M (half a day to two days, depending on how many latent errors surface)
- **Risk of change**: low–medium (no runtime changes intended; risk is scope creep from fixing surfaced errors)

## Why this matters

The most security- and stability-critical code in this Electron app — `electron/main.ts`, `electron/preload.ts`, all 14 IPC handler modules in `electron/ipc/`, ~29 services in `electron/services/`, the SQLite workspace catalog in `electron/workspaces/`, `electron/workbench-runtime/`, `electron/runtime/` — is **typechecked by no tsconfig and no CI step**. `electron-vite` builds it with esbuild/rollup, which strips types without checking them.

Verified state of the four root tsconfigs:

- `tsconfig.app.json:40-41`: `"include": ["src"]`, `"exclude": ["convex", "src/app"]` → renderer only (and `src/app` doesn't exist — stale exclude).
- `tsconfig.assistant-runtime.json` includes only `electron/assistant-runtime/**`, `shared/assistant-contracts/**`, `shared/assistant-shared/**`.
- `tsconfig.node.json` includes only `["vite.config.ts"]` — **a file that does not exist** (the real config is `electron.vite.config.ts`), so this project typechecks nothing at all.
- `tsconfig.json` is just references to app + node.

CI (`.circleci/config.yml`, `verify` job) runs `bun run typecheck` (app), `bun run typecheck:assistant-runtime`, `bun run lint`, `bun run test` — so the gap is real in CI too. Separately, `bun run fmt:check` (`oxfmt --check .`, `package.json:36`) is wired in package.json but never run in CI.

This class of gap has already shipped real bugs in this repo: the workspace catalog's snake_case row casts silently reading `undefined` (2026-06-12) lived exactly in this un-typechecked zone. (tsc wouldn't catch that specific cast, but the zone having *no* gate at all is why drift accumulates.)

## Implementation steps

Use `bun` for all commands.

1. **Create `tsconfig.electron.json`** at repo root, copying compiler options from `tsconfig.assistant-runtime.json` (same target/lib/`types: ["node"]`/strict family/paths — see that file for the exact block) with:
   ```jsonc
   "include": [
     "electron/**/*.ts",
     "shared/**/*.ts"
   ],
   "exclude": [
     "electron/assistant-runtime"   // already covered by tsconfig.assistant-runtime.json
   ]
   ```
   Note `electron/preload.ts` imports from `../shared/electronApiTypes` and electron types — add `"types": ["node"]` and let `electron` types come via imports (the `electron` package ships its own d.ts). If `lib` needs `DOM` for preload (it touches no DOM at plan time, but `MessageBoxOptions` etc. come from `electron` types which are DOM-free), adjust only if errors demand it.

2. **Add the script and run it**: in `package.json` scripts, add `"typecheck:electron": "tsc --project tsconfig.electron.json"`. Run it. Expect a non-trivial error list on first run — **this is the measurement step**; record the count in your report.

3. **Triage the surfaced errors into three buckets** and handle in this order:
   - Config noise (missing lib/types, alias resolution): fix in the tsconfig.
   - Real latent bugs (wrong types that reflect wrong behavior — e.g. stale interfaces vs. current IPC payloads): fix the code, smallest safe change; each one is a separate commit-worthy fix with a sentence of justification in the PR description.
   - Legitimately hard effect-typing errors (same class as the known 46 `@ts-nocheck` files): per repo rule **do not add new `@ts-nocheck`**. If a file is genuinely blocked on effect-smol typing, exclude that specific file in `tsconfig.electron.json` with a `// see plans/003` comment in the exclude list, and list every exclusion in your report. Target: zero exclusions outside `electron/workspaces/` Effect-heavy files, ideally zero at all.
   - **Escape hatch**: if the initial error count exceeds ~150, STOP after triaging into buckets and report the breakdown instead of fixing — the maintainer may want to split the cleanup.

4. **Wire CI**: in `.circleci/config.yml` `verify` job, after the "Typecheck assistant runtime" step, add:
   ```yaml
   - run:
       name: Typecheck electron main
       command: |
         source "$BASH_ENV"
         bun run typecheck:electron
   ```

5. **Fix `tsconfig.node.json`** to include the files that actually exist: `electron.vite.config.ts`, `vitest.config.ts`, `vitest.assistant-runtime.config.ts`, `vitest.contracts.config.ts`, `electron-builder.config.cjs` is CJS — leave it out. Run `tsc --project tsconfig.node.json` and fix/report errors the same way. Also remove the stale `"src/app"` from `tsconfig.app.json`'s exclude (the directory doesn't exist).

6. **Add `fmt:check` to CI** — but first run `bun run fmt:check` locally. If it reports drift, run `bun run fmt` once as its own isolated commit ("chore: apply oxfmt") so the formatting commit and the typecheck work don't mix, THEN add to the `verify` job:
   ```yaml
   - run:
       name: Format check
       command: |
         source "$BASH_ENV"
         bun run fmt:check
   ```
   **Escape hatch**: if `fmt` reformats more than ~50 files, stop and confirm with the maintainer before committing the churn (it can wreck open branches' merges — there is at least one large in-flight branch).

7. **Full verification**: `bun run typecheck && bun run typecheck:assistant-runtime && bun run typecheck:electron && bun run lint && bunx vitest run` (run vitest under Node via `bunx`, never `bun --bun`). Pre-existing known failure: `tests/electron/assistant-runtime/main.test.ts` (11 CLI-boot timeouts at clean HEAD) — not yours unless your diff touches CLI boot.

## Test plan

No new runtime tests — the deliverable IS a gate. The done criteria below are the tests. If step 3 fixes any real latent bug with observable behavior, add a focused regression test next to the closest existing suite (e.g. workspace catalog fixes → extend `tests/workspace/workspaceCatalog.test.ts`, which is the house pattern for catalog contract tests).

## Hard boundaries

- In scope: new `tsconfig.electron.json`, `package.json` (one script line), `.circleci/config.yml` (two steps), `tsconfig.node.json`, `tsconfig.app.json` (stale exclude only), and minimal code fixes for surfaced type errors inside `electron/` and `shared/`.
- Out of scope: `electron/assistant-runtime/**` (own config, own debt), refactors beyond what an error demands, `src/`, `convex/`, `server/` (server has its own `server/tsconfig.json` — wiring it into CI is a reasonable follow-up but NOT this plan), dependency changes, and the 46 existing `@ts-nocheck` files.
- Never weaken compiler options to make errors disappear (`strict` stays on; no `skipLibCheck` changes — it's already true; no `any`-casting sprees).

## Done criteria (machine-checkable)

1. `bun run typecheck:electron` → exit 0.
2. `tsc --project tsconfig.node.json` → exit 0, and its include list contains only files that exist.
3. `grep -c "typecheck:electron" .circleci/config.yml` → ≥1; `grep -c "fmt:check" .circleci/config.yml` → ≥1.
4. `rg "@ts-nocheck" electron/ --glob '!electron/assistant-runtime/**'` → no NEW hits versus baseline (capture baseline list before starting).
5. `bunx vitest run` → no new failures versus baseline.

## Drift check

Re-verify the tsconfig contents before starting (`cat tsconfig.node.json`) — if someone already fixed the includes or added an electron project, reconcile with what exists instead of duplicating. Line numbers cited are from a dirty tree at `8a807045`.

## Maintenance note

Whenever a new top-level directory of TS appears (e.g. `cloudflare/worker` has its own tsconfig today), the question "which tsconfig checks this, and does CI run it?" must be answered in the PR. Consider a follow-up that runs `server/tsconfig.json` (`cd server && tsc`) in CI — at plan time `server/` (85 files) is also unchecked in CI; it was deliberately left out of this plan to bound scope.
