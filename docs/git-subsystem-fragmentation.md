# Git subsystem: extent of the fragmentation

Survey taken 2026-09-16, before the deferred "status onto projectd" work
(`docs/substrate-phase4-vcs.md` § *Deferred*). Written so the measurement is not
re-derived from scratch. Every claim below is a file and line, not an impression.

**Scale.** 277 files mention Git; 32 are Git-dedicated modules. The subsystem
spans projectd, the Electron main process, the renderer, two contract packages,
Convex and a Cloudflare worker.

**The short version.** There is no Git subsystem. There are eight of them that
happen to shell out to the same binary, and the architecture test meant to hold
the line scans one directory out of five and passes while a merge runs outside
the owner it names.

---

## 1. Eight execution engines

Each spawns `git` itself. Discipline varies from thorough to none.

| # | Engine | Timeout | Output cap | Env discipline | Stale `index.lock` |
| --- | --- | --- | --- | --- | --- |
| 1 | `GitProcess.execute` — `apps/projectd/src/git/GitProcess.ts:198` | 30s | **50MB** | `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `LANG=C` | **yes** (`:37`) |
| 2 | `checkpointOps.executeGit` — `apps/desktop/electron/substrate/vcs/checkpointOps.ts:131` | 30s | **50MB** | full | no |
| 3 | `gitRuntime.runGitCommand` — `apps/desktop/electron/gitRuntime.ts:116` | **only if the caller passes one** | **none** | `GIT_TERMINAL_PROMPT=0` only | no |
| 4 | `registerProjectHandlers.runGitCommand` — `:152` | inherits #3 | inherits #3 | inherits #3 | no |
| 5 | `threadWorktreeService` `promisify(execFile)` — 11 call sites | **none** | **1MB Node default** (32MB at one site, `:580`) | ambient | no |
| 6 | `spawnSync` — `substrate/vcs/bootstrap.ts:128`, `checkpointRefs.ts:81,83` | none | none | ambient | no |
| 7 | `runGhCommand` (`gh` CLI) — `registerProjectHandlers.ts:936` | 15s | **none** | ambient | n/a |
| 8 | `devAppScaffoldPreparation.ts:27` — `spawnSync` behind a `run(cmd, args)` indirection | none | none | ambient | no |

Engine 8 was missed on the first pass of this survey and found only when the
rewritten guardrail was checked for vacuity. It never writes the literal
`spawn("git"`, so neither the old architecture test nor the first version of the
new one could see it — and it is the one engine here that **commits**
(`git add -A`, then `git commit`, at `:95` and `:99`), synchronously, on the
Electron main thread. Worth remembering when judging how much the counts above
can be trusted: a detector only finds the shapes it was taught.

Consequences that are already real, not hypothetical:

- **#3 has no ceiling and no default timeout**, and it is what `mergeTreeWithGit`
  uses to read merged file contents — `readMergedTreeFiles` (`gitRuntime.ts:347`)
  loops `git show` once per file for up to 1000 files, accumulating each into a
  string with `stdout += chunk.toString()` (`:162`).
- **#5 inherits Node's 1MB `execFile` default** at ten of its eleven sites,
  including `git diff --name-status -z` (`:412`). A large enough change set
  fails with `ENOBUFS` rather than a Git error.
- **#6 is synchronous** — `spawnSync` on the Electron **main** thread, so a
  worktree removal or a ref migration blocks the window.
- `stdout += chunk.toString()` in #3, #4 and #7 decodes each chunk
  independently, so a multi-byte character split across a chunk boundary is
  corrupted. #1 and #2 concatenate bytes and decode once.

Only #1 clears a stale `index.lock`. Only #1 and #2 pin the locale they then
parse.

---

## 2. Six output parsers, three of them for status

| Parser | Command shape | Notes |
| --- | --- | --- |
| `GitStatusParser.parsePorcelainV2` — `apps/projectd/src/git/GitStatus.ts:40` | `--porcelain=v2 -z --branch` | caps at `MAX_STATUS_FILES = 5000` |
| `checkpointOps.parsePorcelainStatus` — `:655` | `--porcelain=1 -z` | caps untracked diffs at **50** files |
| `gitSyncShared.parseGitStatus` — `:29` | `--porcelain` v1, **no `-z`** | **dead code, see §8** |
| `checkpointOps.parseNameStatus` — `:361` | `diff --name-status -z` | |
| `threadWorktreeService` inline — `:412` | `diff --name-status -z` | own NUL reader |
| `gitRuntime.parseMergeTreeConflicts` — `:304` | `merge-tree` text | regex over human output |

The two live status parsers disagree on truncation — 5000 files against 50 — so
the header badge, the branch control and the Changes list can describe different
repositories.

The dead one is worse than redundant: it splits on `/\r?\n/` without `-z`
(`:30`), `.trim()`s the path (`:57`), and splits on `" -> "` (`:58`). A filename
containing a newline, a leading space, or that literal arrow corrupts it.

---

## 3. Seven `github.com` URL parsers

Near-identical regexes, none shared:

`GitCredentialBroker.ts:28` · `ScopedNetworkGit.ts:16` **and** `:21` ·
`GitHubSessionPullRequest.ts:39` · `BackgroundRepositoryAuth.ts:25` ·
`SessionPullRequestStore.ts:43` · `gitErrorFormatting.tsx:6,17,28` ·
`SessionMerger.ts:74` (host-agnostic)

They have **already drifted**: `ScopedNetworkGit` accepts
`ssh://git@github.com/`, while `GitHubSessionPullRequest` and
`BackgroundRepositoryAuth` do not. A repository cloned over `ssh://` can be
fetched by background Git but cannot have a pull request opened for it.

The one deliberate shared parser, `shared/collaboration/repositoryUrl.ts`, has
seven importers — **none of them a GitHub API caller**.

---

## 4. Rival error classifiers

Three independent regexes decide "was this an auth failure":

- `gitErrorFormatting.tsx:49` — `could not access|repository not found|authentication failed|permission denied|403|401`
- `sessionCopy.ts:122` — `authentication failed|could not read username|repository not found|permission denied|access denied|403`
- `SessionMerger.ts:267` — `GH006|GH013|protected branch|hook declined|…`

The first two overlap but differ: only one catches `401`, only the other catches
`could not read username` and `access denied`. The same failure gets a different
verdict depending on which screen the person is looking at.

`gitSyncShared.ts` adds three more unused classifiers (`:112`, `:120`, `:131`).

**Localisation.** `apps/desktop/src/lib/i18n/en.ts` holds exactly **two**
GitHub keys. Everything else is hardcoded English: the JSX paragraph in
`gitErrorFormatting.tsx:75`, ~12 messages in `SessionMerger`, the `ConvexError`
in `sessionRepositoryCredentials.ts:74`, `pullRequest.ts:1060-1061`, and the
strings in `registerProjectHandlers`. The Spanish locale has the same two keys,
so every Git failure falls back to English.

---

## 5. Five committer identities

| Identity | Where |
| --- | --- |
| `Cozea Sync <sync@cozea.local>` | `gitSyncShared.ts:3`, `gitRuntime.ts:674` |
| `Cozea <merge@cozea.local>` | `SessionMerger.ts:27` |
| `Cozea AutoGit <autogit@cozea.local>` | `CheckpointBuilder.ts:381`, `IsolatedRebaseResolution.ts:32`, `AutoGitAgent.ts:1443` |
| `cozea@users.noreply.github.com` | `checkpointOps.ts:22` |
| the person's own | `GitService.ts:477` |

## 6. Six ref namespaces

`refs/cozea/checkpoints` · `refs/t3/checkpoints` (legacy) ·
`refs/cozea/rebase-results` · `refs/cozea/rebased` ·
`refs/cozea/rebase-resolution` · `refs/cozea/merge-preview/<sha256>/…`

---

## 7. Two contract universes, drifted

`packages/contracts/src/t3/` is **vendored** from t3code upstream — 41 files
carry `@generated from vendor/t3code/packages/contracts @ 53fc2f7…`, synced by
`scripts/vendor/sync-t3-contracts.mjs`, which writes only to that directory.

`shared/assistant-contracts/` carries **no provenance banner** and is not a sync
target. It is a hand-maintained parallel set that exports **23 of the same
names** as the vendored `git.ts` — with different shapes:

| Export | Vendored `t3/git.ts` | `shared/assistant-contracts/git.ts` |
| --- | --- | --- |
| `GitStackedAction` | 5 values (adds `push`, `create_pr`) | **3 values** |
| `GitCommitStepStatus` | 3 (adds `skipped_not_requested`) | **2** |
| PR state schema | `VcsStatusChangeRequestState` | renamed `GitStatusPrState` |
| `GitRunStackedActionToastRunAction` | present | **absent** |

Same name, same apparent contract, different runtime validation. A value one
accepts, the other rejects.

The drift is systemic, not confined to `git.ts`:

| File | vendored | hand-maintained | diff |
| --- | --- | --- | --- |
| `git.ts` | 465 | 284 | 370 lines |
| `ipc.ts` | 1415 | 198 | 1453 lines |
| `orchestration.ts` | 1900 | 1112 | 1254 lines |
| `settings.ts` | 1215 | 237 | 1321 lines |

---

## 8. Dead and inert code

- **`apps/desktop/electron/services/gitSyncShared.ts`** — 143 lines, a full
  status parser and three error classifiers. **Zero callers.**
- **`apps/desktop/src/lib/git/gitStatusEvents.ts`** — a `window` CustomEvent bus
  (`cozea:git-status-changed`). **No dispatchers, no listeners, not even in
  tests.** Only its own definition matches.
- **The Phase 4a driver is inert in production.** `createGitVcsDriver` is
  constructed only in `tests/electron/substrate/vcs/GitVcsDriver.test.ts`, and
  `GitCorePort` is implemented only there. `bootstrap.ts:115` registers
  `createDelegatingCheckpointOps(legacy)`, which delegates straight back to the
  legacy backend. A whole abstraction layer that adds indirection and no
  behaviour.
- **Nine of eighteen Git IPC channels declared in `preload.ts` have zero
  renderer callers**: `gitCaptureCheckpoint`, `gitDeleteCheckpointRefs`,
  `gitGetHeadDiffStats`, `gitListChanges`, `gitReadChanges`,
  `gitReadChangesPatch`, `gitReadCheckpointFilePair`, `gitReadConflictFile`,
  `gitResolveConflictFile`.

---

## 9. The guardrail does not guard

`tests/architecture/gitOwnerBoundary.test.ts` is the one rule meant to keep Git
in a single owner. It fails at that in three separate ways.

1. **It scans one directory.** `const projectdSrc = path.join(repoRoot, "apps/projectd/src")` (`:15`). Every desktop engine — five of the seven — is outside the scan.
2. **Its matcher would miss most of them anyway.** It looks for the literals `spawn("git"`, `spawn('git'`, `execFile("git"`, `execFile('git'`, `execSync("git`, `execSync('git`. It has **no `spawnSync`** case, so `bootstrap.ts` and `checkpointRefs.ts` are invisible; `gitRuntime` spawns a resolved *variable* path; `threadWorktreeService` calls `exec("git"` through a `promisify` alias. Verified by fixed-string probe: of the six desktop files, only `checkpointOps.ts` would match.
3. **Its ownership assertion is satisfied by coexistence.** It asserts `registerProjectHandlers` "routes Git operations via ProjectdClient" by checking `expect(content).toContain("getSharedProjectdClient")` — that the *string appears somewhere in the file*. It does. And in the same file, `:306` and `:321` run

   ```
   git checkout <collabBranch>
   git merge --no-ff --no-edit <sourceBranch>
   ```

   through engine #3 — the one with no output ceiling and no default timeout —
   bypassing projectd entirely. **The collab-branch merge runs outside the
   canonical owner while the test that names that owner passes.**

---

## 10. Fan-out on the ordinary operations

- **Branch listing — 6 paths:** `GitService.for-each-ref` (`:58`, `:265`) ·
  `ProjectdServer` `git.branches` (`:959`) · `client.gitProjectBranches`
  (`:359`) · `wsNativeApi` `vcsListBranches` (`:238`, a *third* transport) ·
  `t3VcsClient.listBranches` (`:48`) · `GitVcsDriver.listBranches` (`:258`),
  behind a renderer compat shim (`workbenchBranchCompat.ts:9`) whose existence
  implies versioned drift.
- **Checkout — 5 paths:** `GitService.checkout` (`:280`) ·
  `WorkbenchManager` direct `execute` (`:354`, `:385`) · `gitRuntime` `checkout -B`/`--orphan` (`:266`) · `registerProjectHandlers:306` (raw, see §9) ·
  `client.gitCheckout` (`:363`).
- **Worktrees — 7 implementations:** `GitService:329` · `MergeCoordinator:149,194` · `RebaseCoordinator:117,231` · `AutoGitAgent:393,1439,1480` · `threadWorktreeService:178,314,828` · `bootstrap.ts:127` · plus `worktreeOrphanCleanup` and `threadDeletionWorktree` hooks.
- **Transports — 5:** Electron IPC (18 Git channels) · projectd JSON-RPC (7 `git.*` and ~25 `sessions.*`) · a WS native API · Convex actions · a Cloudflare worker.

---

## 11. Suggested order

Cheapest and safest first; each step is independently shippable.

1. **Delete the dead.** `gitSyncShared.ts`, `gitStatusEvents.ts`, the nine
   orphaned IPC channels. No behaviour change, removes a whole broken parser.
2. **Fix the guardrail before consolidating**, or consolidation will silently
   regress: scan all five roots, add `spawnSync`, and replace the
   string-presence assertion with one that no Git verb is executed outside the
   owner. This step is what makes the rest hold.
3. **Route `registerProjectHandlers:306/:321` through projectd.** A merge should
   not run on the least disciplined engine.
4. **Retire engines #4–#7 onto #1/#2.** Start with `threadWorktreeService` — its
   1MB default cap is a live failure, not a tidiness issue.
5. **One GitHub host client**: one URL parser, one token source, one bounded
   read, one error vocabulary. Subsumes §3 and §4.
6. **Decide the contract story.** Either `shared/assistant-contracts` becomes a
   sync target with provenance, or it is deleted in favour of the vendored set.
   Today it is a fork nobody declared.
7. **Then** the deferred status consolidation (`substrate-phase4-vcs.md`). It is
   a different axis from all of the above and should come last, not first.

Note that steps 1–4 remove most of the argument for step 7: the uncapped-output
and missing-env-discipline case for moving status onto projectd was already
answered for `checkpointOps` on 2026-09-16.

---

## 12. Status

**Step 1 — done (2026-09-16).** Deleted `gitSyncShared.ts` (143 lines) and
`gitStatusEvents.ts` (19 lines), and removed nine Git IPC channels that the
preload bridge declared with no renderer caller, across all three layers
(`preload.ts`, `registerWorkspaceSyncHandlers.ts`, `electronApiTypes.ts`).
`gitReadConflictFile`/`gitResolveConflictFile` went with them: the page that
would have used them, `ProjectConflictsPage.tsx`, no longer exists, so the
"Conflict read/resolve" line in `substrate-phase4-vcs.md`'s overlay contract was
stale and has been corrected rather than left asserting something untrue.

**Step 2 — done (2026-09-16).** `gitOwnerBoundary.test.ts` rewritten. It now
scans seven roots instead of one, recognises `spawnSync`, the `run("git", …)`
indirection and a resolved executable path, pins the known engines as a
shrinking ratchet, and keeps the retired channels retired. Two of its assertions
exist because the first rewrite failed them: one proves the detector is not
vacuous (an early version pinned two engines it could not actually see), and the
mutation check records the `mergeLaneIntoCollab` violation explicitly instead of
being satisfied by a string appearing somewhere in the file.

**Step 3 — blocked, deliberately.** Routing `registerProjectHandlers:306/:321`
through projectd needs a generic merge RPC that does not exist; projectd offers
only session-scoped `sessions.merge`. That is a daemon protocol change and is
not bundled here. The violation is now asserted and bounded by step 2 rather
than invisible.

**Step 4 — partial.** `gitRuntime.runGitCommand` gained a 50MB ceiling, a
120s default deadline, `LC_ALL`/`LANG=C`, and byte-accurate decoding — which
also covers engine #4 and the merge path in step 3, since both go through it.
`threadWorktreeService`'s eleven `exec` sites gained a 64MB ceiling and a
deadline in place of Node's 1MB default. `devAppScaffoldPreparation.runCommand`
— engine #8, the one that commits — gained a 16MB ceiling; it already had a
five-minute deadline but ran on `spawnSync`'s 1MB default. None of these engines
is *retired* yet; they are merely no longer able to fail in the ways that were
reachable.

**Steps 5–7 — not started.**
