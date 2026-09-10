# Cozea Collaboration + AutoGit
## Master macOS Implementation Specification

**Repository:** `Cozea/electron-app`  
**Planning baseline:** `main@6f13aa8c2094052402b4aa47fed13d0bdc87ac65`  
**Platform for this implementation:** macOS  
**Status:** authoritative replacement plan  
**Audience:** implementation agents, reviewers, architecture owners  
**Detail level:** deliberately exhaustive  
**Primary rule:** do not implement from memory; execute this document phase by phase.

---

# 0. How to use this document

This is not a design memo. It is the execution contract for rebuilding Cozea collaboration.

An implementation agent must not:

- infer a different product from old code;
- treat the current Workbench as the shared collaborative object;
- add a code editor;
- remove CRDTs because arbitrary tools write files;
- make Git the real-time transport;
- make the filesystem watcher the distributed source of truth;
- make one user's terminal/browser/layout shared;
- make AutoGit commit the mutable leader workspace directly;
- implement "collaboration is active when `activeBranch === collabBranch`";
- bypass phase gates because a typecheck is green;
- leave a legacy competing owner alive indefinitely because migration is inconvenient.

The product model in Sections 1–10 is authoritative. If current code conflicts with it, current code is the migration source, not the specification.

## 0.1 Required implementation ledger

Create:

`docs/collaboration/collaboration-autogit-status.md`

Every phase must append:

```md
## PXX — <phase name>

Status: not-started | in-progress | blocked | complete

Baseline:
- base commit:
- implementation commit:
- review commit:

Production owners before:
- ...

Production owners after:
- ...

Files created:
- ...

Files modified:
- ...

Files deleted:
- ...

Tests:
- command:
- result:
- evidence:

Manual qualification:
- scenario:
- result:

Known follow-ups:
- ...

Exit-gate evidence:
- ...
```

A phase is not complete until its exit gate is backed by evidence.

## 0.2 Agent checkpoint rule

At the end of every implementation checkpoint:

1. stop adding behavior;
2. run the checkpoint's narrow tests;
3. run affected typechecks;
4. inspect `git diff`;
5. search for duplicate old/new ownership;
6. update the status ledger;
7. commit the checkpoint;
8. only then continue.

Do not accumulate several architectural migrations into one unreviewable working tree.

## 0.3 Current-main rule

Before starting any phase:

```bash
git fetch origin
git rev-parse origin/main
```

Compare with the baseline recorded in the ledger.

If main advanced:

1. inspect the relevant changes;
2. rebase/update the implementation branch;
3. rerun the previous completed phase's critical tests;
4. update the baseline in the ledger;
5. do not blindly apply paths from this document if the repository moved them.

The baseline used to write this plan is:

`6f13aa8c2094052402b4aa47fed13d0bdc87ac65`

## 0.4 No old-plan authority

The following are superseded as implementation authority:

- the previously generated filesystem-first/CAS plan;
- the previously generated editor-centric collaboration plan;
- abandoned `collaboration-v2` branch plans;
- any stale document that describes a Workbench file-editor tile as the product center;
- any old design that equates collaboration room identity with `projectId`;
- any old design that equates collaboration participation with a branch equality check.

Old code and old plans may be mined for:

- encryption code;
- Yjs update handling;
- state-vector/reconnect ideas;
- recovery cases;
- Git failure cases;
- tests;
- provenance metadata;
- Cloudflare/WebSocket mechanics.

They may not override the product model below.

---

# 1. Product definition

## 1.1 Cozea is project-centric

Cozea coordinates a software project across:

- local workspaces;
- Git branches;
- agents;
- terminals;
- previews;
- DevApps;
- project services;
- external applications.

The long-term architectural center is not the Electron renderer.

Cozea is moving toward background software that coordinates project capabilities while users may work through:

- Codex;
- Claude;
- Cursor;
- OpenCode;
- VS Code;
- Zed;
- Vim;
- terminal programs;
- scripts;
- DevApps;
- future clients.

The current desktop app is one integrated client of that substrate.

## 1.2 A Cozea project is principally a software project

The primary contents are text-like software artifacts:

```text
TypeScript / JavaScript
Python / Rust / Go / Swift / Java / etc.
HTML / CSS
JSON / YAML / TOML
SQL
Markdown
shell scripts
Dockerfiles
package manifests
configuration
schemas
migrations
tests
prompts
project-local skills/instructions
source-controlled metadata
```

Projects may also include:

```text
images
audio
video
fonts
archives
3D assets
WASM
SQLite/database files
other binary artifacts
```

Binary support is required, but binary files do not define the hot-path collaboration architecture.

## 1.3 What collaboration means

A Cozea collaboration session means:

> Multiple participating Macs maintain local materializations of one logically shared live project tree associated with one Git session branch.

The shared thing is the project state.

The following are **not** implicitly shared:

- Dockview/Workbench layout;
- tile positions;
- which tiles are open;
- terminal scrollback;
- local process IDs;
- browser cookies;
- browser navigation;
- preview scroll state;
- agent chat history;
- draft text;
- local provider credentials;
- local tool settings;
- personal skills;
- provider-native configuration;
- arbitrary local caches.

## 1.4 The three foundational interfaces

The architecture is:

```text
FILESYSTEM
= universal application-facing interface

CRDT
= live distributed convergence model

GIT / GITHUB
= durable branch/history/publication model
```

None of these should be substituted for another.

## 1.5 Long-term renderer-independence test

Every correctness-critical collaboration behavior must still work when:

- the Project page is not visible;
- the Workbench route is not mounted;
- the Workbench renderer is destroyed;
- the entire Electron window is closed;
- a user edits the session workspace from another application.

If a correctness path depends on a React provider being mounted, it is in the wrong layer.

---

# 2. Canonical terminology

Use these names consistently in code, docs, schemas, telemetry, tests, and UI.

## 2.1 Project

Cloud/product identity for one software project.

Key:

`projectId`

A Project is not a filesystem path.

## 2.2 Repository binding

The canonical source-control repository associated with the project.

Key:

`repositoryBindingId`

Contains logical remote identity such as GitHub owner/name and default target branch.

Absolute local paths are never cloud authority.

## 2.3 Ordinary workspace

A device-local working directory for the project that is not enrolled as the local materialization of a collaboration session.

Key:

`workspaceId`

It may be:

- attached;
- managed;
- a Git worktree;
- another supported local workspace.

## 2.4 Project Workbench

A **device-local durable execution/presentation context** for a Project.

Key:

`workbenchId`

A project may have many Workbenches on one device.

A Workbench owns or references:

- one local workspace root;
- one branch/execution context;
- local layout;
- local surfaces;
- local process/resource bindings.

Workbench records are not shared as collaboration state.

## 2.5 Session Workbench

A device-local Project Workbench whose local workspace is enrolled in a collaboration session.

Key:

`workbenchId`

Association:

`collaborationSessionId`

**A Session Workbench is not a shared Workbench.**

Each participant has their own Session Workbench.

## 2.6 Collaboration session

Persistent/resumable multiplayer coordination object.

Key:

`sessionId`

Cloud/session state includes:

- project;
- repository binding;
- session branch;
- target branch;
- lifecycle;
- access policy;
- participants;
- CRDT durability metadata;
- AutoGit state;
- media/session coordination.

A session is not the same thing as a Git branch.

## 2.7 Session branch

The Git branch AutoGit checkpoints/pushes for this session.

Example:

`feature/dashboard`

A branch may exist before the session and may outlive it.

## 2.8 Target branch

The branch the session is expected eventually to merge/rebase against.

Default:

project repository default branch, usually `main`.

## 2.9 Local session workspace

One participant Mac's concrete folder materializing the live CRDT project state.

Key:

`workspaceId`

This is the folder external applications open.

## 2.10 CRDT replica

The background collaboration runtime state for one session on one device.

It includes:

- tree/structure CRDT;
- per-text-file Yjs documents;
- binary revision metadata;
- local materialization baselines;
- outbound/inbound durable queue state.

## 2.11 AutoGit

Session Git coordination system.

It is not the collaboration truth.

Responsibilities include:

- single-leader automated Git checkpointing;
- periodic push;
- manual checkpoint requests;
- GitHub baseline tracking;
- join/resume bootstrap assistance;
- target-branch divergence tracking;
- explicit user-approved rebase;
- merge/PR preparation.

## 2.12 AutoGit leader

Exactly one eligible connected session device holding the current fenced AutoGit lease.

Key tuple:

```text
sessionId
leaderIdentityKey
leaseGeneration
leaseExpiresAt
```

Only the current generation may perform automatic Git publication.

## 2.13 CRDT barrier

Immutable collaboration checkpoint boundary.

Key:

`sessionSeq`

Represents all accepted collaboration batches through sequence N.

AutoGit commits **a barrier snapshot**, never an arbitrary mutable workspace.

---

# 3. Non-negotiable invariants

Label these in tests and review comments.

## C01 — Project is the collaborative subject

Collaboration is on a project tree, not on a code editor, tile, document UI, terminal, or agent conversation.

## C02 — Session Workbench is local

Each participant's Session Workbench is personal device-local state.

Never replicate Workbench layout through collaboration.

## C03 — Files are shared

The live project filesystem materialization is the interoperability boundary for arbitrary tools.

## C04 — CRDT owns live collaborative convergence

Textual project changes use CRDT semantics.

Do not replace the primary text path with repeated file-level CAS + Git-style rebasing.

## C05 — Git owns history/publication

Git is not the real-time sync transport.

## C06 — Session != branch

`sessionId` and `branchName` are distinct.

## C07 — Workspace != project

A local path is one device's materialization.

## C08 — Workbench != workspace

Workbench is an execution/presentation context; workspace is filesystem state.

## C09 — Arbitrary writers are normal

VS Code, Claude, Codex, shell programs, scripts, formatters, DevApps, and future tools are first-class writers.

## C10 — No editor requirement

Do not add a built-in source editor to make collaboration function.

## C11 — Save-level generic interoperability

Without an optional editor integration, generic external-tool collaboration starts when bytes reach the filesystem.

Unsaved external editor buffers are not generically observable.

## C12 — Renderer cannot own collaboration lifetime

React mount/unmount must not start/stop authoritative CRDT state.

## C13 — Watcher is not truth

macOS event observation is a fast hint mechanism.

Durable materialization/index reconciliation is correctness.

## C14 — No time-based echo suppression

Do not ignore writes because "Cozea wrote this path in the last N milliseconds."

Echo detection uses exact materialized state/hash/version.

## C15 — Text is the hot path

Design latency and concurrency for small rapid text edits first.

## C16 — Binary is first-class but different

Binary state uses versioned immutable content and explicit conflict semantics.

## C17 — Tree identity is stable

File identity must survive rename/move.

Path is a property of a file entry, not the file's identity.

## C18 — Project tree conflicts never silently overwrite

Path collisions, incompatible structural operations, and unmergeable binary concurrency create explicit conflict state.

## C19 — Session CRDT is durable independently of GitHub

Unpublished live session work survives AutoGit failure.

## C20 — One AutoGit leader

Only one fenced lease holder performs automated checkpoint/push.

## C21 — AutoGit uses CRDT barriers

AutoGit never commits "whatever happens to be on leader disk."

## C22 — AutoGit failover is reproducible

A successor leader can reproduce or safely continue checkpoint publication.

## C23 — AutoGit pull is controlled integration

Do not run blind `git pull` on a live session workspace and feed the resulting mass rewrite back through the watcher.

## C24 — External Git is allowed

Manual Git use must be detected and handled, not assumed impossible.

## C25 — Rebase is explicit

Target-branch movement may trigger a suggestion.

Rebase never runs without explicit user action/approval.

## C26 — Rebase is isolated

Do not run the authoritative rebase in a participant's live session workspace.

## C27 — Rebase preserves concurrent live work

Users may continue collaborating while the isolated rebase is prepared.

Only final adoption may use a short integration barrier.

## C28 — Merge snapshots are immutable

Merge/PR operates on a concrete Git checkpoint derived from a CRDT barrier.

## C29 — One active Workbench per project/device

A device may persist many Workbenches for the same project, but one is locally active at a time.

## C30 — Idling a Workbench is local

Switching away does not globally pause the collaboration session.

## C31 — Project presence != session membership

Having a project open does not make a device a live session replica.

## C32 — Participant leave != session close

One participant may leave while session continues.

## C33 — Zero participants != deletion

A session may become dormant and resume later.

## C34 — Collaboration is background-capable

Closing Electron must not inherently destroy a joined background session.

## C35 — Git configuration semantics must be compatible

Cozea's Git service may not silently interpret a repository differently from normal Git because it replaced user/repo attribute/config semantics.

## C36 — One product Git owner

After migration, product Git operations route through one canonical service.

## C37 — Local absolute paths stay local

Cloud models store logical identity, never assume another Mac has the same path.

## C38 — `.git` is not replicated project content

Git metadata is observed/managed separately.

## C39 — Tracked files are shared regardless of folder name

Do not exclude tracked `vendor`, `dist`, `build`, `target`, etc. merely because they look generated.

## C40 — Ignored local state stays local by default

Untracked Git-ignored state does not automatically enter the live shared project.

## C41 — Shared file membership is sticky

Once a newly created untracked file has been admitted to session state, later ignore-rule changes do not silently delete it.

## C42 — Media failure does not block file collaboration

Microphone/screen-share are separate session capabilities.

## C43 — Agent provenance is optional

Attribution may enrich changes but cannot be required for replication correctness.

## C44 — Thread worktrees remain isolated

Assistant `threadWorktree` writes are not immediately shared unless explicitly adopted into the session.

## C45 — Session workspace writes are live

Assistant `sessionWorkspace` writes enter collaboration through the normal filesystem/CRDT path.

---

# 4. Product state model

There are separate state machines. Do not collapse them.

## 4.1 Collaboration session lifecycle

```text
CREATING
   |
   v
ACTIVE
   |
   +----> DORMANT ----> ACTIVE
   |
   +----> PAUSING ----> PAUSED ----> ACTIVE
   |
   +----> CLOSING ----> CLOSED

Any non-closed state may become:
BLOCKED
when correctness cannot be guaranteed.
```

### CREATING

Session control-plane record exists but branch/bootstrap/live state is not ready.

No participant should be told "collaboration active."

### ACTIVE

Session accepts live project mutations.

### DORMANT

No participant currently connected.

Live durable state remains retained.

### PAUSING

Explicit session-wide pause requested.

Required actions:

- flush accepted collaboration state;
- create/update durable snapshot;
- request final AutoGit checkpoint when possible;
- stop accepting new live mutations at the final transition boundary.

### PAUSED

Retained but intentionally not accepting live edits.

### CLOSING

Authorized close requested.

Must resolve unpublished/recovery policy.

### CLOSED

Session no longer accepts participants.

Branch/history may continue to exist.

### BLOCKED

Correctness gate failed, for example:

- invalid CRDT durability;
- unrecoverable encryption key state;
- repository identity mismatch;
- local materialization corruption;
- protocol incompatibility;
- critical database integrity failure.

Blocked is not "offline."

## 4.2 Participant lifecycle

```text
NOT_JOINED
   |
INVITED / AVAILABLE
   |
JOINING
   |
CONNECTED
   |
BACKGROUND
   |
LEFT
```

`BACKGROUND` means the participant's local Session Workbench is idle/not presented but its background replica remains joined.

## 4.3 Local Workbench lifecycle

```text
CREATING
   |
IDLE <----> ACTIVE
   |
CLOSING
   |
CLOSED
```

Only one Workbench for a given `projectId` is ACTIVE on one device.

## 4.4 AutoGit lifecycle

```text
DISABLED
NO_LEADER
ELECTING
LEADER_ACTIVE
LEADER_DEGRADED
TRANSFERRING
BLOCKED
```

## 4.5 AutoGit checkpoint lifecycle

```text
REQUESTED
FLUSHING
BARRIER_CREATED
SNAPSHOT_CAPTURED
GIT_TREE_BUILT
COMMIT_PREPARED
PUSHING
REMOTE_VERIFIED
ADOPTED
COMPLETE
```

Failure state stores exact last durable stage.

## 4.6 Rebase lifecycle

```text
IDLE
SUGGESTED
REQUESTED
PREPARING_BARRIER
CHECKPOINTING
FETCHING_TARGET
COMPUTING
CONFLICTED
READY_TO_ADOPT
ADOPTING
PUSHING_REWRITTEN_BRANCH
COMPLETE
FAILED
```

A `SUGGESTED` rebase never transitions to `REQUESTED` without explicit user action.

---

# 5. Project Workbench model

## 5.1 Workbench record is local

Suggested local model:

```ts
interface LocalProjectWorkbench {
  workbenchId: string
  projectId: string
  workspaceId: string
  workspaceRevision: number

  kind: "ordinary" | "collaboration"

  branchName: string | null
  collaborationSessionId: string | null

  lifecycle: "active" | "idle" | "closed"

  title: string
  createdAt: number
  updatedAt: number
  lastActivatedAt: number | null

  presentationStateRef: string
}
```

Do not put Dockview JSON into cloud collaboration state.

## 5.2 Active Workbench invariant

Maintain:

```text
activeWorkbenchByProject[projectId] = workbenchId
```

Switch algorithm:

1. validate destination Workbench and workspace binding;
2. mark current Workbench `idle`;
3. retain background services according to resource policy;
4. mark destination `active`;
5. update active project route/runtime binding;
6. never mutate cloud session lifecycle merely because of switch;
7. never switch a shared collaboration branch by checking out over another Workbench's directory.

## 5.3 Session Workbench creation

On session creation/join:

1. create/resolve local collaboration workspace;
2. create local Workbench record;
3. associate `sessionId`;
4. assign session branch;
5. create local presentation using a local template;
6. do not copy another participant's layout;
7. activate after collaboration bootstrap reaches ready.

## 5.4 Workbench persistence is independent from session persistence

Deleting a local Session Workbench must ask whether to:

- only remove the local Workbench presentation;
- leave the collaboration session;
- both.

It must not close the global session unless the user explicitly invokes session close and has permission.

---

# 6. User flows

## 6.1 CREATE — Share button flow

Entry:

`Share`

Current Share UI should evolve into a session creation flow when collaboration is requested.

### Step 1 — Start collaboration

Modal title:

`Start collaboration`

Show:

- current project;
- repository connection state;
- current Workbench/branch;
- session prerequisites.

If no GitHub repository is attached:

- AutoGit-enabled multi-device collaboration requires a GitHub repository in the initial shipping path;
- offer `Connect GitHub repository` / `Create GitHub repository`;
- do not pretend AutoGit is available without its remote;
- keep CRDT architecture independent enough to allow non-GitHub sessions later.

### Step 2 — Select/create session branch

Options:

- use current branch;
- choose existing branch;
- create new branch from current branch;
- create new branch from another base.

Display:

- branch name;
- current remote head;
- target branch;
- local dirty state;
- whether branch already has a retained session.

If a non-closed session already exists for the selected branch:

Offer:

- Resume existing session;
- cancel;
- close old session first if user truly wants a new independent session.

Do not silently create two live session truths for the same project/repository/branch in v1.

### Step 3 — Local dirty changes

If source Workbench contains uncommitted project changes:

Show:

`Include current uncommitted changes in the new session`

Default: enabled.

If enabled:

- create session from exact selected Git base;
- import current visible working-tree differences into session CRDT after base bootstrap.

If disabled:

- session begins from branch Git base;
- ordinary workspace remains untouched.

Never reset source workspace merely to create collaboration.

### Step 4 — Access policy

Options:

`Invite people`

and, if project belongs to an organization:

`Available to organization`

Session access modes:

```text
invite_only
organization_available
```

### Step 5 — Invite collaborators

Resolve existing project/device collaborators where possible.

If target lacks project access:

- session invitation includes required project access grant;
- acceptance performs project membership + session membership atomically from user's perspective.

### Step 6 — Create

Backend:

1. validate creator permission;
2. reserve session ID;
3. reserve branch association;
4. create session control-plane state;
5. create/ensure session branch basis;
6. establish E2EE session key;
7. create collaboration room;
8. bootstrap session CRDT base;
9. create creator participant membership;
10. initialize AutoGit election;
11. return local bootstrap descriptor.

Local:

12. create session workspace;
13. create Session Workbench;
14. hydrate Git baseline;
15. hydrate CRDT;
16. import opted-in local dirty changes;
17. wait for exact materialization;
18. activate Session Workbench;
19. mark session ACTIVE.

UI must not switch to an empty or partially hydrated directory.

## 6.2 RESUME — Open a persisted Session Workbench

User selects the local Session Workbench.

Algorithm:

1. verify local Workbench record;
2. verify session accessible and non-closed;
3. verify repository binding;
4. verify session branch;
5. inspect local Git checkpoint;
6. inspect local CRDT durable cursor/snapshots;
7. choose bootstrap strategy;
8. reconcile Git checkpoint if useful;
9. connect to room;
10. catch up CRDT;
11. materialize exact live state;
12. only then mark Workbench ACTIVE;
13. previous active Workbench becomes IDLE.

## 6.3 ACCEPT — Inbox invitation flow

Inbox item must display:

- project name;
- session name/title;
- branch;
- inviter;
- role;
- access expiry;
- session lifecycle;
- optional active participant count.

Accept algorithm:

1. atomically accept/ensure project access;
2. accept session membership;
3. create local session workspace record;
4. create local Session Workbench record;
5. bootstrap recent Git checkpoint;
6. hydrate CRDT;
7. materialize exact live project;
8. activate the new Session Workbench;
9. navigate to Project Workbench UI;
10. show connected participants/media controls.

If bootstrap fails:

- invitation remains accepted;
- local Workbench remains `creating` or `blocked`;
- user may retry;
- never roll back project membership because local disk/network failed.

## 6.4 ORG AVAILABLE — Join without direct invite

If session access is `organization_available`:

1. verify device is active organization member;
2. verify project organization matches;
3. ensure configured project/session role;
4. join session;
5. create local Session Workbench;
6. bootstrap as normal.

Do not bypass project permissions just because session is discoverable.

## 6.5 Leave

Participant chooses `Leave collaboration`.

Effects:

- stop this device's live replica membership;
- flush local outbound durable queue or retain as pending recovery;
- stop session media;
- relinquish AutoGit lease if leader;
- keep/remove local Session Workbench according to UI choice;
- do not close global session.

## 6.6 Idle by switching Workbench

Effects:

- presentation becomes IDLE;
- live CRDT may remain connected in background;
- local session workspace continues receiving remote file updates;
- local terminal/dev-server resource policy may warm/freeze independently;
- AutoGit eligibility remains possible if background policy allows;
- no shared session state transition.

## 6.7 Pause session

Explicit authorized global action.

Effects:

1. request final CRDT durable snapshot;
2. request AutoGit checkpoint;
3. if AutoGit unavailable, clearly show Git checkpoint lag;
4. freeze new write admission at final pause transition;
5. retain project state;
6. stop or retain media according to policy;
7. lifecycle -> PAUSED.

## 6.8 Close session

Explicit authorized global action.

Preflight:

- unresolved conflicts;
- unpublished CRDT state;
- latest AutoGit checkpoint;
- branch target/merge status.

Require explicit choice when unpublished state exists.

Closing does not delete Git branch.

---

# 7. Local session workspace strategy

## 7.1 Dedicated managed session clone

For v1, each Session Workbench uses a dedicated Cozea-managed standalone Git clone.

Recommended path:

```text
~/Library/Application Support/Cozea/Collaboration/<projectId>/<sessionId>/repo
```

Reasons:

- session branch is isolated from ordinary attached workspace;
- external applications see a normal Git repository;
- ordinary workspace is never checkout-mutated;
- session branch remains stable while other Workbenches are used;
- corruption of one workspace's Git metadata is isolated;
- AutoGit does not need to mutate user's ordinary clone;
- disk efficiency is lower priority than correctness.

Do not make a linked worktree the default Session Workspace in v1.

## 7.2 Ordinary Workbenches

Existing ordinary attached/managed workspaces remain valid.

Future multiple ordinary branch Workbenches may use managed Git worktrees if desired.

That is not a collaboration-core dependency.

## 7.3 Session workspace authority

Cloud stores:

- workspace logical membership;
- session;
- branch;
- repository identity.

Local daemon stores absolute path.

No remote peer ever receives another participant's absolute path.

---

# 8. Background runtime architecture

## 8.1 Create `cozea-projectd`

Implement a UI-independent per-user background daemon.

Suggested root:

`apps/projectd`

Responsibilities:

- workspace registry;
- Workbench registry;
- session replica lifecycle;
- CRDT ownership;
- filesystem observation;
- materialization;
- binary cache;
- collaboration transport;
- AutoGit leader client;
- Git/VCS service;
- encryption identity usage;
- local recovery;
- local client API.

Electron is a client.

## 8.2 macOS-specific helper

Implement native Swift helper:

`native/projectd-macos`

Responsibilities:

- FSEvents;
- Keychain operations needed by background identity;
- volume capability probes;
- atomic/safe filesystem primitives;
- optional APFS cloning helpers.

Do not put collaboration domain logic in Swift.

## 8.3 Background registration

Use macOS per-user LaunchAgent through `SMAppService`.

## 8.4 Local API

Use a versioned local Unix-domain socket.

Example:

`/tmp/cozea-projectd-<uid>.sock`

Protocol requirements:

- one daemon per logged-in user;
- socket permission `0600`;
- explicit protocol version;
- request IDs;
- streaming event subscriptions;
- typed error codes;
- cancellation;
- client identity;
- no renderer-specific method names.

## 8.5 Headless control client

Add:

`cozea-projectctl`

Required commands eventually:

```bash
cozea-projectctl health
cozea-projectctl workbenches <project>
cozea-projectctl sessions <project>
cozea-projectctl session status <session>
cozea-projectctl session join <session>
cozea-projectctl session leave <session>
cozea-projectctl autogit status <session>
cozea-projectctl autogit checkpoint <session>
cozea-projectctl conflicts <session>
```

---

# 9. Local persistence

Use daemon-owned SQLite with WAL.

Do not use renderer IndexedDB as authoritative collaboration durability after cutover.

Logical tables:

## 9.1 `local_workbenches`

```text
workbench_id PK
project_id
workspace_id
workspace_revision
kind
branch_name
session_id nullable
lifecycle
title
presentation_ref
created_at
updated_at
last_activated_at
```

## 9.2 `session_bindings`

```text
session_id PK
project_id
repository_binding_id
workspace_id
branch_name
target_branch
last_applied_session_seq
last_durable_session_seq
last_git_checkpoint_seq
last_git_checkpoint_oid
connection_state
key_version
updated_at
```

## 9.3 `file_materializations`

```text
session_id
file_id
relative_path
kind
mode
disk_hash
disk_size
disk_mtime_ns
materialized_doc_state_vector
materialized_snapshot_ref
binary_revision_id
last_session_seq
state
PRIMARY KEY(session_id, file_id)
```

## 9.4 `path_index`

```text
session_id
normalized_path
file_id
display_path
conflict_state
PRIMARY KEY(session_id, normalized_path, file_id)
```

Do not lowercase canonical display paths.

## 9.5 `outbound_batches`

```text
batch_id PK
session_id
created_at
state
local_order
encrypted_payload_ref
acked_session_seq nullable
retry_count
last_error
```

## 9.6 `inbound_receipts`

```text
session_id
session_seq
batch_id
applied_at
PRIMARY KEY(session_id, session_seq)
```

## 9.7 `crdt_snapshots`

```text
snapshot_id PK
session_id
doc_id
session_seq
state_vector
encrypted_snapshot_ref
created_at
```

## 9.8 `binary_cache`

```text
content_hash PK
local_path
size
verified_at
ref_count
```

## 9.9 `collab_conflicts`

```text
conflict_id PK
session_id
kind
file_id nullable
path nullable
state
payload_ref
created_at
resolved_at nullable
```

Kinds include:

```text
path_collision
rename_collision
delete_modify
binary_concurrent_revision
filesystem_materialization
git_external_transition
rebase_conflict
merge_conflict
```

## 9.10 `autogit_local_state`

```text
session_id PK
lease_generation
is_leader
lease_expires_at
last_checkpoint_seq
last_checkpoint_oid
last_remote_oid
last_target_oid
checkpoint_state
updated_at
```

## 9.11 Persistence failure rule

If SQLite durability fails:

- enter degraded/blocked state;
- do not silently switch to JSON;
- do not acknowledge collaboration durability that was not persisted.

---

# 10. CRDT architecture

## 10.1 Keep Yjs, move ownership

Yjs remains the core text convergence engine.

Move it from renderer contexts/hooks into `cozea-projectd`.

Remove the assumption that Yjs exists because there is a Cozea editor.

## 10.2 Session-level document model

Do not use one giant path-keyed `Y.Map<Y.Text>` forever.

Use a multiplexed model:

```text
tree document:
  docId = "tree"

text document per text file:
  docId = "text:<fileId>"
```

This gives:

- stable file identity;
- independent text update streams;
- bounded memory;
- per-file snapshot/compaction;
- selective hydration;
- simpler binary separation.

Implementation may use separate `Y.Doc` instances multiplexed over one session socket rather than relying on Yjs subdocument provider magic.

## 10.3 Tree document

Root Y.Doc contains:

```text
entries: Y.Map<EntryRecord>
structuralOps: Y.Map<StructuralOp>
conflicts: Y.Map<ConflictMarker>
```

Conceptual `EntryRecord`:

```ts
interface ProjectEntryRecord {
  fileId: string

  kind:
    | "text"
    | "binary"
    | "symlink"

  path: string
  mode: 0o100644 | 0o100755

  deleted: boolean

  textDocId?: string
  binaryRevisionId?: string
  symlinkTarget?: string

  lastStructuralOpId: string | null
}
```

Do not use pathname as map key identity.

## 10.4 Stable file ID

Create using UUIDv7 or another collision-resistant sortable ID.

File identity survives:

- rename;
- move;
- extension change;
- case-only rename.

## 10.5 Structural operation history

Every local structural mutation writes an immutable record:

```ts
interface StructuralOp {
  opId: string
  sessionId: string
  fileId: string

  kind:
    | "create"
    | "rename"
    | "move"
    | "delete"
    | "restore"
    | "chmod"
    | "reclassify"
    | "symlink-target"

  fromPath?: string
  toPath?: string

  baseStructuralOpId?: string | null

  actor: ChangeActor
  createdAt: number
}
```

`structuralOps` is append-only within retention.

Reason:

Y.Map field resolution converges, but application-level structural conflicts must not disappear without evidence.

## 10.6 Path uniqueness reducer

After tree updates:

1. enumerate non-deleted live entries;
2. normalize for macOS volume comparison semantics;
3. detect multiple `fileId`s claiming one materializable path;
4. do not arbitrarily overwrite one on disk;
5. create `path_collision`;
6. keep unaffected files materializing;
7. conflict resolution writes a new explicit structural operation.

## 10.7 Concurrent rename detection

If two rename/move ops for same `fileId` share the same `baseStructuralOpId` and lead to different destinations:

- Yjs still converges on an effective path;
- record an explicit rename conflict unless one operation is causally later;
- never lose losing operation from activity/history.

## 10.8 Text document

Each text file owns:

```ts
const doc = new Y.Doc({ guid: textDocId })
const text = doc.getText("content")
```

No editor is attached.

The filesystem adapter is attached.

## 10.9 Text classification

Classify a file as text when:

- Git attributes do not explicitly force binary;
- content is valid UTF-8;
- content contains no NUL byte;
- size is under initial CRDT safety limit;
- type is reasonable for text collaboration.

Initial safety limit:

8 MiB.

This is a tunable engineering limit, not a product claim.

## 10.10 Classification is sticky

Once an entry is text:

- remain text while valid;
- if it becomes invalid/binary or exceeds hard safety limit, perform explicit `reclassify` transaction preserving current bytes.

Once binary:

- may only become text through explicit safe reclassification.

Do not flip classification repeatedly from extension heuristics.

## 10.11 External filesystem save -> Yjs

This is the critical generic ingress algorithm.

Maintain for each text file:

```text
B = exact text last materialized to disk
SB = exact Yjs snapshot/state representing B
D = newly stable text read from disk
C = current live Yjs text
```

### Naive algorithm to avoid

Do not simply calculate:

`diff(C, D)`

when D may have been authored from previously materialized filesystem state B.

### Correct snapshot-anchored algorithm

When disk changes:

1. obtain materialization baseline snapshot `SB`;
2. instantiate/reuse a shadow Y.Doc;
3. apply `SB`;
4. verify shadow text equals stored baseline B/hash;
5. compute minimal text diff `B -> D`;
6. apply diff operations to shadow Y.Text in one local transaction;
7. encode only Yjs update generated after baseline state vector;
8. apply generated update to current live text Y.Doc C;
9. Yjs merges it with concurrent remote operations;
10. persist outbound batch;
11. send encrypted update;
12. materializer writes converged current Y.Text back to disk.

## 10.12 Why this matters

Example:

```text
B:
hello world

Remote operation arrives:
hello amazing world

External editor, based on B, saves:
hello world!
```

External save should become CRDT operations based on B, not a full replacement of already-advanced C.

## 10.13 Diff algorithm

Start with repository's existing `diff-match-patch` only if qualification shows stable minimal code edits.

Evaluate Myers diff for code-sized files.

Required properties:

- deterministic;
- Unicode-safe;
- bounded CPU;
- no full replace for one-character edit;
- timeout/fallback for pathological files.

If diff exceeds CPU budget:

- fall back to larger range replace inside Y.Text;
- do not abandon CRDT semantics.

## 10.14 Direct Cozea-aware CRDT ingress

Optional future optimization:

A Cozea-aware provider/tool may submit Yjs operations directly.

Examples:

- future VS Code extension;
- future agent bridge.

Generic filesystem path remains correct.

## 10.15 Remote Yjs update -> disk

Per text file:

1. apply remote update to background Y.Doc;
2. coalesce materialization briefly;
3. compute resulting text;
4. verify no structural conflict;
5. safe-write to local filesystem;
6. update materialization baseline snapshot/state vector;
7. watcher later observes same hash and emits no new local CRDT edit.

Initial materialization coalescing target:

- normal delay: 20–40 ms;
- maximum delay: 100 ms under continuous update stream.

Tune from measurements.

Do not use old 500 ms fixed writeback debounce as final target.

## 10.16 CRDT update metadata

Every outbound batch carries provenance separately from convergence payload:

```ts
interface ChangeActor {
  actorType:
    | "user"
    | "agent"
    | "terminal-human"
    | "terminal-agent"
    | "external"
    | "system"

  principalId?: string
  identityKey?: string
  provider?: string
  terminalId?: string
  commandId?: string
  runId?: string
  threadId?: string
}
```

Unknown external writer is valid:

```text
actorType = external
```

## 10.17 Deletion

Deletion is a tree structural operation against stable `fileId`.

Do not destroy text history immediately.

Entry becomes tombstoned.

## 10.18 Delete vs concurrent text edit

If delete and text edit are concurrent:

- preserve both causal facts;
- record `delete_modify` conflict;
- allow restore with concurrently edited text.

Never silently resurrect or silently discard.

## 10.19 Directory rename

Git does not track directories as independent objects.

Represent directory rename as one atomic structural batch of path moves for affected entries.

All file IDs remain stable.

## 10.20 Symlink

Represent symlink as stable entry:

```text
kind = symlink
symlinkTarget = literal target string
```

Never dereference target for collaboration content.

## 10.21 Executable bit

Replicate Git-relevant executable mode.

Do not replicate ownership/ACL/Finder metadata in v1.

---

# 11. Binary collaboration

## 11.1 Binary entry model

Tree record points to binary revision state.

Do not store arbitrary binary in Yjs text.

## 11.2 Binary revision ledger

Do not use a single LWW pointer that can silently erase concurrent replacement.

Maintain append-only revisions:

```ts
interface BinaryRevision {
  revisionId: string
  fileId: string
  baseRevisionId: string | null

  contentHash: string
  encryptedManifestRef: string
  size: number

  actor: ChangeActor
  createdAt: number
}
```

## 11.3 Concurrent binary update

If two revisions share same base:

```text
V7 -> V8A
V7 -> V8B
```

create:

`binary_concurrent_revision`

Preserve both.

## 11.4 Binary transport

Use encrypted content storage.

Recommended:

- small binary: one encrypted object;
- large binary: chunk manifest;
- content cache locally;
- SHA-256 integrity.

Initial chunk size:

4 MiB fixed chunks.

Later optimization may use content-defined chunking.

## 11.5 Working-tree semantics

Participants see actual working-tree bytes.

Git LFS conversion is publication/Git-service responsibility, not live collaboration transport.

---

# 12. macOS filesystem observation

## 12.1 Replace current `fs.watch` collaboration owner

Use native FSEvents as low-latency dirty hints.

Use scanner/materialization index as correctness.

## 12.2 FSEvents helper

Swift helper should expose:

- root changed;
- file created;
- file removed;
- renamed;
- modified;
- inode metadata;
- directory/symlink classification;
- dropped-event flags;
- event IDs.

## 12.3 Startup order

For a session workspace:

1. open durable local DB;
2. start FSEvents and buffer hints;
3. mark replica `reconciling`;
4. full scan in-scope tree;
5. compare against materialization index;
6. process genuine offline local changes;
7. replay buffered watcher hints;
8. sync CRDT/cloud;
9. materialize converged state;
10. declare `ready`.

Never declare ready because watcher successfully opened.

## 12.4 Dropped events

On:

- `MustScanSubDirs`;
- user dropped;
- kernel dropped;
- event ID wrap;
- root movement;

schedule authoritative subtree/full scan.

## 12.5 Stable read algorithm

For dirty regular file:

1. delay initial settle by ~50–75 ms;
2. `lstat`;
3. read bytes;
4. `lstat` again;
5. if size/mtime/inode changed, retry;
6. bound retry/backoff;
7. hash stable bytes;
8. compare to materialized hash;
9. classify as echo or local edit.

## 12.6 Atomic-save editors

Temp-file + rename patterns must converge to final destination.

Temporary editor files should not become shared if clearly ignored/untracked.

## 12.7 Echo suppression

After CRDT materializer writes hash H:

```text
materialization[fileId].diskHash = H
```

Watcher reads H:

- no local mutation.

If writer modifies immediately and hash becomes H2:

- genuine local mutation.

No clocks/time windows.

## 12.8 Case sensitivity

Preserve exact path case.

Use volume capabilities to compare collisions.

Test:

- default case-insensitive APFS;
- case-sensitive APFS.

Case-only rename may require intermediate path.

## 12.9 File Provider/iCloud

Session managed workspace should default to normal local Application Support storage, not iCloud/File Provider folder.

## 12.10 Scope/ignore policy

`.git` never enters collaboration content.

Tracked paths are always in scope.

Untracked ignored paths remain local by default.

Use Git-aware ignore checks rather than broad folder blacklists.

Once an untracked file is admitted to session state, membership is sticky until explicit deletion/removal.


# 13. Collaboration transport and durability

## 13.1 Session room identity

Use one Cloudflare Durable Object per collaboration session.

Room identity:

`session:<sessionId>`

Do not use:

`project:<projectId>`

A project may have several collaboration sessions over time and different branches.

## 13.2 WebSocket hibernation

Use Durable Object WebSocket Hibernation.

The room is responsible for:

- authenticated participant sockets;
- global session sequencing;
- idempotency receipts;
- durable encrypted update references/log;
- participant/session presence;
- AutoGit leader lease;
- barrier creation;
- replay cursor coordination.

The room is not responsible for understanding plaintext source code.

## 13.3 Global session sequence

Every accepted collaboration batch gets a monotonically increasing:

`sessionSeq`

Why:

- reconnect;
- replay;
- durable checkpoints;
- AutoGit barriers;
- cross-document batching;
- diagnostics;
- exact "Git checkpoint corresponds to collaboration state N" semantics.

Yjs convergence itself does not require this total ordering.

## 13.4 Batch envelope

Conceptual shape:

```ts
interface CollaborationBatch {
  batchId: string
  sessionId: string
  clientId: string

  operations: Array<
    | { type: "tree-yjs"; update: Uint8Array }
    | { type: "text-yjs"; docId: string; update: Uint8Array }
    | { type: "binary-revision"; descriptor: Uint8Array }
  >

  provenance: Uint8Array | MinimalPublicMetadata
  createdAt: number
}
```

A file create plus its initial text state should be sendable in one session batch so recipients do not temporarily materialize an empty file as a meaningful state.

## 13.5 E2EE

Encrypt collaboration payloads client-side.

Server may know:

- session ID;
- device/session authorization;
- sequence;
- payload sizes;
- opaque doc identifiers where needed;
- lease state;
- barrier state.

Project file contents and sensitive path metadata should remain encrypted where practical.

## 13.6 Durable update log

The accepted update log must be durable independently of connected devices.

Do not design:

```text
if all peers disconnect before AutoGit pushes, unpublished collaboration disappears
```

That is invalid.

## 13.7 Snapshots and compaction

Create encrypted durable snapshots for:

- tree doc;
- active text docs;
- binary revision/head manifest;
- structural conflict metadata needed for recovery.

Large encrypted snapshots live in R2.

Room stores:

```text
snapshotSeq
snapshotRef
replayFloor
```

Advance replay floor only after snapshot durability and integrity are verified.

## 13.8 Join/resume bootstrap strategy

Choose the cheapest correct strategy.

### Local fast resume

If the Mac has a valid local encrypted CRDT snapshot close to room head:

1. load local snapshot;
2. connect;
3. request updates after last durable `sessionSeq`;
4. converge;
5. materialize.

### Git-assisted cold bootstrap

If local session state is missing or very stale:

1. fetch/clone latest AutoGit checkpoint commit;
2. materialize that Git checkpoint into session workspace;
3. load CRDT snapshot corresponding to or newer than that checkpoint;
4. replay newer CRDT updates;
5. materialize exact live state.

Presence of another online peer is not required.

GitHub is a coarse bootstrap accelerator; the durable CRDT room is the live-state authority.

## 13.9 Offline edits

While cloud is unavailable:

- projectd keeps observing files;
- projectd keeps generating Yjs updates locally;
- outbound batches are durably queued;
- UI says `offline / local changes pending`;
- AutoGit is unavailable/degraded;
- local tools remain useful.

On reconnect:

- resend outbound batches idempotently;
- receive remote updates;
- Yjs converges;
- materialize resulting state.

## 13.10 Idempotency

Every batch has unique `batchId`.

Retrying same batch must return original acceptance/sequence result rather than allocate a new sequence.

---

# 14. AutoGit concept

## 14.1 Purpose

AutoGit keeps the session branch on GitHub reasonably close to live CRDT state without turning Git into real-time collaboration transport.

It makes:

- session creation;
- join;
- resume;
- recovery;
- review;
- merge;
- rebase;

smoother and more conventional for GitHub users.

## 14.2 Authority hierarchy

```text
CRDT
  = live session truth

AutoGit
  = Git checkpoint coordinator

GitHub
  = conventional durable branch/history

Session Workbench
  = local participant UI/runtime
```

## 14.3 One AutoGit leader

Only one eligible connected device holds the AutoGit leader lease.

Other devices:

- continue CRDT normally;
- may request checkpoint/push;
- may manually request GitHub sync;
- do not independently perform automatic push loops.

## 14.4 Eligibility

Device must have:

- write-capable session role;
- healthy GitService;
- valid repository access;
- healthy projectd;
- CRDT replica synchronized closely enough to capture a barrier;
- no blocking AutoGit error;
- no stale/revoked device identity.

## 14.5 Lease authority

Use session Durable Object as authoritative lease coordinator.

Fields:

```text
leaderIdentityKey
leaseGeneration
leaseExpiresAt
lastRenewedAt
```

Recommended starting timing:

```text
lease duration: 20 seconds
renewal: every 5 seconds
```

Tune after failure/latency tests.

## 14.6 Fencing

Every automated Git mutation records lease generation.

Before remote mutation:

1. leader revalidates lease with room;
2. lease generation must still match;
3. if partition prevents validation, do not push;
4. use Git expected-OID safeguards;
5. record generation in checkpoint metadata.

A stale leader must not wake up later and continue publishing.

## 14.7 Election

Room prefers current healthy leader.

When leader leaves/expires:

1. enumerate connected eligible write devices;
2. choose deterministic candidate;
3. increment generation;
4. grant lease;
5. broadcast AutoGit state.

Do not invent peer-to-peer consensus when Durable Object already provides single coordination authority.

---

# 15. AutoGit checkpoint algorithm

## 15.1 Checkpoint triggers

Checkpoint can be requested by:

- adaptive periodic scheduler;
- `Checkpoint now`;
- `Push now`;
- leader leave handoff;
- session pause;
- rebase request;
- merge request;
- close preflight.

## 15.2 Adaptive cadence

Do not checkpoint every file save.

Starting policy for qualification:

```text
quiet period after change burst: 15 seconds
maximum dirty interval: 2 minutes
minimum interval between successful automatic checkpoints: 30 seconds
```

Scheduler considers:

- changes since last checkpoint;
- current push state;
- GitHub availability;
- session activity;
- current leader health.

These numbers are tunable, not permanent product guarantees.

## 15.3 Create barrier

Leader requests:

`autogit.barrier.create`

Room returns:

```text
barrierId
sessionSeq = N
serverTime
```

Meaning:

all accepted collaboration batches through N are durable.

Updates after N may continue.

## 15.4 Capture exact CRDT state at N

Leader replica:

1. flushes its own outbound queue before barrier request when possible;
2. applies incoming updates through N;
3. temporarily buffers updates > N;
4. captures immutable tree/text/binary state at N;
5. stores snapshot manifest durably;
6. resumes applying > N.

Do not freeze the entire session for Git checkpoint construction.

## 15.5 Snapshot manifest

Contains:

```text
sessionId
barrierId
sessionSeq
projectId
repositoryBindingId
branchName
targetBranch
treeDocSnapshotRef
textDocSnapshotRefs
binaryRevisionRefs
logicalTreeHash
createdAt = barrier serverTime
```

## 15.6 Build Git tree in isolated Git state

Do not run `git add .` in live session workspace.

Use daemon-owned hidden repository mirror and temporary index/staging.

Steps:

1. fetch exact known remote session-branch parent;
2. verify expected parent OID;
3. reconstruct snapshot tree;
4. apply `.gitattributes`/filters;
5. handle Git LFS;
6. write Git tree;
7. create deterministic checkpoint commit.

## 15.7 Deterministic AutoGit commit

Failover is simpler if same semantic checkpoint can be reproduced by successor.

Use fixed:

- parent OID;
- tree OID;
- AutoGit author identity policy;
- author/committer timestamp derived from barrier `serverTime`;
- canonical message;
- canonical trailers.

Example:

```text
cozea: session checkpoint

Cozea-Session: <sessionId>
Cozea-Seq: <N>
Cozea-Barrier: <barrierId>
Cozea-Snapshot: <logicalTreeHash>
Cozea-Lease-Generation: <generation>
```

Participant attribution belongs in separate metadata/trailers, not nondeterministic commit construction.

## 15.8 Push

Normal periodic checkpoint:

- push exact commit fast-forward to session branch;
- never force for ordinary AutoGit checkpoint.

## 15.9 Lost response

If push response is lost:

1. fetch remote branch;
2. if remote OID equals prepared commit -> success;
3. if remote advanced unexpectedly -> external Git reconciliation;
4. do not create another semantic checkpoint merely because response was lost.

## 15.10 Publish adoption

After remote verification:

record:

```text
lastGitCheckpointSeq = N
lastGitCheckpointOid = C
remoteSessionBranchOid = C
```

Broadcast checkpoint metadata to participants.

Participants already have file bytes via CRDT.

Do not make them `git pull` just to receive content already materialized.

---

# 16. Local Git baseline adoption after AutoGit push

Example participant state:

```text
HEAD = C40
live CRDT = seq 18570
```

AutoGit publishes:

```text
C41 = seq 18500
```

Goal:

advance local Git baseline so Git dirty state represents only live work after seq 18500.

## 16.1 Controlled baseline advancement

1. verify local materialized tree contains C41 snapshot plus later CRDT changes;
2. verify no unrelated local Git transition is active;
3. update branch/HEAD/index safely to C41 while preserving working-tree bytes;
4. refresh status;
5. expected dirty set corresponds to CRDT > 18500 plus intentional local non-session Git state.

This belongs in canonical GitService.

## 16.2 Failure policy

If safe baseline adoption cannot be proven:

- leave local Git metadata behind;
- collaboration still continues;
- show `Git baseline behind`;
- allow repair/manual action.

Never hard reset live project simply to align HEAD.

---

# 17. GitService reimplementation and consolidation

## 17.1 One Git owner

Create daemon-owned:

`GitService`

After cutover, product Git operations must not be independently owned by:

- `GitSyncService`;
- `projectGitDesktopService`;
- direct Electron project handlers;
- WorkspaceCatalog;
- separate collaboration Git shell helpers;
- a separate agent Git implementation that can mutate repository independently of GitService policy.

Existing `VcsDriver` may become an adapter/client contract to GitService.

## 17.2 Real Git CLI

Use pinned/tested real Git executable.

Bundle Git LFS.

Do not use simplified JS Git implementation as canonical behavior.

## 17.3 Preserve normal Git semantics

Respect:

- `.git/config`;
- appropriate user/global config;
- `.gitattributes`;
- clean/smudge filters;
- Git LFS;
- line-ending rules;
- repository-specific behavior.

Do not isolate HOME/config so strongly that Cozea interprets repository differently from normal Git unless deliberately documented.

## 17.4 Authentication

For Cozea-owned network Git:

- no token in remote URL;
- no token in argv;
- noninteractive credential/askpass broker;
- projectd obtains scoped credentials.

External VS Code/terminal Git continues using user's own credentials.

## 17.5 Machine-readable commands

Prefer:

```bash
git status --porcelain=v2 -z --branch --untracked-files=all
git worktree list --porcelain -z
git for-each-ref
git ls-files -z
git check-ignore -z
git rev-parse
git merge-tree --write-tree
git update-ref
```

Avoid parsing human-oriented output as canonical API.

---

# 18. External Git interoperability

Arbitrary tools may run Git inside local session workspace.

Support it.

## 18.1 Observe `.git` metadata separately

Do not replicate `.git` contents.

Detect:

- branch change;
- HEAD move;
- index update;
- merge/rebase/cherry-pick state;
- local commit;
- reset;
- external fetch/pull;
- remote-tracking changes.

## 18.2 `git add`

No file content change.

Update Git status only.

## 18.3 Local `git commit`

If working-tree bytes do not change:

- preserve commit;
- do not send CRDT content change;
- mark local Git history diverged from AutoGit baseline;
- never claim commit was session-published.

## 18.4 `git restore file`

File bytes change.

Normal filesystem->CRDT path handles it.

## 18.5 Branch checkout/switch

When `.git/HEAD` changes away from session branch:

1. pause local filesystem ingress before treating checkout mass writes as collaboration edits;
2. mark Session Workspace `branch-drifted`;
3. do not replicate checkout result;
4. show options:
   - restore session branch;
   - leave session;
   - create/open another Workbench for new branch.

## 18.6 Reset/rebase/merge/cherry-pick in session workspace

If HEAD/history and many files transition:

- enter `external-git-transition`;
- preserve local refs/commits;
- do not automatically broadcast mass rewrite.

Offer:

`Adopt Git result into session`

This:

1. captures local Git tree;
2. compares against current shared CRDT project;
3. computes deliberate import;
4. applies through conflict-aware collaboration path.

Or:

`Restore live session files`

without deleting local Git history.

## 18.7 Manual external push to session branch

Allowed.

AutoGit/room observes remote branch movement.

If fast-forward from known session branch:

1. fetch;
2. identify commit;
3. compare to published baseline;
4. integrate external Git tree into CRDT deliberately;
5. update Git baseline.

If non-fast-forward:

- session enters `remote-diverged`;
- require explicit resolution.

---

# 19. Controlled GitHub sync (`AutoGit pull` replacement)

Do not implement blind periodic `git pull` inside live session workspace.

Expose product action:

`Sync from GitHub`

## 19.1 Manual trigger

Any participant may request.

## 19.2 Join/resume trigger

Bootstrap logic may automatically fetch when local Git checkpoint is meaningfully behind.

## 19.3 Algorithm

1. fetch remote refs in hidden Git mirror;
2. inspect remote session branch;
3. compare with known AutoGit checkpoint;
4. if identical -> no-op;
5. if expected AutoGit fast-forward -> adopt checkpoint metadata;
6. if external fast-forward -> integrate Git tree into CRDT;
7. if rewritten/diverged -> block and surface.

Live filesystem is updated by CRDT materialization, not raw pull.

---

# 20. Target branch tracking and rebase suggestions

## 20.1 Track target continuously

AutoGit fetches target branch periodically while session active and before Git-sensitive actions.

Store:

```text
targetBranch
targetRemoteOid
mergeBaseOid
behindCommitCount
aheadCommitCount
targetChangedPaths
overlapWithSessionPaths
lastTargetCheckAt
```

## 20.2 Suggest, never auto-run

AutoGit may produce:

`rebaseRecommendation`

It may not begin rebase.

## 20.3 Initial "substantially moved" heuristic

Record metrics and tune.

Suggested starting recommendation if any is true:

- target >= 20 commits ahead of session merge base;
- target changed >= 50 paths since merge base;
- target changed at least one path also modified by session and is >= 5 commits ahead;
- session active > 24h and target advanced;
- user explicitly asks to check.

Use dismissal cooldown.

Thresholds are tuning values, not authority to rebase.

---

# 21. Explicit AutoGit rebase from main/target

## 21.1 Entry

Authorized user selects:

`Rebase from main`

or target branch.

Modal shows:

- current session branch;
- target branch;
- current AutoGit checkpoint;
- target OID;
- behind count;
- overlapping paths;
- predicted conflicts when available.

User confirms.

## 21.2 Preconditions

Require:

- healthy session durability;
- AutoGit leader available/electable;
- repository fetch access;
- no conflicting AutoGit push;
- no session-wide structural corruption.

## 21.3 Capture rebase basis

1. request CRDT barrier N;
2. capture exact snapshot N;
3. AutoGit checkpoint N if not already checkpointed;
4. call checkpoint commit `S`;
5. record original merge base `B`;
6. fetch latest target `M`.

## 21.4 Compute in isolated Git environment

Do not use participant session workspace.

Use hidden mirror/temporary worktree.

Perform real Git rebase semantics.

If branch contains external/manual commits, preserve them unless product explicitly chooses another strategy.

## 21.5 Conflict preview

If Git rebase conflicts:

- do not mutate shared CRDT;
- do not force push;
- persist conflict bundle;
- show files/variants;
- allow controlled resolution;
- resolution produces isolated rebased Git result.

## 21.6 Users continue editing during compute

CRDT may advance:

```text
N+1
N+2
N+3
```

Do not freeze collaboration during entire rebase.

## 21.7 Adopt rebased basis into current live CRDT

Let:

```text
B = session snapshot at barrier N before rebase
R = rebased result corresponding to N
L = current live CRDT materialization at adoption time
```

Perform three-way project integration:

```text
base   = B
ours   = L
theirs = R
```

For text:

- compute merged target where needed;
- apply `L -> merged` as deliberate CRDT operations to current Y.Text docs.

For structural changes:

- translate project tree differences into structural operations;
- surface path conflicts.

For binary:

- preserve concurrent revisions/conflicts.

## 21.8 Short final adoption barrier

At final adoption:

1. request short integration barrier;
2. buffer newly arriving batches briefly;
3. capture exact latest L;
4. recompute/verify B/R/L if L advanced;
5. if clean, apply system CRDT batch atomically;
6. release queued edits;
7. queued edits merge after rebase adoption.

Freeze only final adoption, not rebase computation.

## 21.9 Push rewritten Git branch

Rebase rewrites history.

After CRDT adoption succeeds:

1. rebuild exact rebased Git checkpoint;
2. verify remote session branch is expected old OID;
3. push with `--force-with-lease`, never blind `--force`;
4. record old/new OIDs and recovery metadata;
5. update session published baseline.

This history rewrite is allowed only because user explicitly approved rebase.

Periodic AutoGit never force pushes.

## 21.10 Failure

If remote changes during rebase:

- do not force;
- return to preview/reconciliation;
- preserve CRDT live state.

---

# 22. Merge controls

Session Workbench shows merge target, normally `main`.

## 22.1 Merge preflight

Before Merge/PR:

1. ensure latest CRDT durable state;
2. force AutoGit barrier;
3. create/push latest checkpoint;
4. fetch target;
5. verify branch state;
6. compute merge preview isolated from live workspace.

## 22.2 Merge strategy

Support repository/project policy:

- merge commit;
- squash;
- rebase-and-merge/PR path where appropriate.

Do not infer silently.

## 22.3 Protected branch

If direct target push rejected or policy requires PR:

- create/update PR;
- show URL/status;
- do not force.

## 22.4 Merge completion

After target merge, session may:

- remain ACTIVE;
- PAUSE;
- CLOSE;
- create successor branch/session.

Do not automatically delete branch.

---

# 23. Presence and media

## 23.1 Project presence remains separate

Current project presence answers:

`who has this project open?`

Keep separate from:

`who is joined to session S?`

## 23.2 Session presence

Room tracks:

- connected participant;
- background/foreground state;
- display identity;
- optional current tool/activity;
- AutoGit leader badge;
- microphone state;
- screen-share state.

Do not require active file/cursor for correctness.

## 23.3 Microphone

Session Workbench includes microphone toggle.

Media uses WebRTC.

Requirements:

- explicit permission;
- mute/unmute;
- participant indicator;
- TURN support;
- media lifecycle separate from CRDT.

## 23.4 Workbench switch

If Session Workbench becomes IDLE:

Initial policy:

- microphone automatically mutes unless user explicitly opts into background audio;
- file collaboration may stay connected;
- session is not paused.

---

# 24. Capability interaction matrix

## 24.1 Assistant — session workspace

Reads/writes local session workspace.

Writes enter collaboration through filesystem->CRDT.

Provider need not know collaboration protocol.

## 24.2 Assistant — thread worktree

Private/isolated.

Do not watch it as session materialization.

When user selects `Apply to session`:

- compute diff/tree result;
- import to live session through normal CRDT/structural path;
- preserve conflict handling.

## 24.3 Terminal

Local PTY.

Filesystem side effects participate if path is session workspace.

Provenance optional.

## 24.4 Dev server

Local process bound to session workspace.

Remote file materialization triggers normal framework watcher/hot reload.

Do not synchronize dev-server process.

## 24.5 Browser/preview

Local UI.

Do not replicate browser state.

Preview reflects local dev server.

## 24.6 DevApp development

If DevApp writes project files in session workspace, those files participate normally.

No DevApp-specific collaboration transport.

## 24.7 Published Org DevApp

Not the source project.

Do not place installed release state into project CRDT.

## 24.8 Project Memory

Artifacts inside repository follow normal file policy.

If `graphify-out/graph.json` is ignored/local, it remains local.

Memory UI itself is not shared.

## 24.9 Tasks

Task/control state is separate.

Execution target must explicitly resolve:

- ordinary workspace;
- Session Workspace;
- private worktree.

Never use ambient active branch at fire time.

## 24.10 Skills

Personal/provider-native skills are separate device service.

Do not replicate because a project session exists.

Project-local tracked skill files are simply project files.

## 24.11 Computer Use

Separate native capability.

If Computer Use causes an application to save project files, filesystem collaboration sees them.

No Computer Use state goes into CRDT.

---

# 25. Session access control

## 25.1 Cloud tables

Add logical session records.

### `collaborationSessions`

```text
sessionId/publicSessionId
projectId
repositoryBindingId
branchName
targetBranch
createdBy
lifecycle
accessMode
organizationId nullable
createdAt
updatedAt
pausedAt nullable
closedAt nullable
lastDurableSeq
lastSnapshotSeq
lastAutoGitCheckpointSeq
lastAutoGitCommitOid
```

### `collaborationSessionMembers`

```text
sessionId
principalId
role
status
joinedAt
leftAt
```

### `collaborationSessionInvitations`

```text
sessionId
target identity/email/device descriptor
role
status
createdBy
createdAt
expiresAt
resolvedAt
```

### `collaborationSessionKeys`

Versioned wrapped session keys by authorized device.

### `collaborationAutoGit`

```text
sessionId
leaderIdentityKey nullable
leaseGeneration
leaseExpiresAt
lastCheckpointSeq
lastCheckpointOid
lastRemoteOid
lastTargetOid
updatedAt
```

Exact split between Convex and Durable Object must preserve one authority per field.

## 25.2 Viewer

Viewer may:

- receive CRDT;
- view session;
- optionally use local read-only tools.

Viewer may not:

- submit project mutations;
- request write AutoGit operations;
- rebase;
- merge.

## 25.3 Developer

May edit live project and request checkpoint.

## 25.4 Project manager

May additionally:

- invite;
- change session access;
- pause;
- close;
- rebase;
- merge according to project policy.

---

# 26. Encryption and identity

## 26.1 Background identity

Current collaboration private-key authority must move out of renderer/Electron-only lifetime.

Store private device keys through macOS Keychain/Security-compatible background access.

## 26.2 Session E2EE

Generate random session root key.

Derive:

- CRDT update encryption key;
- snapshot encryption key;
- binary encryption key;
- path/metadata key if needed.

## 26.3 Wrapped keys

Wrap session key to authorized device public keys.

## 26.4 Revocation

New updates use rotated key version after participant revocation.

Do not claim revocation can erase plaintext already downloaded.

---

# 27. GitHub and AutoGit credentials

## 27.1 Background access

AutoGit leader must authenticate while Electron UI is closed.

Credential source must be background-capable and scoped.

## 27.2 No credential leakage

Never store token in:

- Git remote URL;
- commit message;
- process arguments;
- CRDT state;
- logs.

## 27.3 GitHub App/webhook

Use GitHub branch webhook/integration to detect remote session/target movement quickly.

Fallback fetch/poll remains available.

---

# 28. Recovery

## 28.1 CRDT recovery

Persist:

- encrypted snapshots;
- outbound updates;
- last session sequence;
- text materialization baselines.

## 28.2 Git recovery

Persist:

- last known remote OID;
- AutoGit checkpoint manifest;
- prepared commit OID;
- pre-rebase branch OID;
- target OID;
- barrier snapshot.

## 28.3 Filesystem recovery

Before destructive replacement in materializer:

- preserve divergent local bytes if they do not equal last materialized baseline;
- create conflict instead of overwrite.

## 28.4 Export

Support:

`Export session recovery`

Contains usable current project state plus conflict variants.

---

# 29. Performance targets

These are qualification goals.

## 29.1 Text local save

Small stable file save -> local CRDT update persisted:

p95 <= 100 ms on reference Mac.

## 29.2 Peer materialization

Small accepted text save -> peer disk updated:

p95 <= 500 ms on normal low-latency network.

Stretch target:

<= 250 ms.

## 29.3 Remote coalescing

Do not deliberately add 500 ms latency.

## 29.4 Idle

No periodic full-repo scan when FSEvents healthy.

No constant Git polling loops.

## 29.5 Formatter burst

500-file rewrite:

- bounded memory;
- eventual exact convergence;
- no lost updates;
- interactive small-file updates not starved indefinitely.

## 29.6 Renderer closed

Same file collaboration latency class as renderer open.

---

# 30. Suggested repository layout

```text
apps/
  projectd/
    src/
      main.ts
      local-api/
      identity/
      workspaces/
      workbenches/
      filesystem/
        FSEventsClient.ts
        Scanner.ts
        StableRead.ts
        MaterializationIndex.ts
        Materializer.ts
        ScopePolicy.ts
      collaboration/
        SessionReplica.ts
        SessionManager.ts
        TreeDoc.ts
        TextDocRegistry.ts
        ExternalSnapshotAdapter.ts
        UpdateBatcher.ts
        Replay.ts
        Snapshots.ts
        ConflictEngine.ts
        BinaryStore.ts
      autogit/
        AutoGitCoordinator.ts
        LeaderLeaseClient.ts
        BarrierCapture.ts
        CheckpointBuilder.ts
        RemoteObserver.ts
        RebaseCoordinator.ts
        MergeCoordinator.ts
      git/
        GitService.ts
        GitProcess.ts
        GitStatus.ts
        RepositoryMirror.ts
        GitAttributes.ts
        GitLfs.ts
      storage/
        Database.ts
        migrations/
      cloud/
      observability/

  projectctl/

packages/
  projectd-protocol/
  collaboration-protocol/

native/
  projectd-macos/
    Package.swift
    Sources/
      CozeaProjectdMac/
        main.swift
        FSEventsService.swift
        KeychainService.swift
        VolumeCapabilities.swift
        AtomicFileOps.swift

apps/desktop/
  electron/
    projectd/
      ProjectdClient.ts
      registerProjectdHandlers.ts
      ProjectdServiceRegistration.ts
  src/features/
    collaboration/
      model/
      services/
      ui/
    workbench/
    inbox/

cloudflare/worker/src/
  durableObjects/
    CollaborationSessionRoom.ts

convex/
  collaborationSessions.ts
  collaborationInvitations.ts
  collaborationKeys.ts
```

Names may be adjusted once to repository conventions.

Do not put canonical CRDT ownership back into a renderer context.

---

# 31. Implementation guide system

Every phase below has:

- Objective;
- Prerequisites;
- Required code changes;
- Forbidden shortcuts;
- Tests;
- Manual checkpoint;
- Exit gate.

The implementation agent must not start phase N+1 before phase N exit gate is met.


# P00 — Rebaseline, preserve product truth, and create the ledger

## Objective

Freeze product model and current repository ownership before writing new collaboration code.

## Prerequisites

None.

## Required work

1. Resolve latest `origin/main`.
2. Record it in status ledger.
3. Read current:
   - `AGENTS.md`;
   - `ARCHITECTURE.md`;
   - `docs/desktop-product.md`;
   - `docs/tmux-inspired-runtime-architecture.md`;
   - `shared/workspaceTypes.ts`;
   - `apps/desktop/src/lib/workbenchTileContract.ts`;
   - Workbench/runtime ownership;
   - Inbox/share flows;
   - current Yjs contexts/doc/provider;
   - current file watcher;
   - current binary sync;
   - current Git/VCS stacks;
   - current Cloudflare room/protocol;
   - current Convex collaboration/project schemas.
4. Search all owners:
   - `YjsProjectDoc`;
   - `YjsProjectProvider`;
   - `useAgentFileSync`;
   - `useYjsFileWriteback`;
   - `useBinaryFileSync`;
   - `projectWatcher`;
   - `GitSyncService`;
   - `GitCore`;
   - `VcsDriver`;
   - direct `runGitCommand`;
   - collaboration session bootstrap;
   - project presence.
5. Create status ledger.
6. Add this plan to repo under:
   `docs/collaboration/collaboration-autogit-master-plan.md`
7. Add explicit superseded notices to old collaboration plans still likely to confuse agents.
8. Add architecture test asserting current Workbench tile contract has no collaboration-required source editor.

## Forbidden shortcuts

- Do not delete old code yet.
- Do not begin daemon architecture before owner map is complete.
- Do not trust stale planning docs over production code/tests.

## Tests

Run baseline:

```bash
bun install
bun run typecheck
bun run typecheck:electron
bun run lint
bun run build
```

Run relevant architecture tests.

Record existing failures separately.

## Manual checkpoint

Reviewer verifies ownership inventory lists every active collaboration/Git owner.

## Exit gate

Status ledger contains exact baseline SHA, active owner map, and baseline test results.

---

# P01 — Canonical domain contracts: Workbench, Session, participant, AutoGit

## Objective

Introduce correct types/state machines without changing live collaboration behavior yet.

## Prerequisites

P00 complete.

## Required work

1. Add neutral shared contracts for:
   - `LocalProjectWorkbench`;
   - `CollaborationSessionDescriptor`;
   - `CollaborationParticipant`;
   - `SessionLifecycle`;
   - `ParticipantLifecycle`;
   - `AutoGitLease`;
   - `AutoGitCheckpoint`;
   - `RebaseStatus`;
   - `SessionAccessMode`.
2. Ensure:
   `workbenchId != workspaceId != sessionId != branchName`.
3. Add local Workbench persistence abstraction.
4. Add invariant helpers:
   - one active local Workbench per project;
   - Session Workbench requires `sessionId`;
   - ordinary Workbench cannot claim session membership.
5. Add pure state-machine transition validators.
6. Add serializer/version fields.

## Forbidden shortcuts

- Do not repurpose existing branch-session localStorage shape and merely rename it.
- Do not use `collab` as a magic lane ID to mean session membership.
- Do not attach layout JSON to cloud Session descriptor.

## Tests

Pure tests covering every valid/invalid transition.

Critical assertions:

```text
branch equality cannot create collaboration membership
switching local Workbench cannot pause global Session
one device may persist several Workbenches for one project
only one Workbench may be active
```

## Exit gate

New domain contracts exist and no production path has yet been forced to adopt incorrect compatibility semantics.

---

# P02 — Standalone projectd and local client protocol

## Objective

Create renderer-independent process ownership.

## Prerequisites

P01 complete.

## Required work

1. Add `apps/projectd`.
2. Add `packages/projectd-protocol`.
3. Implement:
   - single instance;
   - Unix socket;
   - protocol handshake;
   - version;
   - health;
   - event subscription;
   - structured errors;
   - graceful shutdown.
4. Add `cozea-projectctl`.
5. Electron main connects through `ProjectdClient`.
6. No collaboration functionality migration yet.

## Checkpoint P02-A

Daemon runs from source without Electron.

## Checkpoint P02-B

Standalone compiled artifact runs and `projectctl health` succeeds.

## Checkpoint P02-C

Electron can connect/disconnect without owning daemon lifecycle.

## Forbidden shortcuts

- no Electron utility process as final daemon;
- no React import;
- no cloud call from renderer for daemon-owned future methods.

## Exit gate

Packaged/local standalone projectd responds while Electron is not running.

---

# P03 — macOS helper, LaunchAgent, Keychain identity

## Objective

Make background lifetime and device identity real.

## Prerequisites

P02 complete.

## Required work

1. Add Swift helper package.
2. Implement helper protocol.
3. Implement FSEvents smoke API.
4. Implement Keychain operations.
5. Migrate existing development collaboration identity when practical.
6. Prove same public identity signs cloud challenge.
7. Add `SMAppService` LaunchAgent registration/status bridge.
8. Package LaunchAgent plist/binary correctly.
9. Ensure projectd can authenticate cloud with Electron closed.

## Tests

- Swift unit tests.
- signed debug fixture.
- Electron closed -> projectd auth success.
- restart -> same identity.
- revoked identity -> fail closed.

## Exit gate

Background daemon survives renderer/app-window lifetime and authenticates as device principal.

---

# P04 — Daemon-owned workspace + Workbench registry

## Objective

Move durable project/workspace/workbench identity below UI.

## Prerequisites

P03 complete.

## Required work

1. Create SQLite schema.
2. Import existing WorkspaceCatalog records.
3. Add LocalProjectWorkbench persistence.
4. Implement one-active-Workbench transaction.
5. Adapt Electron reads to projectd.
6. Keep source attached folders untouched.
7. Preserve storage ownership semantics.
8. Add workbench list/get/create/activate/idle/close daemon API.

## Tests

- migration idempotent;
- attached folder never moved;
- active switch atomic;
- restart restores active/idle Workbenches;
- removing one Workbench does not remove unrelated workspace.

## Exit gate

Workbench/workspace identity can be queried and switched headlessly.

---

# P05 — GitService consolidation foundation

## Objective

Create one future Git owner before AutoGit depends on Git.

## Prerequisites

P04 complete.

## Required work

1. Add daemon Git runtime.
2. Bundle/qualify Git + Git LFS.
3. Implement machine-readable status.
4. Implement refs/branch/fetch/clone.
5. Implement Git-aware ignore classification.
6. Implement hidden repository mirror.
7. Implement Git attributes/filter-aware blob construction.
8. Adapt existing VcsDriver to daemon client.
9. Begin redirecting current source-control callers.
10. Add architecture lint/test preventing new direct Git execution outside allowed GitService implementation.

## Checkpoint

Do not delete GitSyncService until callers migrate.

## Tests

- normal Git config/attributes parity fixture;
- LFS fixture;
- custom filter fixture;
- detached HEAD;
- unborn branch;
- linked-worktree repository;
- repository with custom default branch.

## Exit gate

New GitService can inspect and prepare repositories without using legacy collaboration Git stack.

---

# P06 — Native FSEvents + scanner/materialization index

## Objective

Replace collaboration's current `fs.watch` correctness path.

## Prerequisites

P05 complete.

## Required work

1. Implement FSEvents stream in Swift helper.
2. Implement root/file-event flags.
3. Implement dropped-event detection.
4. Implement stable read.
5. Implement full scanner.
6. Implement Git-aware scope.
7. Implement materialization index.
8. Implement hash-based echo classification.
9. Implement startup watcher-buffer + full scan.
10. Implement periodic audit.
11. Do not connect to Yjs yet; emit normalized filesystem events to tests.

## Tests

- VS Code atomic save fixture;
- Vim save;
- terminal write;
- rename;
- directory rename;
- case-only rename;
- 500-file format;
- daemon downtime;
- user-dropped event;
- kernel-dropped event;
- workspace root moved;
- 100k-path scan;
- tracked `vendor`, `dist`, `build` paths;
- ignored `.env`.

## Exit gate

Local project index reconstructs exact in-scope filesystem state after watcher loss/restart.

---

# P07 — CRDT tree + per-text-file docs in projectd

## Objective

Build correct background replicated project data model locally.

## Prerequisites

P06 complete.

## Required work

1. Implement tree Y.Doc.
2. Implement stable file IDs.
3. Implement structural operation history.
4. Implement path collision reducer.
5. Implement text-doc registry.
6. Implement classification.
7. Implement tombstones.
8. Implement binary revision metadata.
9. Implement local snapshot persistence.
10. Write deterministic two-replica tests with shuffled delivery order.

## Tests

- concurrent text insertions;
- concurrent text delete/insert;
- rename + text edit;
- concurrent rename;
- delete + edit;
- path collision;
- chmod;
- symlink;
- binary sibling revisions;
- late-arriving structural update.

## Exit gate

Two in-memory replicas converge on project state independent of operation delivery order.

---

# P08 — Snapshot-anchored filesystem -> CRDT adapter

## Objective

Correctly convert arbitrary external file saves into CRDT operations.

## Prerequisites

P07 complete.

## Required work

1. Store exact materialized text snapshot/state vector.
2. On external save:
   - load baseline shadow doc;
   - verify baseline;
   - diff baseline filesystem text -> new disk text;
   - apply diff to shadow;
   - encode Yjs delta from baseline state;
   - apply to live doc.
3. Implement bounded diff.
4. Implement provenance.
5. Implement local durable outbound batch.
6. Preserve classification and structural identity.

## Critical concurrency test

B materialized.

Remote update advances live CRDT to C.

External editor saves D based on B.

Generated update must merge using B's Yjs ancestry, not replace C.

## Additional tests

- one character insertion;
- one character deletion;
- Unicode/emoji;
- newline/EOL changes;
- whole-file formatter;
- pathological diff timeout fallback.

## Exit gate

External saves produce micro-granular Yjs updates with correct concurrent behavior.

---

# P09 — CRDT -> filesystem materializer

## Objective

Materialize background CRDT into ordinary local files with low latency.

## Prerequisites

P08 complete.

## Required work

1. Per-file update observers.
2. 20–40ms adaptive coalescer.
3. atomic/safe text writes.
4. mode/symlink application.
5. materialization baseline update.
6. path conflict suppression.
7. divergent disk protection.
8. no time-based watcher ignore.
9. instrumentation for update->disk latency.

## Tests

- remote one-character edit;
- rapid 100 updates;
- external writer modifies immediately after remote materialization;
- rename + update;
- delete conflict;
- crash before/after atomic rename.

## Exit gate

Remote CRDT state reaches disk quickly and never echoes back as new edit.

---

# P10 — Cloud session room, global sequence, E2EE, durable replay

## Objective

Make background CRDT distributed and durable.

## Prerequisites

P09 complete.

## Required work

1. New session-scoped room ID.
2. New protocol version.
3. Global batch sequence.
4. Idempotent batch IDs.
5. Encrypted payload.
6. Room persistence.
7. Encrypted R2 snapshots.
8. Reconnect/replay.
9. State-vector support where useful.
10. WebSocket Hibernation.
11. Durable session snapshots independent from Git.
12. Protocol max-size/backpressure behavior.

## Two-client headless test

No Electron:

- client A writes text;
- client B converges;
- disconnect;
- both edit offline;
- reconnect;
- converge;
- room evicts/re-instantiates;
- state still recovers.

## Exit gate

Headless CRDT collaboration survives disconnect and room re-instantiation.

---

# P11 — Binary live collaboration

## Objective

Complete project-tree coverage.

## Prerequisites

P10 complete.

## Required work

1. encrypted object upload;
2. chunked large file support;
3. binary revision ledger;
4. local cache;
5. concurrent sibling detection;
6. conflict export/resolve;
7. integrate tree record;
8. resumable interrupted upload/download.

## Exit gate

Images/fonts/large assets replicate without defining text hot path.

---

# P12 — Session control plane, invitation/access model

## Objective

Create real persistent Sessions separate from projects/branches.

## Prerequisites

P11 complete.

## Required work

1. Convex session tables.
2. Session roles.
3. Invite-only mode.
4. Organization-available mode.
5. Session key distribution.
6. Durable Object session binding.
7. Session lifecycle APIs.
8. Project membership + session invite acceptance rules.
9. Branch uniqueness/retained-session rule.
10. Session list/read endpoints for Workbench switcher.

## Tests

- invite user with project access;
- invite user without project access;
- org member join;
- outsider denied;
- revoked device denied;
- dormant resume;
- closed denied;
- duplicate live session branch prevented.

## Exit gate

Session identity/access exists without relying on ProjectLayout branch equality.

---

# P13 — Local Session Workbench and multi-Workbench switching

## Objective

Make local UX model real.

## Prerequisites

P12 complete.

## Required work

1. Project may list multiple local Workbenches.
2. Create dedicated managed session clone/workspace.
3. Create Session Workbench record.
4. Activate/idle atomically.
5. Preserve background session when Workbench idles.
6. Update routing/header to use active Workbench identity.
7. Do not share layout.
8. Ensure each Workbench resolves exact workspace/branch.

## Tests

- ordinary main WB;
- ordinary feature WB;
- Session WB;
- switch repeatedly;
- session files continue syncing while Session WB idle;
- no branch checkout mass rewrite between WBs.

## Exit gate

One project can persist many local Workbenches with one locally active at a time.

---

# P14 — Share/Create session UX

## Objective

Implement creator flow exactly.

## Prerequisites

P13 complete.

## Required work

1. Share -> Start collaboration modal.
2. Repository preflight.
3. Branch select/create.
4. Existing-session detection.
5. Dirty-state Include option.
6. Invite/org access.
7. Session creation.
8. Local session workspace.
9. CRDT bootstrap.
10. Session Workbench activation.
11. Error/retry states at every step.

## Manual qualification

Record complete creator flow for:

- clean current branch;
- new branch;
- dirty current branch Include;
- dirty current branch Exclude;
- existing retained session.

## Exit gate

Creator reaches live Session Workbench without source workspace destruction.

---

# P15 — Inbox invite acceptance and Resume flow

## Objective

Implement participant entry paths.

## Prerequisites

P14 complete.

## Required work

1. Session invite Inbox card.
2. Atomic acceptance.
3. Local workspace provision.
4. Local Session Workbench.
5. Git-assisted bootstrap.
6. CRDT catch-up.
7. Exact live materialization.
8. Resume by opening persisted Session Workbench.
9. Creating/blocked/retry UI states.

## Failure tests

- network lost after invite accept;
- disk full during clone;
- room unavailable;
- GitHub unavailable but local/CRDT state enough;
- revoked invitation;
- session paused;
- session closed during bootstrap.

## Exit gate

Invitee and returning participant land at exact live session state.

---

# P16 — AutoGit leader lease

## Objective

Implement one-machine automated Git authority safely.

## Prerequisites

P15 complete.

## Required work

1. Eligibility reports.
2. Durable Object lease state.
3. Renew/expire.
4. Generation/fencing.
5. Transfer on leave.
6. UI status.
7. Manual request routing to leader.
8. No production Git mutation yet beyond controlled test fixture.

## Tests

- two eligible devices;
- three eligible devices;
- leader dies;
- successor generation increments;
- old leader reconnects and cannot act with stale generation;
- network partition prevents stale push;
- leader loses GitHub credential -> transfer/degraded.

## Exit gate

At most one device is authorized for automatic Git mutation at a time.

---

# P17 — AutoGit barriers, deterministic checkpoint commit, periodic push

## Objective

Turn live CRDT snapshots into safe GitHub checkpoints.

## Prerequisites

P16 complete.

## Required work

1. Barrier API.
2. Exact seq-N snapshot capture.
3. Buffer >N while capturing.
4. Hidden Git staging.
5. Deterministic commit.
6. Fast-forward push.
7. Remote verify.
8. Publish checkpoint metadata.
9. Adaptive scheduler.
10. Manual `Push now`.
11. Leader failover reproduction.
12. Checkpoint diagnostics/status.

## Tests

- edits continue while checkpoint captures;
- lost push response;
- leader dies after commit before push;
- next leader reproduces same commit;
- remote unexpectedly advances;
- custom attributes/LFS;
- no-op checkpoint when no changes.

## Exit gate

GitHub session branch periodically advances to exact immutable CRDT barriers.

---

# P18 — Local Git baseline advancement after AutoGit checkpoint

## Objective

Make participant Git status meaningful without pulling bytes already delivered by CRDT.

## Prerequisites

P17 complete.

## Required work

1. Safe baseline-adoption algorithm.
2. Preserve working-tree bytes.
3. Preserve post-checkpoint CRDT dirtiness.
4. Detect unsupported local Git transition.
5. Degrade without harming collaboration.
6. Refresh current source-control UI from GitService.

## Required example test

Before:

```text
HEAD C40
live seq 18570
```

AutoGit checkpoint:

```text
C41 = seq 18500
```

After baseline adoption:

```text
HEAD C41
working tree still seq 18570
Git dirty state = only changes after 18500
```

## Exit gate

Participant Git baseline can advance without destroying CRDT-newer working tree.

---

# P19 — External Git interoperability and controlled GitHub sync

## Objective

Make VS Code/terminal Git a supported surface.

## Prerequisites

P18 complete.

## Required work

1. `.git` metadata observer.
2. Add/commit classification.
3. Checkout drift protection.
4. Reset/rebase/merge transition protection.
5. `Adopt Git result`.
6. External session-branch push observation.
7. Controlled `Sync from GitHub`.
8. Remote divergence state.
9. Preservation of local refs/commits.

## Exit gate

External Git cannot accidentally broadcast checkout/rebase as ordinary CRDT edits.

---

# P20 — Target tracking and rebase recommendation

## Objective

Know when main has meaningfully moved without changing session automatically.

## Prerequisites

P19 complete.

## Required work

1. Target fetch/status.
2. Merge-base.
3. Behind/ahead metrics.
4. Changed-path analysis.
5. Overlap analysis.
6. Recommendation policy.
7. Dismiss cooldown.
8. Manual `Check for updates from main`.
9. UI explanation of recommendation.

## Exit gate

UI can accurately explain why rebase is recommended; no rebase can start automatically.

---

# P21 — Explicit isolated Rebase from main

## Objective

Implement user-approved rebase flow.

## Prerequisites

P20 complete.

## Required work

1. Confirmation UI.
2. Barrier/checkpoint.
3. Isolated Git rebase.
4. Conflict bundle.
5. Continue live CRDT while computing.
6. B/R/L integration.
7. Short final adoption barrier.
8. CRDT system batch.
9. Force-with-lease rewritten branch.
10. Recovery metadata.
11. Failure rollback/retry.

## Mandatory tests

- target unchanged;
- clean rebase;
- conflicting rebase;
- users edit same file during compute;
- users edit different file during compute;
- remote session branch changes during compute;
- leader fails mid-rebase;
- target moves again before push;
- force-with-lease rejection;
- restart after conflict bundle created.

## Exit gate

Explicit rebase updates live session and Git branch without losing post-barrier collaboration.

---

# P22 — Merge/PR controls

## Objective

Complete session-to-target lifecycle.

## Prerequisites

P21 complete.

## Required work

1. Force latest checkpoint.
2. Isolated merge preview.
3. Conflict display.
4. Direct merge where allowed.
5. PR path where required.
6. Protected branch behavior.
7. Post-merge session lifecycle choices.
8. Session branch retention/deletion policy UI.

## Exit gate

Merge operates on immutable reviewed Git checkpoint, not moving CRDT state.

---

# P23 — Electron collaboration UI cutover

## Objective

Current Cozea app becomes a client of background architecture.

## Prerequisites

P22 complete.

## Required work

1. Remove renderer Yjs ownership from active path.
2. ProjectLayout no longer enables collaboration from branch equality.
3. Session Workbench controls.
4. Participant UI.
5. AutoGit status.
6. Checkpoint/push action.
7. Rebase recommendation.
8. Merge controls.
9. Conflicts/recovery.
10. Microphone-control shell.
11. Workbench switcher.
12. Background/idle indicators.
13. Current collaboration contexts become read-only client projections or are removed.

## Exit gate

Closing renderer does not stop live CRDT/session.

---

# P24 — Capability integration qualification

## Objective

Verify every current Cozea capability behaves correctly in Session Workspace.

## Required matrix

Assistant:

- sessionWorkspace;
- threadWorktree;
- apply thread worktree.

Terminal:

- manual write;
- formatter;
- Git command.

Dev server:

- remote CRDT write hot reload.

Browser:

- remains local.

DevApp:

- file writes sync.

Memory:

- shared/ignored graph artifact follows file policy.

Tasks:

- explicit execution context.

Computer Use:

- save through external app observed.

Skills:

- no accidental session synchronization.

## Exit gate

No capability needs a private collaboration file transport.

---

# P25 — Microphone/session media

## Objective

Add media without coupling to file correctness.

## Prerequisites

P24 complete.

## Required work

1. WebRTC signaling.
2. Microphone permission.
3. Mute/unmute.
4. Session presence media fields.
5. TURN.
6. Idle Workbench mute policy.
7. Leave/pause cleanup.
8. Media reconnect behavior.

Screen share is follow-up within same media subsystem if desired.

## Exit gate

Media failure/reconnect cannot block CRDT/AutoGit.

---

# P26 — Remove legacy collaboration and duplicate Git owners

## Objective

Finish architectural cutover.

## Prerequisites

P25 complete.

## Remove or retire after caller audit

- renderer-owned `YjsProjectProvider` collaboration path;
- `WorkspaceRuntimeHosts` ownership of Yjs runtime;
- `useAgentFileSync` as agent-specialized collaboration correctness path;
- `useYjsFileWriteback`;
- old `useBinaryFileSync`;
- old `projectWatcher` collaboration owner;
- obsolete sync journal;
- project-only `/collab/session` protocol;
- old room IDs `project:<projectId>`;
- old branch-equality collaboration activation;
- duplicate `GitSyncService`;
- duplicate `projectGitDesktopService`;
- direct project/workspace Git callers replaced by GitService;
- obsolete Convex Yjs tables after data/reset plan.

Do not delete unrelated functionality until caller migration is proven.

## Architecture tests

Fail CI if:

- projectd imports React;
- projectd imports Electron renderer code;
- collaboration correctness path depends on Workbench tile type;
- renderer creates collaboration WebSocket;
- new direct Git execution appears outside GitService;
- `activeBranch === collabBranch` decides membership;
- source-editor tile is added as collaboration requirement.

## Exit gate

Exactly one live collaboration engine and one canonical product Git owner remain.

---

# P27 — Packaged two-Mac release qualification

## Objective

Prove actual product, not only unit tests.

## Prerequisites

P26 complete.

## Required hardware

At least two physical Macs with independent Cozea device identities.

## Required scenarios

Run complete acceptance matrix in Section 32.

Include:

- Electron closed;
- LaunchAgent;
- VS Code;
- terminal;
- two writers;
- offline;
- AutoGit failover;
- checkpoint;
- external Git;
- rebase;
- merge;
- binary;
- media.

## Exit gate

Signed packaged app passes release matrix against deployed cloud revisions.

---

# 32. Mandatory acceptance matrix

## 32.1 Project / Workbench

| ID | Scenario | Required result |
|---|---|---|
| W01 | Project has main ordinary WB + feature ordinary WB + session WB | all persist independently |
| W02 | Switch main -> session | main idles locally; session activates |
| W03 | Switch session -> main | session not globally paused |
| W04 | Session WB idle | background file replica may stay joined |
| W05 | Delete local presentation only | global session remains |
| W06 | Two participants same session | layouts differ without affecting sync |
| W07 | No Cozea window open | session files continue syncing |

## 32.2 Creation / invitation

| ID | Scenario | Required result |
|---|---|---|
| S01 | Share current clean branch | session created on exact branch |
| S02 | Share new branch | correct base |
| S03 | Current WB dirty + Include | dirty files become session CRDT state |
| S04 | Current WB dirty + Exclude | source WB unchanged; session begins clean |
| S05 | Invite existing collaborator | session membership created |
| S06 | Invite non-project collaborator | project access + session access correctly established |
| S07 | Org-available join | authorized org member joins |
| S08 | Outsider attempts org join | denied |
| S09 | Inbox accept | local Session WB created |
| S10 | Accept then network fails | membership retained; local bootstrap retryable |

## 32.3 Text CRDT

| ID | Scenario | Required result |
|---|---|---|
| T01 | one-character VS Code save | micro Yjs update |
| T02 | A/B separate insertions | converge |
| T03 | A/B same region | converge by CRDT semantics |
| T04 | external save based on old materialization while remote edit arrived | snapshot-anchored delta preserves concurrent semantics |
| T05 | 100 autosaves | low-latency coalesced disk materialization |
| T06 | formatter 500 files | converge |
| T07 | daemon offline edits | reconnect merge |
| T08 | text file renamed while peer edits | stable file ID preserves content relationship |
| T09 | delete vs edit | explicit preserved conflict |
| T10 | path collision | no silent overwrite |

## 32.4 Filesystem

| ID | Scenario | Required result |
|---|---|---|
| F01 | VS Code temp+rename save | final logical change |
| F02 | Vim save | sync |
| F03 | shell redirection | sync |
| F04 | script write | sync |
| F05 | CRDT materializer write observed by FSEvents | no echo |
| F06 | external edit immediately after materializer | genuine edit detected |
| F07 | daemon stopped during writes | startup scan detects |
| F08 | FSEvents user drop | rescan |
| F09 | FSEvents kernel drop | rescan |
| F10 | case-only rename | exact case |
| F11 | case-sensitive APFS | correct distinct paths/conflict policy |
| F12 | tracked `dist/` file | shared |
| F13 | ignored untracked `.env` | local by default |
| F14 | admitted file later ignored | not silently removed |
| F15 | symlink | target string shared, target not dereferenced |
| F16 | chmod +x | shared |
| F17 | `.git` changes | not project-content synced |

## 32.5 Binary

| ID | Scenario | Required result |
|---|---|---|
| B01 | PNG replace | peer exact bytes |
| B02 | 100MB asset | chunk/resume |
| B03 | concurrent PNG replace | conflict preserves both |
| B04 | text -> binary reclassification | explicit safe transition |
| B05 | Git LFS asset | live actual bytes; Git publication correct |

## 32.6 AutoGit leadership

| ID | Scenario | Required result |
|---|---|---|
| A01 | 3 eligible Macs | exactly one leader |
| A02 | leader leaves | successor elected |
| A03 | stale leader reconnects | stale generation cannot push |
| A04 | leader network partition | cannot validate lease -> no push |
| A05 | manual Push from nonleader | request routed to leader |
| A06 | no eligible leader | CRDT continues; AutoGit degraded |

## 32.7 AutoGit checkpoint

| ID | Scenario | Required result |
|---|---|---|
| C01 | barrier N while edits continue | commit exactly N |
| C02 | edits N+1 after barrier | remain live/uncommitted |
| C03 | push response lost | remote verification resolves |
| C04 | leader dies after commit before push | successor reproduces/continues safely |
| C05 | GitHub branch unexpectedly advanced | no blind overwrite |
| C06 | custom attributes | correct Git tree |
| C07 | Git LFS | correct push |
| C08 | participants do not pull bytes | CRDT already provides content |

## 32.8 External Git

| ID | Scenario | Required result |
|---|---|---|
| G01 | git add | no CRDT file change |
| G02 | local commit | preserved, not falsely session-published |
| G03 | git restore file | resulting bytes sync |
| G04 | branch checkout | local ingress pauses; no mass CRDT rewrite |
| G05 | reset --hard | explicit Git transition |
| G06 | local rebase | explicit Git transition |
| G07 | Adopt Git result | deliberate CRDT import |
| G08 | external fast-forward push | integrated into session |
| G09 | external force push | remote-diverged |
| G10 | Sync from GitHub | controlled fetch/integration, not blind pull |

## 32.9 Rebase from main

| ID | Scenario | Required result |
|---|---|---|
| R01 | main unchanged | no-op/explanation |
| R02 | main advanced, user declines | nothing changes |
| R03 | main advanced, clean rebase | live session updated |
| R04 | rebase conflicts | no shared mutation until resolution |
| R05 | users edit during rebase compute | edits preserved |
| R06 | same file edited after barrier | B/R/L merge protects |
| R07 | target moves during compute | stale result not pushed |
| R08 | old session branch remote changes during compute | force-with-lease refuses |
| R09 | successful rebase | explicit force-with-lease only |
| R10 | leader fails mid-rebase | recoverable state; no silent history rewrite |

## 32.10 Merge

| ID | Scenario | Required result |
|---|---|---|
| M01 | merge requested with live dirty state | force barrier/checkpoint |
| M02 | clean merge | exact immutable commit used |
| M03 | conflicts | preview/resolve |
| M04 | protected target | PR path |
| M05 | session continues after merge | allowed by explicit choice |
| M06 | session closes after merge | branch/history retained per policy |

## 32.11 Background

| ID | Scenario | Required result |
|---|---|---|
| D01 | Electron closes | projectd remains |
| D02 | projectd restarts | durable session resumes |
| D03 | Mac sleep/wake | reconnect + rescan |
| D04 | disk full | no false durability ack |
| D05 | room unavailable | offline queue retained |
| D06 | GitHub unavailable | CRDT still works |
| D07 | AutoGit unavailable | CRDT still works |

## 32.12 Capabilities

| ID | Scenario | Required result |
|---|---|---|
| U01 | Cozea agent sessionWorkspace writes | live sync |
| U02 | Cozea agent threadWorktree writes | private until adopt |
| U03 | Terminal writes | live sync |
| U04 | Dev server peer | hot reload |
| U05 | Browser | local-only state |
| U06 | DevApp writes | live sync |
| U07 | Project Memory artifact | follows file policy |
| U08 | Task runs in session | explicit session workspace |
| U09 | Computer Use saves through VS Code | file sync |
| U10 | Skills | not accidentally session-synced |

---

# 33. Review checklist for every PR

Reviewer must answer all.

## Product

- Is this sharing project files or accidentally sharing a Workbench?
- Does this still work with VS Code?
- Does this still work with Electron closed?
- Does this preserve CRDT text semantics?
- Is Git being used only for history/publication?
- Is session identity distinct from branch?

## Ownership

- Did this add a second Git owner?
- Did this add a second watcher truth?
- Did this put cloud transport in React?
- Did this make a tool-specific write path correctness-critical?

## AutoGit

- Does automatic Git mutation require current fenced leader?
- Does checkpoint use immutable CRDT barrier?
- Can another leader reproduce/recover?
- Is ordinary checkpoint fast-forward only?
- Is any history rewrite explicit user-approved rebase?
- Is rebase `force-with-lease`, not force?

## Data loss

- What happens if process dies after every durable boundary?
- What happens if remote response is lost?
- What happens if disk changes underneath materializer?
- What happens if branch changes externally?
- What happens if two files claim same path?
- What happens if binary edits are concurrent?

## Tests

- Does test execute production owner?
- Is it only type-level/mock test?
- Is there a two-replica test where applicable?
- Is there restart/replay test?

---

# 34. Implementation anti-patterns

Reject code review if any appears without explicit architecture approval.

## 34.1 Shared Workbench state

Bad:

```text
broadcast Dockview layout to collaborators
```

## 34.2 Branch equality membership

Bad:

```ts
const collaborationEnabled = activeBranch === collabBranch
```

## 34.3 Agent-first sync

Bad:

```text
agent -> collaboration API -> filesystem
external tools -> fallback watcher
```

Correct:

```text
filesystem -> CRDT
agent metadata = optional enrichment
```

## 34.4 Renderer-owned Yjs

Bad:

```tsx
<YjsProjectProvider> is required for session to remain alive
```

## 34.5 Full-file replace CRDT

Bad:

```text
delete entire Y.Text
insert entire file
```

for a one-character external save.

## 34.6 Current-doc diff for stale external save

Bad:

```text
diff(current live CRDT text, disk snapshot)
```

without materialization-base ancestry.

## 34.7 Timestamp echo window

Bad:

```text
if Date.now() - lastInternalWrite < 1500:
    ignore
```

## 34.8 Raw AutoGit commit from live disk

Bad:

```bash
cd live-session-workspace
git add .
git commit
git push
```

## 34.9 Blind pull

Bad:

```bash
git pull
```

on live workspace while watcher is active.

## 34.10 Automatic rebase

Bad:

```text
main is 10 commits ahead -> start rebase
```

Correct:

```text
recommend -> user approves -> isolated rebase
```

## 34.11 Force push outside explicit rebase

Bad.

Periodic AutoGit is fast-forward only.

## 34.12 Git overwrite to align peers

Bad:

```bash
git reset --hard origin/session
```

when CRDT contains newer work.

---

# 35. Documentation updates required during implementation

Keep these consistent:

- `AGENTS.md`;
- `ARCHITECTURE.md`;
- `docs/desktop-product.md`;
- runtime architecture docs;
- collaboration protocol docs;
- workspace model docs;
- Git/VCS docs;
- release process docs when projectd packaging changes.

Specifically remove/repair stale statements that imply:

- built-in file editor is product center;
- room = project;
- collaboration = collab branch equality;
- renderer hosts are authoritative.

---

# 36. Definition of done

Implementation is complete only when all are true.

1. Share creates persistent collaboration session.
2. User selects or creates session branch.
3. User can invite individuals or expose session to organization according to permission model.
4. Creator gets local Session Workbench.
5. Invitee accepts from Inbox and gets their own local Session Workbench.
6. Session Workbenches are not shared presentation state.
7. One project can persist multiple local Workbenches.
8. One Workbench is locally active per project.
9. Switching Workbenches idles another without pausing global session.
10. Session can become dormant, paused, resumed, or closed.
11. Text software files use Yjs/CRDT concurrency.
12. External full-file saves become micro-granular CRDT operations.
13. Snapshot-anchored translation preserves concurrency with remote updates.
14. Filesystem is universal tool interface.
15. VS Code needs no plugin.
16. Claude/Codex/scripts/terminal can write normally.
17. Tree operations preserve stable file identity.
18. Rename + concurrent edit behaves correctly.
19. Binaries use versioned immutable content.
20. Binary conflicts preserve alternatives.
21. FSEvents is fast path, scanner/index is correctness.
22. No timer-based echo suppression.
23. Collaboration remains alive without renderer.
24. CRDT durable state does not depend on GitHub checkpoint cadence.
25. Exactly one AutoGit leader exists.
26. Leader uses fenced generation.
27. AutoGit checkpoints exact CRDT barriers.
28. AutoGit periodic push is fast-forward.
29. Another leader can safely continue after failure.
30. Join/resume can bootstrap from recent Git checkpoint plus CRDT catch-up.
31. Peers do not need `git pull` to receive file bytes already sent by CRDT.
32. Controlled GitHub sync replaces blind pull.
33. External Git branch changes are detected.
34. External push can be integrated.
35. Target/main divergence is tracked.
36. Rebase can be suggested.
37. Rebase never starts without explicit approval.
38. Rebase computes in isolated Git state.
39. Live users may keep editing while rebase computes.
40. Final B/R/L integration preserves post-barrier edits.
41. Rebase rewrite uses force-with-lease only.
42. Merge uses latest immutable checkpoint.
43. Protected branch behavior does not force.
44. Current Cozea agents/terminal/devserver/DevApps operate normally against Session Workspace.
45. Thread worktrees remain private until adoption.
46. Project presence remains separate from session membership.
47. Microphone/media does not gate file collaboration.
48. One canonical GitService owns product Git behavior.
49. Old renderer Yjs collaboration owner is gone from active path.
50. Old branch-equality collaboration activation is gone.
51. Signed packaged two-Mac acceptance passes.

---

# 37. Final architecture

The implementation should be explainable with this diagram:

```text
                           COZEA PROJECT
                                |
                         GitHub repository
                                |
                    +-----------+-----------+
                    |                       |
              target branch            session branch
                  main               feature/dashboard
                                            |
                                  Collaboration Session
                                            |
                                 durable encrypted CRDT
                                            |
                         +------------------+------------------+
                         |                  |                  |
                       Mac A              Mac B              Mac C
                         |                  |                  |
                  Session WB A       Session WB B       Session WB C
                  (local only)       (local only)       (local only)
                         |                  |                  |
                 session workspace  session workspace  session workspace
                         |                  |                  |
                 VS Code/Codex      Claude/terminal     DevApp/preview
                         \                  |                  /
                          \                 |                 /
                           +------- shared FILE state -------+
                                            |
                                          CRDT
                                            |
                                   AutoGit leader lease
                                            |
                               immutable barrier checkpoints
                                            |
                                          GitHub
```

Architectural sentence:

> A Cozea collaboration session is a persistent, resumable, branch-associated multiplayer software-project state. Each participant owns an independent local Session Workbench and local session workspace. Arbitrary applications interact through ordinary files. The background Cozea runtime translates text filesystem changes into CRDT operations, materializes converged CRDT state back to each filesystem, and handles binary project assets through versioned content. AutoGit elects one fenced participant device to periodically checkpoint immutable CRDT barriers into the session Git branch, assist join/resume, track the target branch, and perform explicitly approved rebase/merge operations. GitHub remains conventional durable repository history; the CRDT remains the live collaboration truth.

That sentence must remain true after every implementation phase.

---

# 38. Agent instruction block to paste into implementation threads

Use this verbatim when handing plan to coding agent:

```text
Read docs/collaboration/collaboration-autogit-master-plan.md completely before changing code.

Then read docs/collaboration/collaboration-autogit-status.md.

Do not infer product behavior from old collaboration code when it conflicts with the master plan.

Work on exactly the next incomplete phase.

Before editing:
1. resolve current origin/main;
2. inspect files named by the phase;
3. search for all current production owners of the responsibility;
4. state the phase objective and current owner map in the status ledger.

During implementation:
- do not add a second owner;
- do not skip tests;
- do not treat a scaffold/interface as completion;
- do not leave correctness in React;
- do not implement a code editor;
- do not remove CRDT semantics;
- do not make AutoGit commit live mutable disk;
- do not auto-rebase.

At each checkpoint:
1. run narrow tests;
2. run affected typechecks;
3. inspect git diff;
4. search for duplicate ownership;
5. update status ledger;
6. commit checkpoint.

Do not start next phase until current phase's exit gate is satisfied with production evidence.
```

