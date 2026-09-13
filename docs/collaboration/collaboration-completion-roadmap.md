# Collaboration Completion Roadmap (canonical)

**Authoritative specification:** `docs/collaboration/collaboration-autogit-master-plan.md`
(P00–P27, Section 32 acceptance matrix).
**Evidence ledger:** `docs/collaboration/collaboration-autogit-status.md`
**Point-in-time audit:** `docs/collaboration/repository-progress-audit-2026-09-12.md`

## Current status (executor updates this block every turn)

- Current phase: **1 — P11 binary closure**
- Current checkpoint: **1B — Collaboration → filesystem materialization**
- Blocking gate: B01–B05 executable + memory gate
- Next authorized work: 1B only
- Branch: `feat/collab-step3-session-ui` · 1A closed (see ledger 2026-09-13 1A entry)
- Closed: Phase 0 (baseline green); 1A (upload chain + restart replay + defer-not-brick; full suite 445 files / 3,172 passed)

## How this file is used

**Roadmap = what remains, and in what order. Ledger = what was done and what
evidence proves it.** Nothing else is the source of truth — not chat memory,
not continuity notes, not stale phase labels.

Frozen sequence, no exceptions:

**0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**

- Work only inside the current checkpoint. When it closes, check its box,
  append the evidence entry to the ledger, commit both, then advance.
- A finding that belongs to a later phase is **recorded under that later
  phase, never implemented now**. Discovering P21 work during P11 does not
  authorize P21 work.
- No opportunistic architectural work between stages.
- Per the master-plan checkpoint rule (§0.2): define the observable exit
  condition first, implement only what closes it, run narrow tests, run the
  relevant full regression, inspect ownership/duplicate paths, update the
  ledger, commit, advance.
- Do not re-execute stale TODOs blindly. The area table below corrects old
  ledger entries (notably P13/P14); verification replaces redesign wherever
  the architecture is already present.

## `continue` protocol

Whenever the operator says **continue**, the executor first reads this file
and the ledger, then reports exactly:

> Current phase: N — name
> Current checkpoint: NX — name
> Blocking gate: <gate>
> Next authorized work: NX only
> Later work (do not touch yet): <list>

Then works only inside NX.

## Where we actually are

| Area | Actual state | What remains |
| ---- | ------------ | ------------ |
| P01–P10 core substrate | Essentially implemented | Regression coverage, not redesign |
| P03 background daemon | Implemented (`KeepAlive` LaunchAgent; Electron is only a client) | Packaged/macOS qualification |
| P11 binaries | Partially implemented, current focus | Every path + AutoGit publication + acceptance |
| P12 control plane | Implemented | Access/invite acceptance matrix |
| P13 Session Workbenches | Implemented after the old ledger entry (`WorkbenchManager` persists ordinary/session Workbenches, dedicated session repos, one active WB per project/device, switching without killing background sync) | Remove residual branch-derived identity; qualification |
| P14 create/share UX | Substantially implemented (new/existing branch, dirty include/exclude, dedicated Session WB, env policy, source-folder preservation) | Acceptance matrix |
| P15 invite/resume | Substantially implemented | Failure/retry qualification |
| P16–P22 AutoGit/Git | Substantially implemented (isolated rebase + durable `RebaseJournal` in active use) | Real GitHub/two-device qualification + binary publication cleanup |
| P23 Electron cutover | Partial (dual system kept deliberately; `collaborationGate.ts` gates session WBs to projectd until P26) | Session/Workbench identity everywhere; no renderer-owned lifetime |
| P24 capabilities | Tested in isolation | Packaged integration qualification |
| P25 media | Not implemented / deliberately deferred (stub removed) | Real microphone/media system |
| P26 legacy/Git-owner removal | Not done (`YjsProjectContext`, `CollabWsProvider`, `useYjsFileWriteback`, `gitSyncService` still have production callers) | Delete old engine; consolidate Git |
| P27 release qualification | Not run / blocked | Deploy + signed package + two physical Macs + full matrix |

---

## Phase 0 — Restore green baseline

Nothing else is developed until the branch has one known-good checkpoint.

- [x] **0A — Reproduce and classify every red gate.** The streaming-host-upload
  regression waits 5s for the host to publish the staged binary. Determine
  exactly which is true: production upload path stuck; staging succeeds but
  replay unscheduled; upload occurs but test observes wrong state; or CI
  contention makes 5s unrealistic. Do NOT fix by casually raising a timeout.
  Instrument the exact transition:
  `scan → stable read → stageFrom → retained record → uploadFrom → cache →
  BinaryRevision → queue/outbox → retained record deletion`.
- [x] **0B — Close the projectd type error** (`main.ts:26`, optional
  `roomKeyBase64` vs required descriptor field) at the type boundary, not
  with a cast that hides a missing-key state.
- [x] **0C — Close the LFS-pointer `cwd` assertion** via canonicalized paths
  (`realpath` both sides), not by weakening the assertion.
- [x] **0D — Full verification green:** `bun run typecheck`,
  `typecheck:projectd`, `typecheck:electron`, `typecheck:tests`,
  `typecheck:cloudflare`, projectd build, full Vitest, production build,
  Electron validation.
- [x] **0E — Record head + results in the ledger.**

**Gate:** all of 0D green at one commit.
**Out of scope until later:** any P11–P27 behavior change.
**Advance condition:** ledger entry with head SHA and green results exists.

---

## Phase 1 — P11 binary closure (master plan §P11; matrix B01–B05)

Only substantial data-path phase still open. **Do not redesign the binary
protocol**: fixed 4 MiB encrypted immutable chunks, whole-object hashes, and
resume-by-verify-on-retry stay.

- [x] **1A — Filesystem → collaboration upload.** Qualify the production
  sequence end to end: large-file stable streaming hash → encrypted durable
  `PendingBinaryStore` → `stageFrom()` → bounded retained range reads →
  `uploadFrom()` → verified cache → restart replay → crash-orphan cleanup,
  including the Phase-0 host regression.
- [ ] **1B — Collaboration → filesystem materialization.** Production path:
  `binary object → decrypt/verify chunks → verified cache → atomic temp file
  → SHA-256 verify → rename`. Keep the buffered fallback only for
  test/custom transports lacking the streaming interface; production must
  never select it.
- [ ] **1C — First-attach bounded binary comparison.** `adoptMatchingFiles()`
  must stop reading whole binaries to compare: `StableFileReader.readMetadata()`
  → streamed SHA-256 → compare with `BinaryRevision` hash. Only text below
  the text-size ceiling may be materialized into a `Buffer`.
- [ ] **1D — Bounded external-Git binary adoption.** Replace
  `SessionFileChange.binary.bytes: Buffer | null` with an immutable
  descriptor/source (revision/hash/size + bounded reader or staged object) so
  Git-originated adoption never moves whole payloads through AutoGit memory.
- [ ] **1E — Bounded AutoGit checkpoint publication.** `CheckpointBuilder`'s
  `BinaryRevision → Promise<Buffer>` resolver plus whole-byte Git/LFS
  handling must become a bounded pipeline
  (`BinaryRevision → verified local object/temp file → Git object/LFS clean
  streaming path`), with the safe-filter policy (custom clean filters refused,
  LFS via direct `git lfs clean`) enforced on the publication path.

**Gate (all executable):** B01 PNG exact on peer; B02 100 MB with
interruption/resume; B03 concurrent versions preserve both; B04 text↔binary
reclassification safe; B05 LFS live bytes + correct pointer/object on publish.
**Memory gate:** the normal 100 MB path never needs ~100 MB contiguous
application buffers.
**Out of scope until later:** P12+ behavior, PR status, media, legacy removal.
**Advance condition:** B01–B05 green + memory gate evidenced in ledger.

---

## Phase 2 — P12–P15 Session/Workbench lifecycle (matrix W, S)

Cleanup of identity semantics + systematic qualification. No new transport.

- [ ] **2A — P12 control plane verification:** invite-only, org-available,
  unauthorized-org rejection, project+session membership, leave/rejoin,
  pause/resume, dormant/no-participant, close lifecycle, recovery access.
  Exit: session identity/access without ProjectLayout branch equality.
- [ ] **2B — P13 Workbench identity authoritative.** Remove the residual
  branch-era model: `useLiveSession()` resolves via
  `findBranchSession(sessions, activeBranch)`. Invert to
  `workbenchId → workspaceId → collaborationSessionId`, with `branchName` a
  plain Git property of the session. **Session ≠ branch; the branch belongs
  to the session, it does not identify the UI.** Then qualify W01–W07
  (independent persistence, local-only activation, idle sync continues,
  presentation-delete ≠ session-delete, divergent layouts, headless sync).
- [ ] **2C — P14 creator flow.** Validate S01–S06: clean/new-branch share,
  dirty include/exclude with source Workbench untouched, dedicated Session WB,
  invite + project-access cases, error/retry at every step.
- [ ] **2D — P15 invite/resume.** Inbox accept creates/reuses the right
  Session WB; missing repo auto-clones; existing copy attaches safely;
  accept-then-network-loss stays retryable; restart resumes the same WB
  without duplicates; failure tests (room unavailable, disk-full clone,
  revoked invite, pause/close during bootstrap).

**Gate:** W01–W07 + S01–S10 green; no session resolved by branch anywhere in
the active path.
**Out of scope until later:** AutoGit semantics changes, P23+ cutover, media.
**Advance condition:** matrix rows evidenced in ledger.

---

## Phase 3 — P16–P22 AutoGit/Git program (matrix A, C, G, R, M)

Prove the composed state machine. No separate rewrites. Real Git remote
required before P27; nothing here is unit-test-only.

- [ ] **3A — P16 leader lease:** 3 eligible Macs elect one; leave/offline/
  stale-generation/no-lease/no-eligible-leader behavior; CRDT unaffected when
  leaderless.
- [ ] **3B — P17 checkpoint barrier:** commit contains exactly N with N+1
  retained live; lost-push-response resolution; leader-dies-after-commit
  reproduction by successor; remote-advance refusal; `.gitignore`/
  `.gitattributes`/modes/symlinks/binaries/LFS; no-op checkpoint.
- [ ] **3C — P18 baseline adoption:** refs/index advance to checkpoint without
  `git pull` of CRDT-delivered bytes and without overwriting newer
  working-tree bytes (master-plan example: HEAD C40/live seq 18570 →
  checkpoint C41/seq 18500 → HEAD C41, tree still 18570).
- [ ] **3D — P19 external Git:** G01–G10 with real Git — add/commit/checkout/
  reset/rebase protections, Adopt Git result, Sync from GitHub, divergence
  states. Terminal Git must never read as a giant collaborator edit.
- [ ] **3E — P20/P21 target + rebase:** recommendation correctness, no
  automatic rebase; all P21 mandatory tests (decline no-op, conflicts, edits
  during compute, target/session-branch moves, force-with-lease refusal,
  leader death, restart recovery, post-barrier edit survival).
- [ ] **3F — P22 merge/PR:** dirty-session forces fresh checkpoint; reviewed
  immutable commit used; clean/conflicted/stale-review cases; protected
  branch → PR path with persisted PR status + refresh; provider/grant
  capability discovery; post-merge continue/close + branch retention policy.

**Gate:** A01–A06, C01–C08, G01–G10, R01–R10, M01–M06 green against a real
remote.
**Out of scope until later:** UI cutover beyond existing dialogs, media,
legacy deletion, deployment.
**Advance condition:** full rows evidenced in ledger.

---

## Phase 4 — P23 Electron cutover

- [ ] All Session UI addresses sessions by Session/Workbench identity (finish
  2B everywhere).
- [ ] Renderer attach/detach never owns global session lifetime; closing or
  routing away from a Session WB changes presentation only.
- [ ] No renderer-only token/connection state required for the daemon to
  continue; daemon restart and renderer restart recover independently.
- [ ] Remove the fallback flag path handing session branches to the old
  engine (mechanics; the old engine itself dies in Phase 7).

**Gate (master plan):** closing renderer does not stop live CRDT/session.
**Out of scope until later:** capability matrix rerun, media, legacy deletion.
**Advance condition:** gate demonstrated with packaged daemon + dev renderer.

---

## Phase 5 — P24 capability qualification (matrix U01–U10)

Rerun every capability against Session Workspace; fix failures at the common
Workspace/filesystem boundary, never with a collaboration-specific transport:
agent sessionWorkspace live (U01) vs threadWorktree private-until-adopt (U02),
terminal (U03), dev-server hot reload (U04), browser local-only (U05), DevApp
(U06), Memory artifact follows file policy (U07), task execution context
(U08), Computer Use via VS Code as normal sync (U09), Skills never
session-synced (U10).

**Gate:** no capability needs a private collaboration file transport.
**Advance condition:** U01–U10 evidenced in ledger.

---

## Phase 6 — P25 media

- [ ] WebRTC signaling + TURN, microphone permission, mute/unmute.
- [ ] Session presence media fields; mute on Workbench idle by default with
  explicit background-audio opt-in; leave/pause cleanup; independent
  reconnect.
- [ ] Microphone control surface in `SessionWorkbenchControls` (currently
  absent).

**Gate:** media failure/reconnect cannot block CRDT/AutoGit. Media stays out
of projectd's file-correctness plane.
**Advance condition:** gate demonstrated; matrix media scenarios included in
Phase 9 run.

---

## Phase 7 — P26 legacy removal + one Git owner

Deliberate deletion/consolidation after caller audit. Do not delete unrelated
functionality until caller migration is proven.

- [ ] Route all required product Git operations through the canonical service;
  retire `GitSyncService`, `projectGitDesktopService`, substrate VCS Git
  mutation paths, and direct project/workspace Git callers.
- [ ] Remove: renderer `YjsProjectProvider` path, `WorkspaceRuntimeHosts` Yjs
  ownership, `useAgentFileSync` correctness path, `useYjsFileWriteback`, old
  `useBinaryFileSync`, old `projectWatcher` collaboration owner, obsolete
  sync journal, project-only `/collab/session` protocol, `project:<id>` room
  IDs, branch-equality activation, obsolete Convex Yjs tables (with data/reset
  plan).
- [ ] Strengthen architecture tests to fail CI on: projectd importing React/
  renderer code; correctness depending on tile type; renderer-created
  collaboration sockets; new direct Git execution outside `GitService`;
  `activeBranch === collabBranch` membership; editor-tile-as-requirement.

**Gate (master plan, verbatim):** exactly one live collaboration engine and
one canonical product Git owner remain.
**Advance condition:** gate + architecture tests green in ledger.

---

## Phase 8 — Coordinated production deployment

No physical qualification against mismatched revisions.

- [ ] Green repository head (Phase 0 gates re-run at the candidate commit).
- [ ] Convex production deploy (`bunx convex deploy`; never `convex dev`).
- [ ] Cloudflare `cozea-collab` worker deploy carrying current room/binary
  routes.
- [ ] Verify binary object routes + schema compatibility.
- [ ] Signed/notarized desktop build; install the identical candidate build
  on both Macs.

**Advance condition:** deployed revision IDs recorded in ledger.

---

## Phase 9 — P27 two-Mac Section-32 acceptance

Two physical Macs, independent device identities, signed packaged app,
deployed cloud revisions. Run the entire matrix: W01–W07, S01–S10, T01–T10,
F01–F17, B01–B05, A01–A06, C01–C08, G01–G10, R01–R10, M01–M06, D01–D07
(Electron quit, projectd restart, sleep/wake, disk-full, room/GitHub/AutoGit
outages), U01–U10 — plus the required physical scenarios (Electron closed,
LaunchAgent, VS Code, terminal, two simultaneous writers, offline, failover,
checkpoint, external Git, rebase, merge, binary, media).

**Gate (master plan, verbatim):** signed packaged app passes release matrix
against deployed cloud revisions. Only then is collaboration **complete**.
