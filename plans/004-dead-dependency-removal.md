# Plan 004 — Remove dead dependencies (and the HIGH advisories they drag in)

- **Status**: TODO
- **Written against**: commit `8a807045` (dirty working tree; see Drift check)
- **Category**: dependencies / security hygiene
- **Effort**: S (a few hours including verification)
- **Risk of change**: low (every removal verified import-free; full gate re-run)

## Why this matters

Cozea is an Electron desktop app packaged with electron-builder; dependencies in `package.json` `"dependencies"` end up in the shipped artifact (the builder config even special-cases some of them for the universal build). Six dependency groups are **confirmed unused at every import site** (verified by grep across `src/`, `electron/`, `server/src/`, `shared/`, `packages/`, `scripts/` at plan time):

| Dependency | package.json line | Why it's dead | Bonus for removing |
|---|---|---|---|
| `react-router-dom` ^7.12.0 | :154 | Zero imports; routing is `@tanstack/react-router` (:107). `scripts/migrate-router.mjs` is the completed migration script. | Kills the `react-router` HIGH advisories (`bun audit`: turbo-stream RCE, path-expansion DoS in >=7.0.0 <=7.14.1) |
| `framer-motion` ^12.29.2 | :133 | Zero imports | Also delete its stale chunk rule at `electron.vite.config.ts:121` (`normalizedId.includes('/node_modules/framer-motion/')`) |
| `motion` ^12.26.2 | :141 | Zero imports (it's framer-motion's successor — both were added, neither used) | — |
| `@stripe/react-stripe-js` ^5.4.1 + `@stripe/stripe-js` ^8.6.1 | :103-104 | Zero imports in src/electron/server. Payments are an unstarted plan (`docs/payment-system-migration.md`, `docs/stripe-sandbox.md`); re-add when the work actually starts | — |
| `better-sqlite3` ^12.8.0 | :120 | Zero imports; the codebase uses `node:sqlite` (`electron/assistant-runtime/persistence/NodeSqliteClient.ts:3` — "instead of `better-sqlite3`") | Drops a multi-MB native module per arch; also delete its entry from `macUniversalX64ArchFilePackages` (`electron-builder.config.cjs:21`, `"better-sqlite3/build/Release"`) |
| `wait-on` ^9.0.4 | :164 | Zero imports; CLI utility | Its transitive `axios` carries 12+ HIGH advisories per `bun audit`. If some dev script shells out to `wait-on` (grep first — at plan time nothing did), move to devDependencies instead of deleting |
| `@types/diff-match-patch` :109, `@types/lodash-es` :110 | — | Type packages in `"dependencies"` — move to `"devDependencies"` | — |

Do **NOT** touch (verified in use or deliberate):

- `@railway/cli` (devDependencies) — referenced by the integrations feature (`electron/integrationToolExecutor.ts`, `src/lib/integrations/registry.ts`) and listed in `electron-builder.config.cjs` arch packages. In use.
- `effect`, `@effect/platform-node`, `@effect/sql-sqlite-bun`, `@effect/vitest` pkg.pr.new pins — deliberate (AGENTS.md "Effect (effect-smol) pin"); a repin is an API migration, not part of this plan.
- `@legendapp/list` beta pin — patched via postinstall (`scripts/apply-legend-list-patch.mjs`); deliberate.
- `yjs` `14.0.0-16` prerelease pin — in active use by collab; do not change here (worth a one-line comment/doc explaining the pin, optional bonus, no version change).
- `react-icons` / `@react-symbols/icons` / `@hugeicons/*` — all have imports; icon consolidation is not worth the churn (rejected during audit).

## Implementation steps

Use `bun` for everything.

1. **Re-verify each removal is still dead** (the tree moves fast here):
   ```sh
   for dep in react-router-dom framer-motion "from ['\"]motion" @stripe/react-stripe-js @stripe/stripe-js better-sqlite3 wait-on; do
     echo "== $dep"; rg "$dep" src electron server/src shared packages scripts \
       --glob '!**/node_modules/**' -l || echo "  no hits"
   done
   ```
   Expected: no hits anywhere except `package.json`/lockfile, the `NodeSqliteClient.ts` comment, `electron.vite.config.ts:121` (framer-motion chunk rule), and `electron-builder.config.cjs:21` (better-sqlite3 arch entry). **If any dep gained a real import since plan time, drop it from this plan and note it in the report — do not "fix" the import.**

2. **Edit `package.json`**: remove the six dead deps; move the two `@types/*` entries to `devDependencies`. Decision point for `wait-on`: delete if step 1 found no script usage, else move to devDependencies.

3. **Clean the two config references**: `electron.vite.config.ts:121` (delete the framer-motion line from the chunking condition) and `electron-builder.config.cjs:21` (delete the `"better-sqlite3/build/Release"` array entry).

4. **Reinstall and re-patch**: `bun install`. Watch the postinstall output — `scripts/apply-legend-list-patch.mjs` and `scripts/apply-effect-rpc-jsonrpc-id-patch.mjs` must both still succeed (they throw loudly if their anchors vanish).

5. **Run `bun audit` before/after** and capture both outputs in the PR description. Expected: the `react-router` HIGH advisories disappear; if `wait-on` was deleted, the `axios`-via-wait-on chain disappears. (Most remaining HIGHs are via build-time tools — `electron-builder`→`tar`, `@electron/osx-sign`→`@xmldom/xmldom` — and `mcp-repo-search`→`simple-git`; record them as the known residue, they are NOT in scope.)

6. **Full verification gate**:
   - `bun run typecheck` && `bun run typecheck:assistant-runtime` && `bun run lint` → exit 0
   - `bunx vitest run` (Node, never `--bun`) → no new failures vs. baseline (known pre-existing: `tests/electron/assistant-runtime/main.test.ts`, 11 CLI-boot timeouts)
   - `bun run build` → completes (this exercises electron-vite with the edited chunk rule)
   - Smoke: `bun run dev` → app opens, navigate between two projects, open a terminal tile, load a page in the browser tile.

## Test plan

No new tests — removals of unimported code are covered by the build + full suite. The machine-checkable criteria below are the regression net.

## Hard boundaries

- In scope: `package.json`, `bun.lock` (via `bun install`), `electron.vite.config.ts` (one line), `electron-builder.config.cjs` (one array entry).
- Out of scope: every other dependency (especially the effect-smol pins, yjs, @legendapp/list), all upgrade work (electron 41, zod v3→v4 in `server/`, execa ^5 — separately tracked findings), `scripts/migrate-router.mjs` (harmless historical artifact; leave it), and ANY source-code change beyond the two config lines.
- Do not run `bun update`. Do not regenerate the lockfile beyond what `bun install` does for the removals.

## Done criteria (machine-checkable)

1. `node -e "const p=require('./package.json'); const dead=['react-router-dom','framer-motion','motion','@stripe/react-stripe-js','@stripe/stripe-js','better-sqlite3','wait-on']; const hit=dead.filter(d=>p.dependencies[d]); console.log(hit); process.exit(hit.length?1:0)"` → exit 0 (adjust if `wait-on` legitimately moved to devDependencies).
2. `rg "framer-motion" electron.vite.config.ts` → no hits; `rg "better-sqlite3" electron-builder.config.cjs` → no hits.
3. `bun audit` no longer lists `react-router`.
4. `bun run build` exit 0; `bunx vitest run` parity with baseline.

## Drift check

Re-run step 1 verbatim before editing. Citations are from a dirty tree at `8a807045`; if `package.json` lines shifted, match by name not line.

## Escape hatches

- If `bun install` postinstall throws (patch anchor missing), STOP — do not edit the patch scripts; report.
- If `bun run build` fails on the chunk-rule edit, revert just that line and report (the rule may be load-bearing for an unrelated glob).

## Maintenance note

The repo has a pattern of "deps added for planned features" (Stripe) — when re-adding, do it in the PR that introduces the first import. After this lands, `bun audit` becomes a meaningful signal; consider adding it (non-blocking) to CI later.
