# Collaboration v2 implementation plan

Status: active implementation plan
Base reviewed: `main@8dc33edf320cdcc8eba6ee92d40c0e43b7e24a9c`
Last updated: 2026-09-04

## Product decisions

1. A Cozea `userId` remains the canonical identity. One user represents one machine installation.
2. Organizations are groups of those machine-backed users.
3. Project access, repository access, and live collaboration are separate capabilities.
4. An organization-shared project may appear in the sidebar without starting a live session.
5. Files are downloaded directly from the customer-owned GitHub repository when a project is opened or explicitly kept offline.
6. A live collaboration session is optional and must be explicitly started or joined.
7. Every live session is anchored to an exact Git repository, target branch, and base commit SHA.
8. Every session uses a dedicated branch named `cozea/collab/<session-id>`.
9. Yjs owns the live uncommitted overlay. Git remains user-controlled.
10. Cozea never commits or pushes merely because collaboration is active.
11. A local Commit creates an unpublished commit on one machine. Only a successful explicit Push advances the shared Git base.
12. Convex is the control plane. It should not be the permanent repository for customer source trees.
13. Cloudflare Durable Objects coordinate encrypted live traffic and ephemeral presence.
14. Audio and screen sharing may later attach to the same session object, but use WebRTC rather than Yjs or Convex payload storage.

## Source-of-truth model

### No active live session

- Durable project tree: customer-owned GitHub repository.
- Local working tree: the machine's checkout.
- Project visibility and permissions: Convex.
- Git operations: explicit user actions.

### Active live session

The shared state is:

```text
exact Git base commit + acknowledged Yjs overlay
```

- Base tree: `baseCommitSha` fetched directly from GitHub.
- Live text state: encrypted Yjs documents.
- Local files: a projection of the live state.
- Recovery: encrypted local outbox plus short-lived encrypted server segments.
- Durable published state: the session branch after an explicit user push.

### After an explicit push

If a barrier at room sequence `N` is committed and pushed as commit `C1`:

```text
before: C0 + Yjs updates 1..M
after:  C1 + Yjs updates N+1..M
```

The files do not visibly change. The room records that `C1` contains all shared updates through `N`, participants fetch `C1`, reset their collaboration branch/index to it without replacing later working-tree edits, and compact acknowledged collaboration data through `N`.

## Capability boundaries

### Project access

Project access determines sidebar visibility and whether the user may open project metadata.

```text
organization policy: every active organization user may see the project
restricted policy: only explicit project members may see the project
```

### Repository access

Repository access is granted only when required:

- clone/fetch: short-lived read credential;
- explicit push: short-lived write credential;
- credentials stay in memory or a temporary credential helper;
- tokens are never written into repository remote URLs or Convex records.

### Live-session access

Project access does not automatically join a live room. Opening the same project creates lobby presence and may show:

```text
Erick is also working in this project
Start live session
Invite to live session
Join existing session
```

### Media access

Audio and screen sharing are separate session capabilities with separate permission and transport layers.

## Session domain model

```ts
interface CollaborationSession {
  id: string
  projectId: string
  repositoryId: string

  targetBranch: string
  sessionBranch: string
  baseCommitSha: string

  publishedCommitSha: string | null
  publishedThroughSequence: number
  roomHeadSequence: number

  createdByUserId: string
  commitLeaseUserId: string | null
  commitLeaseExpiresAt: number | null

  status:
    | "opening"
    | "active"
    | "commit_preparing"
    | "local_commit_ready"
    | "pushing"
    | "closing"
    | "closed"
    | "failed"

  createdAt: number
  updatedAt: number
  closedAt: number | null
}
```

Participants track connection state and capabilities, not durable source code:

```ts
interface CollaborationParticipant {
  sessionId: string
  userId: string
  role: "editor" | "observer"
  joinedAt: number
  lastSeenAt: number
  leftAt: number | null
  capabilities: {
    codeSync: boolean
    audio: boolean
    screenShare: boolean
  }
}
```

## Session opening flow

1. Verify organization/project access.
2. Resolve the repository binding.
3. Fetch the selected target branch from GitHub.
4. Resolve the exact remote base commit SHA.
5. Create `cozea/collab/<session-id>` at that SHA.
6. Prefer a dedicated linked Git worktree; fall back to a separate clone when required.
7. Initialize the encrypted collaboration room.
8. If the initiator includes existing dirty files, convert the difference from the base tree into the initial Yjs overlay.
9. Announce the live session to eligible project users.

A live session should normally begin from a GitHub-reachable commit. That allows any authorized machine to reconstruct the same basis without copying an entire repository from another participant or from Cozea infrastructure.

## Session join flow

1. Verify project and live-session access.
2. Request a short-lived read-only GitHub credential.
3. Clone or fetch the session's `baseCommitSha` or latest `publishedCommitSha` directly from GitHub.
4. Create a local session branch and dedicated worktree.
5. Join the encrypted room.
6. Load only the Yjs overlay after the published sequence.
7. Materialize live state into the collaboration worktree.
8. Mark the participant ready.

## Local editing flow

### Cozea editor and Cozea-controlled agents

```text
editor/agent operation -> Yjs transaction -> encrypted room update -> filesystem projection
```

Cozea-controlled agents should use collaboration-aware file operations instead of relying on the filesystem watcher as their primary path.

### External tools

```text
terminal/formatter/external editor -> filesystem watcher -> external-change reconciler -> Yjs transaction
```

The reconciler ignores Cozea's own projected writes, hashes the last projected state, and converts genuine external changes into minimal CRDT operations.

## Commit flow

Commit remains a local, explicit Git operation.

1. Acquire a short-lived commit lease so only one participant prepares shared Git state at a time.
2. Ask the room for a barrier sequence `N`.
3. Flush local encrypted outboxes and wait until updates through `N` are acknowledged.
4. Materialize the exact state through `N` into a temporary index/worktree.
5. Let the user review staged files and enter the message.
6. Create the commit locally.
7. Record it as an unpublished local commit. Do not advance the room base.
8. Edits after `N` continue as the next Yjs overlay.

If the publishing machine disappears before Push, the room state remains recoverable and another participant can recreate an equivalent commit, although its SHA and metadata may differ.

## Push flow

Push is also explicit.

1. Revalidate the commit lease and barrier metadata.
2. Obtain a short-lived write credential scoped to the exact repository.
3. Push the dedicated session branch without force.
4. Verify that GitHub contains the expected commit.
5. Record `publishedCommitSha` and `publishedThroughSequence` atomically in the session control plane.
6. Broadcast `collaboration.base-advanced` to participants.
7. Participants fetch the commit, move their session branch/index to it, preserve later working-tree edits, and compact updates through the covered sequence.
8. Release the write credential and commit lease.

Direct push to the target branch is an optional explicit action only when branch rules permit a fast-forward. The recommended default is push session branch, then open/update a pull request.

## Target-branch advancement

If the target branch moves while a session is active, Cozea must not silently rebase or merge it into the live room.

The session reports that the target advanced and offers explicit choices:

- continue and open a pull request later;
- merge the target into the collaboration branch through a room-wide barrier operation;
- close and restart from the latest target.

## Text and binary strategy

### Text

Target architecture:

- one session tree overlay for create/delete/rename/chmod metadata;
- lazy per-file Yjs documents keyed by stable file IDs;
- direct editor bindings for files open in Cozea;
- filesystem reconciliation for external changes;
- encrypted SQLite outbox for unacknowledged frames.

### Binary

Binary files do not belong in Yjs. Until a user explicitly commits and pushes, a binary change is local to the participant that made it. The UI must clearly show that it is not live-synchronized.

A later optional binary live-transfer layer may use short-lived encrypted object storage, but GitHub remains the durable source after explicit push.

## Presence and future media

Use one live-session presence system for:

- online participants;
- active file and selection;
- agent-working state;
- machine label;
- media capability state.

Lobby presence may remain lighter-weight and exist before a live session. It should not duplicate cursor/selection data.

Future audio and screen sharing use WebRTC. The collaboration session supplies identity, authorization, room membership, and signaling context; media frames do not pass through Yjs or Convex.

## Cost model

### Convex retains

- users and organizations;
- organization/project membership;
- project repository bindings;
- live-session metadata;
- participants and leases;
- published commit and sequence boundaries;
- wrapped room/session keys;
- aggregated activity/audit metadata.

### Convex retires as permanent storage

- unbounded Yjs updates;
- permanent full project Yjs snapshots;
- duplicate awareness/presence payloads;
- source-file contents;
- binary-file contents.

### Cloudflare retains

- Durable Object room sequencing and fanout;
- ephemeral encrypted presence;
- short-lived, batched encrypted recovery segments where required.

Segments should be deleted after an explicit Git push covers their sequence and a short recovery window expires.

## Implementation phases

### Phase 0 — Correctness guardrails

Objective: prevent the inherited system from corrupting or falsely claiming to synchronize data while v2 is built.

- remove the plaintext-era reconnection upload path;
- paginate WebSocket catch-up until the room sequence is reached;
- assign snapshots an exact acknowledged sequence boundary;
- deterministically seed an empty room from the selected Git base tree;
- stop reporting binary uploads as successful when no transfer exists;
- add two-client, reconnect, crash, key-rotation, and sequence-boundary tests.

Acceptance:

- no plaintext Yjs payload reaches encrypted-room persistence;
- reconnect catches up after more than one server page;
- a snapshot never claims to contain a later sequence than it actually includes;
- first-time sessions contain the complete selected base tree;
- binary limitations are visible rather than silently ignored.

### Phase 1 — Shared session contracts and Convex control plane

- add shared session/participant models and validation;
- add collaboration-session and participant tables;
- implement create/join/leave/close operations;
- implement commit-lease acquisition/renewal/release;
- implement atomic published-base advancement;
- keep `userId` as the canonical machine-bound identity.

Acceptance:

- a session is anchored to repository ID, target branch, session branch, and exact base SHA;
- membership and role checks are explicit;
- no source content is stored in the session records.

### Phase 2 — GitHub repository access

- model customer-owned GitHub repository bindings;
- issue short-lived read credentials for open/join;
- issue write credentials only during explicit Push;
- clone/fetch directly from GitHub;
- remove credentials immediately after use;
- expose repository-unavailable and permission states in project opening UI.

Acceptance:

- Cozea does not proxy repository files;
- opening an authorized org project can materialize it on a new machine;
- write access is not requested during read-only open.

### Phase 3 — Collaboration worktrees

- create a dedicated session branch;
- create a linked worktree or separate-clone fallback;
- persist session-to-workspace bindings locally;
- keep ordinary workspaces untouched;
- cleanly resume or remove abandoned session worktrees.

Acceptance:

- every participant checks out the same exact base commit;
- joining a room never overwrites unrelated local dirty work;
- closing a session restores no hidden branch state because the normal workspace was never replaced.

### Phase 4 — Collaboration runtime extraction

- move Yjs, encryption, outbox, reconnect, snapshot, and transport orchestration out of React contexts;
- expose one runtime state machine to React;
- persist an encrypted local outbox;
- consolidate duplicate journals and presence systems.

Acceptance:

- React renders/subscribes but does not implement transport or cryptographic workflows;
- crash recovery replays unacknowledged updates;
- one authoritative room sequence exists.

### Phase 5 — Direct editor and agent integration

- use direct Yjs bindings for open text editors;
- route Cozea agent file tools through collaboration-aware operations;
- retain the filesystem watcher only for external changes;
- add stable file IDs and a session tree overlay;
- lazily instantiate per-file Yjs documents.

Acceptance:

- Cozea editor changes do not wait for filesystem watcher round-trips;
- renames and deletes converge deterministically;
- unopened unchanged files consume no CRDT state.

### Phase 6 — Explicit Commit and Push UX

- add commit lease and sequence barrier controls;
- stage/materialize the exact barrier state;
- create local unpublished commits;
- push only after explicit user action;
- advance the shared base only after verified remote publication;
- preserve post-barrier live edits.

Acceptance:

- no automatic commit or push exists;
- two participants cannot publish conflicting barrier snapshots simultaneously;
- a pushed base leaves only later edits dirty.

### Phase 7 — Durable-data and cost migration

- make GitHub the durable tree for new projects;
- move short-lived encrypted room recovery to batched ephemeral storage;
- stop new permanent Convex Yjs history for v2 sessions;
- migrate or close v1 encrypted rooms safely;
- remove legacy plaintext reconnect, duplicate presence, old journals, and binary placeholders after compatibility coverage ends.

Acceptance:

- no active v2 project depends on permanent source snapshots in Convex;
- encrypted recovery data has a bounded retention policy;
- project source remains in customer-owned GitHub repositories.

### Phase 8 — Audio and screen-sharing foundation

- extend session capabilities;
- add WebRTC signaling through the room control plane;
- add microphone and screen-share permissions;
- keep media transport and retention independent of code synchronization.

## Pull-request sequence

1. `collaboration-v2/00-correctness`
2. `collaboration-v2/01-control-plane`
3. `collaboration-v2/02-github-access`
4. `collaboration-v2/03-worktrees`
5. `collaboration-v2/04-runtime`
6. `collaboration-v2/05-editor-agent-bindings`
7. `collaboration-v2/06-commit-push`
8. `collaboration-v2/07-storage-migration`
9. `collaboration-v2/08-media-foundation`

Each PR must preserve an independently testable application state and include migration/rollback notes when it changes persisted data.

## Non-negotiable invariants

- `userId` remains the canonical machine-backed identity.
- project visibility does not automatically start collaboration;
- live collaboration requires explicit start/join;
- all participants share one exact Git base SHA;
- Yjs never replaces explicit Git commit/push semantics;
- local Commit does not advance the room base;
- only verified Push advances the room base;
- Cozea never force-pushes;
- later Yjs edits survive a base advancement;
- source trees are fetched directly from GitHub;
- Convex stores control metadata, not permanent customer repositories;
- encrypted payloads never fall back to plaintext persistence;
- audio/screen media never passes through Yjs or Convex source-data tables.
