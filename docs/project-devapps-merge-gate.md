# PR #70 (`feat/project-devapps`) — Convex merge & deploy gate

Operator checklist for landing [PR #70](https://github.com/Cozea/electron-app/pull/70)
without breaking the production Convex deployment
(`https://your-deployment.convex.cloud`) or already-installed desktop clients.

This repo runs **production Convex only**. Every deploy in this document is
`bunx convex deploy`. Never run `convex dev` / `bunx convex dev --once` — it
repoints the app at a dev deployment.

---

## 1. TL;DR

- The schema change is **purely additive**, so deploying it does not invalidate
  any document that old clients already write.
- The new app **cannot run against the current production functions**: it calls
  `projects.listSummariesForCurrentUser` (project sidebar) and
  `projects.getArtifacts` (Tasks page), neither of which exists in prod today.
  **Convex must be deployed before the new build ships.**
- The one genuinely dangerous item — automatic server-side Yjs compaction — is
  gated off in this branch (`YJS_SERVER_SIDE_COMPACTION_ENABLED = false` in
  `convex/yjs.ts`). Confirm that constant is still `false` before deploying.
- Everything else new (`devApps.*`, `projects.setSourceControl`, `creationToken`,
  `status: "provisioning"` writes, `projectFiles.*` auth args) is **dormant**:
  no caller on either branch, or read-only recovery paths.
- Rollback is effectively one-way once the new build runs. Plan forward-fix, not
  revert.

---

## 2. What is actually in the Convex diff

| File | Change | Live on day one? |
| --- | --- | --- |
| `convex/schema.ts` | Adds `projects.repo`, `projects.creationToken`, `status: "provisioning"`, `by_creation_token` index, and 4 tables: `projectArtifacts`, `projectSyncState`, `devAppPublications`, `devAppReleases` | Yes (`projectArtifacts`, `projectSyncState`, `repo`) |
| `convex/projects.ts` | Adds `listSummariesForCurrentUser`, `getArtifacts`, `setSourceControl`; removes `updateFrameworkInfo`; routes artifacts + git metrics into the split tables | Yes, except `setSourceControl` (no callers) |
| `convex/crons.ts` | New 5-minute cron calling `projectPresence.cleanupStale` | Yes |
| `convex/projectPresence.ts` | `cleanupStale` switches from a post-filter to a real `by_heartbeat` index range | Yes |
| `convex/yjs.ts` | Auto-compaction nudge every 128 updates — **gated off** | No (gated) |
| `convex/projectFiles.ts` | Adds required `userId` args + membership gates | No callers anywhere |
| `convex/devApps.ts` | New file, `internalQuery`/`internalMutation` only | No callers |
| `convex/lib/workspaceLimits.ts` | Reads `repoBytes` from `projectSyncState` first, falls back to the inline field | Yes |
| `convex/users.ts` | Cosmetic spread cleanup | Yes, no behavior change |

### Old-client compatibility after deploy

Verified by grepping `origin/main` for every affected symbol:

- `updateFrameworkInfo` — **no callers on main**. Safe to remove.
- `projectFiles.*` — **no callers on main or the branch**. The new required
  `userId` args are a breaking signature change on dead surface; harmless today
  and a security improvement whenever that surface is revived.
- `project.gitSyncState` — **no readers anywhere**. Old clients will not notice
  that metrics moved to `projectSyncState`.
- `projects.update` — still accepts `visuals` / `generatedPlan`, but the
  validators tighten from `v.any()` to the schema shapes, and the values now
  land in `projectArtifacts` instead of on the project doc. An old client that
  edits wizard artifacts will write them where it cannot read them back, so the
  edit looks like it did not stick. Cosmetic, only on the legacy wizard path.
- `projects.update` no longer re-slugs on rename. Intentional; slugs are
  identifiers, not labels.

---

## 3. Pre-merge decisions

### 3.1 Yjs server-side compaction — decision: **OFF** (already gated)

Do not ship the auto-compaction nudge. The reasoning, so nobody flips it back
without doing the work:

`yjsUpdates.update` rows are A256GCM cipher envelopes — `insertSequencedUpdate`
enforces that via `assertEncryptedPayloadMatchesActiveKey`, and `saveSnapshot`
enforces the matching `yjs_snapshot` envelope. But `maybeCompactProject` →
`loadServerState` feeds those ciphertext bytes straight into `Y.applyUpdate`,
writes the resulting **plaintext** `Y.encodeStateAsUpdate` blob directly into
`yjsDocuments` (bypassing the envelope check), and then deletes **every**
`yjsUpdates` row at or below the snapshot seq.

Two outcomes, both bad:

1. `Y.applyUpdate` throws on the ciphertext — the scheduled mutation fails every
   128 updates per project, forever, as error noise.
2. It does not throw — an empty or garbage snapshot is written and the real
   update history is deleted. Unrecoverable.

`maybeCompactProject` has existed in production for a while with **zero
callers**; PR #70 would be the first time it ever executes. Meanwhile
`src/contexts/YjsProjectContext.tsx` already snapshots and prunes correctly via
`saveSnapshot` + `cleanupOldUpdates`, so the server path buys nothing.

**Action:** verify `convex/yjs.ts` still reads:

```ts
const YJS_SERVER_SIDE_COMPACTION_ENABLED: boolean = false
```

Re-enabling it later requires making `maybeCompactProject` encryption-aware
(client-driven snapshotting, or a decrypt-capable path) — treat that as its own
PR with its own review.

### 3.2 Presence cleanup cron — decision: **ON**, after one dashboard check

The cron is a genuine improvement: `projectPresence` currently only ever grows,
because `getActiveUsers` filters stale rows out at read time rather than
deleting them. `cleanupStale` is args-less, idempotent, needs no auth, and the
index fix makes it a real range scan.

The one hazard: `cleanupStale` does an unbounded `.collect()` of everything
older than `PRESENCE_TIMEOUT_MS * 2` (2 minutes). Convex caps a transaction at
~16,384 documents scanned. If production has accumulated more stale presence
rows than that, the very first cron run fails — and then keeps failing every 5
minutes.

**Action before deploy:** open the Convex dashboard, check the `projectPresence`
row count.

- Under ~10,000 rows: ship the cron as-is. The first run drains the backlog.
- Above that: either clear the table manually first, or bound the cleanup. The
  bounded version is a two-line change:

```ts
const stalePresences = await ctx.db
  .query("projectPresence")
  .withIndex("by_heartbeat", (q) => q.lt("lastHeartbeat", cutoff))
  .take(1024)
```

  Bounded is still correct — the cron re-runs every 5 minutes and drains the
  backlog over a few passes.

If you would rather not take the cron at all in this PR, comment out the
`crons.interval(...)` block; nothing else depends on it.

### 3.3 Merge conflicts (blocks everything else)

PR #70 is currently `mergeable_state: dirty`. Conflicts against `main`:

- `package.json`
- `src/features/projects/hooks/useWorkbenchDockviewRuntime.ts`

Neither is a Convex file. Resolve them before any of the below.

---

## 4. Merge → deploy → verify → release order

The ordering constraint is one-directional: **new schema is safe for old
clients, new clients are not safe against old functions.** So Convex goes first,
and the desktop release goes second.

1. **Resolve conflicts** on `feat/project-devapps` (rebase or merge `main`).
2. **Confirm the two pre-merge decisions** from §3 are in the tree:
   - `YJS_SERVER_SIDE_COMPACTION_ENABLED` is `false`
   - the cron matches whichever option you picked in §3.2
3. **Gate checks**, from the repo root:

   ```shell
   bun install
   bun run typecheck
   bun run lint
   ```

4. **Merge the PR into `main`.** No Convex change has shipped yet, so `main` is
   momentarily ahead of the deployment. That is fine — nothing auto-deploys
   Convex.
5. **Deploy Convex from `main`**, on a machine with production Convex
   credentials:

   ```shell
   git checkout main && git pull
   bunx convex deploy
   ```

   Never `convex dev`.
6. **Run the post-deploy verification in §5.** Old clients in the field are
   still talking to this deployment throughout, so verify before shipping any
   binary.
7. **Only then cut the desktop release**, per `docs/release-process.md`:

   ```shell
   # bump package.json, then
   bun install
   git add package.json bun.lock
   git commit -m "chore: prepare vX.Y.Z release"
   git tag vX.Y.Z
   git push origin HEAD && git push origin vX.Y.Z
   ```

   Consider a `beta` or `canary` lane first — it exercises the new function
   surface against production Convex with a small blast radius.

---

## 5. Post-deploy verification

Run these against production before shipping a binary. Steps 1–3 are the merge
gate proper; 4–6 are the watch list for the first hour.

1. **Schema pushed cleanly.** `bunx convex deploy` fails loudly if any existing
   document violates the new schema. A clean exit is the additive-schema proof.
2. **New functions exist.** In the Convex dashboard function list, confirm
   `projects:listSummariesForCurrentUser`, `projects:getArtifacts`, and
   `projects:setSourceControl` are present, and `projects:updateFrameworkInfo`
   is gone.
3. **Old client still works.** Launch the currently-released desktop build
   (not a local dev build) against production: sign in, open the project list,
   open a project workbench, make a collaborative edit. No `ArgumentValidationError`
   in the Convex logs.
4. **New client works.** Run `bun run dev` from `main`: the project sidebar
   populates (proves `listSummariesForCurrentUser`), the Tasks page loads
   (proves `getArtifacts`), and creating a project produces a `projectArtifacts`
   row alongside the `projects` row.
5. **Cron is healthy.** Dashboard → Schedules → `cleanup stale project presence`.
   After ~10 minutes you want successful runs and a `projectPresence` row count
   that is flat or falling. Repeated failures mean the backlog exceeded the
   read limit — apply the `.take(1024)` bound from §3.2 and redeploy.
6. **Compaction stayed asleep.** Search the Convex logs for
   `maybeCompactProject`. Expected: **zero** invocations. Any hit means the gate
   was flipped; disable it and redeploy immediately, then audit `yjsUpdates` and
   `yjsDocuments` row counts per project for unexpected drops.

---

## 6. Rollback reality

**Reverting the Convex deploy is not a rollback path.** Convex validates every
existing document against the schema you deploy, so once the new build has
written even one project, redeploying the old schema fails:

- `projects.repo` — written by `projects.create` whenever a repo URL is present
  (import flows, "create GitHub repo"). Not in the old schema.
- `projectArtifacts` — written on every create/update that carries wizard
  artifacts. A non-empty table missing from the schema fails validation.
- `projectSyncState` — written by `setProjectGitStorageMetricsForServer` on the
  first background git sync.
- `projects.status: "provisioning"` and `projects.creationToken` — currently
  **not written by any client** (`provisioning` is only read, by the stuck-saga
  recovery path in `useProjectWorkspaceActions.ts`; `creationToken` has no
  caller). These stay clean unless a future change starts writing them.
- `devAppPublications` / `devAppReleases` — no callers, so these stay empty and
  are not a rollback obstacle today.

To actually revert you would need a data migration first: strip `repo` from
every project doc, empty `projectArtifacts` and `projectSyncState`, then deploy
the old schema. Client data written into those tables is lost in the process.

**Therefore: forward-fix only.** If something breaks after deploy, ship a
corrected Convex deploy rather than reverting. The desktop side is separately
recoverable — old builds keep working against the new deployment (§2), so
pulling or pausing a release is a real and cheap mitigation.

---

## 7. Ready to merge when

- [ ] `package.json` and `useWorkbenchDockviewRuntime.ts` conflicts resolved
- [ ] `YJS_SERVER_SIDE_COMPACTION_ENABLED` confirmed `false`
- [ ] `projectPresence` row count checked; cron shipped as-is or bounded
- [ ] `bun run typecheck` and `bun run lint` pass
- [ ] Deploy owner is lined up to run `bunx convex deploy` from `main`
      immediately after merge, before any release tag
