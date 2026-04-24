# Git Truth, Yjs Attribution, and Terminal Provenance Plan

Last reviewed: 2026-04-18

## Summary

Cozea should copy the right part of T3 Code and the right part of tmux, then add the missing collaboration layer that neither gives us out of the box.

The correct split is:

- Git is the source of truth for "what is dirty right now" for the current route's codebase.
- Yjs is the source of truth for collaborative attribution and replication.
- Git checkpoints are the source of truth for reviewable patches and turn-level history.
- The terminal runtime is the source of truth for process ownership and provenance.
- The filesystem watcher is the fallback truth for unmanaged local mutations.

This document is the implementation contract for that model.

It exists because Cozea is not just a local editor, not just a collaborative doc, and not just a tmux-like runtime. It is a hybrid:

- T3-style local diff review
- tmux-style durable terminal/process ownership
- Cozea-native multiplayer attribution and replication

The key product requirement is:

- the current route's change count must be accurate for all code changes in the local codebase before commit
- attribution must still explain who changed what
- terminal and CLI-agent edits inside Cozea must participate in collaboration rather than appearing as anonymous filesystem noise

## Implementation Status

Implemented in this pass:

- Electron-side `GitDirtyStateService` now owns header dirty-state snapshots and pushes updates to the renderer over IPC
- the header now subscribes to background dirty-state snapshots instead of polling Git directly from React
- Yjs update metadata now carries richer attribution fields such as actor, terminal, command, run, lane, and git root
- activity rows now persist that attribution metadata for review and audit surfaces
- the PTY runtime now emits terminal provenance events keyed by terminal identity and command boundaries
- the filesystem watcher now correlates external file mutations back to the most recent matching Cozea terminal when possible

Still intentionally future work:

- a true direct managed CLI-agent mutation bridge that writes into Yjs without filesystem fallback
- full binary durability and attribution beyond the current placeholder queue
- the final auto-GitHub flush barrier and preflight gate described later in this document

## Product Goal

For one focused project route at a time, Cozea must provide:

1. an accurate live `+X -Y` dirty count for the local repo state
2. a review surface that can explain which files changed and show exact patches
3. a collaborative attribution model that says who made which changes
4. a terminal/process model where switching UI focus does not kill work
5. a path for Cozea-managed CLI agents to feed edits into Yjs attribution rather than bypassing it
6. a safe preflight barrier for future automatic GitHub operations

## Non-goals

- Do not make Yjs the source of truth for live repo dirty state.
- Do not make the header depend on renderer-side Git polling forever.
- Do not parse terminal output to infer file edits.
- Do not require arbitrary third-party CLI tools to speak a Cozea-specific mutation protocol.
- Do not kill terminals, dev servers, or agent processes on route switch.
- Do not collapse multiple local roots into one mutable "active project path".

## The Core Decision

### Git is truth for live dirty state

The header count and any future auto-commit / auto-PR preflight must be based on the actual local Git working tree for the current route's `gitCwd`.

Reason:

- Git sees untracked files
- Git sees staged and unstaged state
- Git sees terminal edits, editor edits, agent edits, and external edits equally
- Git is the only source that can safely answer "what would be committed right now?"

### Yjs is truth for attribution and replication

Yjs should own:

- actor identity on text edits
- collaborative propagation
- remote ordering metadata
- checkpoint grouping metadata
- fine-grained provenance for managed edits

Reason:

- it already carries collaborative intent
- it is the only layer that can say "this change came from Pierre on device X" instead of "some bytes changed on disk"

### Checkpoints are truth for review history

Git checkpoints should remain the patch source for:

- Changes feed diff rendering
- turn-level and batch-level history
- commentable patch review
- range comparisons

Reason:

- local Git diffs are exact and cheap to read once captured
- T3-style patch review is better than storing entire before/after contents in Convex

### Terminal runtime is truth for process provenance

The PTY runtime should own:

- terminal identity
- command lifecycle
- shell cwd tracking
- agent-run identity
- process retention
- command-to-filesystem correlation windows

Reason:

- the terminal is where Cozea-managed CLI agents run
- if the terminal layer does not emit provenance, watcher-only attribution is too weak

## What To Copy From T3

T3's useful pattern is not "put a live dirty badge in the header." T3 does not actually do that.

The relevant lessons are:

- diff UI should be checkpoint-driven
- patch rendering should be loaded on demand
- file-level additions/deletions should be rendered from stored checkpoint metadata
- Git should remain local tooling, not the collaborative transport itself

What Cozea should copy:

- turn or batch checkpoints for patch review
- one-column review-friendly changes UI
- local Git patch generation

What Cozea must add that T3 does not need in the same way:

- multiplayer attribution
- remote writeback correctness
- current-route dirty truth independent from checkpoint timing
- terminal/CLI agent provenance

## What To Copy From tmux

tmux is useful here because it models the runtime correctly.

The important tmux lessons are:

- the server owns panes and processes
- clients attach and detach
- pane, session, and window IDs are stable identities
- control mode provides event-driven state, output, and subscriptions
- hooks fire on lifecycle events such as pane exit and session change

From official tmux documentation:

- control mode sends asynchronous `%output` notifications per pane and event notifications for session/window/pane lifecycle
- control mode supports flow control and format subscriptions
- hooks exist for events such as `pane-exited`, `client-session-changed`, and other lifecycle transitions
- tmux exposes stable identifiers and format fields such as `pane_id`, `pane_pid`, `pane_current_path`, and `pane_current_command`

What tmux does **not** give us:

- semantic file-edit detection
- authorship of changed files
- a direct "this pane wrote `src/foo.ts`" signal

That means Cozea should adopt tmux's event-driven runtime ownership model, but not pretend tmux solves attribution by itself.

## Current Repo State

The current codebase already contains part of the target shape.

### What already exists

- the current header badge reads Git diff stats for the active route in `src/components/layouts/unified-header/HeaderProjectChangesButton.tsx`
- those stats are computed from a synthetic Git snapshot in `electron/gitCheckpoints.ts`
- local Yjs persistence logs lightweight activity and captures a checkpoint batch in `src/lib/yjs/ProjectFilesPersistence.ts`
- outbound Yjs metadata already includes a `checkpointGroupId` in `src/lib/yjs/CollabWsProvider.ts`
- remote writeback already captures a matching checkpoint using the same group id in `src/hooks/useYjsFileWriteback.ts`
- external file changes already flow back into Yjs through the project watcher and `useAgentFileSync`
- PTYs already live in a dedicated child runtime via:
  - `electron/services/TerminalService.ts`
  - `electron/services/WorkbenchRuntimeClient.ts`
  - `electron/workbench-runtime/child.ts`
- workspaces already have runtime hosts independent from the visible route in `src/features/projects/workspaces/WorkspaceRuntimeHosts.tsx`

### What is still missing

- the header still triggers renderer-side polling instead of subscribing to a background dirty-state service
- live Git truth and Yjs attribution are still mixed together conceptually
- terminal edits are routed back into Yjs only after filesystem observation, not with strong provenance
- Cozea-managed CLI agents do not yet have a direct "apply through Yjs" bridge
- manual terminal edits are not strongly attributable to a specific terminal or command
- binary sync is still only a placeholder queue, not a real attributed durability path
- future GitHub automation does not yet have a full flush barrier

## The Architectural Split

The product should be built around four layers.

### Layer 1: `GitDirtyStateService`

Purpose:

- answer "what is dirty right now in this repo?"

Key:

- one service instance per `gitCwd`

Ownership:

- Electron main

Consumers:

- current route header
- changes page summary
- future auto-commit / auto-PR preflight

Contract:

- receives invalidation events from the workspace runtime
- debounces recomputation
- recomputes exact dirty stats from Git
- caches the latest result per `gitCwd`
- pushes snapshots to the renderer on subscription

### Layer 2: `AttributionGraph`

Purpose:

- answer "who changed what?"

Key:

- one graph per workspace document scope

Ownership:

- Yjs metadata plus lightweight persisted activity rows

Consumers:

- changes feed
- patch headers
- blame chips / author labels
- audit surfaces

Contract:

- every managed text change carries actor metadata
- batches carry `checkpointGroupId`
- remote replicas preserve actor and batch identity
- local activity rows record attribution summaries, not full diff content

### Layer 3: `CheckpointReviewState`

Purpose:

- answer "what patch should we show for this batch or turn?"

Key:

- one checkpoint namespace per workspace `gitCwd`

Ownership:

- local Git refs

Consumers:

- changes page patch expansion
- future thread or range diff surfaces

Contract:

- checkpoints are captured after a durable change batch
- patch rendering is local and on demand
- comments and review rows reference checkpoint groups, not stored file blobs

### Layer 4: `TerminalProvenanceService`

Purpose:

- answer "which terminal or agent run most likely caused this local mutation?"

Key:

- one terminal identity per PTY
- one command identity per executed command
- one agent-run identity per Cozea-managed agent invocation

Ownership:

- PTY child runtime plus shell integration events

Consumers:

- watcher-to-actor correlation
- activity feed attribution
- Yjs origin enrichment
- future run history UI

Contract:

- the service tracks terminal lifecycle, cwd, shell identity, active command windows, and managed agent runs
- it does not pretend to know exact file writes without supporting evidence
- it upgrades attribution from `external/unknown` to stronger labels when evidence is present

## The Data Model

The core distinction is:

- dirty truth is repo-level
- attribution is change-level

### Dirty snapshot

```ts
interface GitDirtySnapshot {
  gitCwd: string
  headOid: string | null
  dirty: boolean
  additions: number
  deletions: number
  changedFiles: number
  untrackedFiles: number
  recomputedAt: number
  pendingBarrier: boolean
}
```

### Actor identity

```ts
interface ChangeActor {
  actorType:
    | "user"
    | "agent"
    | "terminal-human"
    | "terminal-agent"
    | "remote-user"
    | "remote-agent"
    | "external"
    | "unknown"
  actorId: string
  userId?: string | null
  userName?: string | null
  deviceId?: string | null
  terminalId?: string | null
  runId?: string | null
}
```

### Provenance envelope

```ts
interface ChangeProvenance {
  workspaceId: string
  projectId: string
  documentScopeId: string
  gitCwd: string | null
  checkpointGroupId: string | null
  source:
    | "yjs-local"
    | "yjs-remote"
    | "terminal-managed"
    | "terminal-observed"
    | "watcher-external"
    | "binary"
    | "unknown"
  commandId?: string | null
  commandText?: string | null
  commandCwd?: string | null
  terminalId?: string | null
  processRootPid?: number | null
  observedAt: number
}
```

## Git Dirty Truth Architecture

### The rule

The current route header should show the focused workspace's latest `GitDirtySnapshot`, not run Git itself on an interval from React forever.

### Service shape

Introduce:

- `electron/services/GitDirtyStateService.ts`

Responsibilities:

- subscribe by `gitCwd`
- maintain a cached `GitDirtySnapshot`
- coalesce invalidations
- emit updates over IPC

### Recompute strategy

The service should use a two-tier strategy.

#### Tier 1: cheap dirtiness detection

Use cheap Git probes to answer:

- is the repo dirty?
- did `HEAD` move?
- are there untracked files?

Examples:

- `git status --porcelain=v1 -z --untracked-files=all`
- `git rev-parse --verify HEAD`

#### Tier 2: exact summary computation

When dirtiness changes or an invalidation burst settles, compute exact additions/deletions using the current synthetic snapshot approach already implemented in `electron/gitCheckpoints.ts`.

Reason:

- the synthetic snapshot includes staged, unstaged, and untracked files in one exact comparison
- it is slower than status, so it should be run as a debounced background recompute instead of direct UI polling

### Invalidation sources

The service should mark a `gitCwd` dirty-to-recompute on:

- local Yjs persistence batch completion
- remote writeback completion
- project watcher external change events
- binary file sync completion
- terminal command completion
- terminal process exit
- explicit Git commands run inside Cozea
- branch checkout / worktree switch
- checkpoint capture completion

### UI contract

The renderer only needs:

- `useGitDirtySnapshot(gitCwd)`

The header should:

- subscribe on mount
- render the cached snapshot
- unsubscribe on route change

Only the focused route consumes the snapshot visually, but the service may stay warm for other live workspaces.

## Yjs Attribution Architecture

### The rule

Yjs should carry enough metadata that any replicated text edit can be attributed to a person, device, terminal, or managed agent run.

### Extend outbound metadata

Current outbound metadata already includes `checkpointGroupId`.

Extend it to include:

```ts
interface YjsOutboundMetadata {
  projectId: string
  roomId: string
  clientId: string
  checkpointGroupId: string | null
  actorType: "user" | "agent" | "terminal-human" | "terminal-agent"
  actorId: string
  userId?: string | null
  userName?: string | null
  terminalId?: string | null
  commandId?: string | null
  runId?: string | null
  origin: string
  timestamp: number
}
```

### Local text-edit sources

There are four distinct local text-edit sources.

#### 1. Editor-originated user edits

These are strong-attribution edits.

Attribution:

- `actorType = "user"`
- actor comes from the local authenticated user and device

#### 2. Cozea-managed CLI agent edits through the bridge

These are the strongest terminal-agent edits.

Attribution:

- `actorType = "terminal-agent"`
- actor includes `terminalId`, `commandId`, `runId`, and agent identity

#### 3. Terminal-observed edits from unmanaged shell tools

These are best-effort edits.

Attribution:

- `actorType = "terminal-human"` or `terminal-agent` when a managed run is active
- provenance is based on command window correlation, cwd, and timing

#### 4. External non-Cozea edits

These remain fallback attribution.

Attribution:

- `actorType = "external"` or `unknown`

### Persisted activity rows

Convex activity should remain lightweight, but it should store richer attribution fields than today.

Add fields such as:

- `actorType`
- `actorId`
- `terminalId`
- `runId`
- `commandId`
- `deviceId`
- `attributionConfidence`

The point is not to duplicate Yjs internals in Convex. The point is to persist enough shared metadata for feed and comment headers.

### Confidence model

Every activity row should have a confidence level:

- `strong`
- `probable`
- `fallback`

Examples:

- editor Yjs mutation with authenticated user metadata: `strong`
- managed CLI agent bridge mutation: `strong`
- watcher event correlated to active terminal command in same cwd and time window: `probable`
- external watcher event with no runtime correlation: `fallback`

## Terminal Provenance Architecture

### The rule

We should not parse terminal text output and guess file writes from strings such as `vim src/foo.ts`.

Instead:

- terminal output is for display
- shell integration is for command lifecycle
- watcher events are for actual filesystem mutation
- provenance comes from correlating runtime events with observed mutations

### Why tmux matters here

tmux proves the value of:

- stable pane identity
- event-driven lifecycle
- output streaming
- subscriptions
- hooks

tmux does **not** provide "file X was edited by pane Y" directly.

That means Cozea should be tmux-like in process ownership and eventing, but must add its own provenance layer above the PTY.

### Terminal identity

Every Cozea terminal already has a stable terminal id. That identity should be the equivalent of tmux's pane id for provenance.

Required fields:

- `terminalId`
- `workspaceId`
- `projectPath`
- `gitCwd`
- `createdAt`
- `shell`
- `initialCwd`
- `managedByCozea`

### Command identity

Introduce:

```ts
interface TerminalCommandState {
  commandId: string
  terminalId: string
  startedAt: number
  completedAt?: number | null
  cwd: string | null
  commandText: string | null
  exitCode?: number | null
  managedAgentRunId?: string | null
}
```

### Shell integration

Add shell integration scripts for shells launched by Cozea:

- zsh
- bash
- fish

Responsibilities:

- emit `prompt-ready`
- emit `cwd-changed`
- emit `command-start`
- emit `command-end`
- expose stable env vars

Cozea env vars should include:

- `COZEA_WORKSPACE_ID`
- `COZEA_TERMINAL_ID`
- `COZEA_PROJECT_ID`
- `COZEA_GIT_CWD`
- `COZEA_COMMAND_BRIDGE`
- `COZEA_MANAGED_AGENT_RUN_ID` when applicable

This is our equivalent of tmux's `TMUX_PANE`, but scoped to Cozea.

### Event transport

Shell integration should send events to the runtime over a local IPC bridge owned by the PTY runtime child.

Options:

- stdio side channel
- local Unix domain socket / named pipe
- OSC escape sequence channel

Preferred direction:

- local socket or named pipe owned by the runtime child

Reason:

- explicit JSON events are easier to parse and test than scraping terminal output

### Provenance correlation

When `projectWatcher` reports a local file mutation, the `TerminalProvenanceService` should attempt correlation in this order:

1. active managed agent run with direct bridge evidence
2. terminal command with matching cwd and live command window
3. most recent terminal command in same workspace within a short mutation window
4. fallback to `external`

Correlation inputs:

- `terminalId`
- `commandId`
- command start/end times
- shell cwd
- workspace root
- git root
- mutation timestamp
- path relative to cwd or workspace

### Important limitation

Even with shell integration, arbitrary programs started from a shell can still mutate files without telling us semantically what they intended.

That is acceptable.

The goal is:

- exact Git truth
- strong attribution for managed paths
- good best-effort attribution for terminal work

The goal is not impossible omniscience.

## Routing Terminal and CLI Agent Edits Through Yjs

There are two supported paths.

### Path A: managed Cozea CLI agent mode

This is the ideal path for CLI agents launched from inside Cozea.

#### Contract

Cozea launches the agent with:

- terminal identity
- workspace identity
- authenticated actor identity
- command bridge endpoint
- optional mutation bridge endpoint

The managed agent may then emit explicit mutation operations such as:

```ts
interface ManagedAgentMutation {
  runId: string
  terminalId: string
  commandId: string
  path: string
  kind: "upsert" | "delete" | "rename"
  content?: string
  previousPath?: string
  encoding?: "utf-8"
}
```

#### Runtime behavior

For managed agent mutations:

1. runtime validates workspace ownership
2. runtime applies the change to Yjs first with strong provenance
3. local writeback materializes to disk
4. normal checkpoint capture and activity logging follow
5. replicas receive the mutation via Yjs with full actor metadata

This gives us:

- strong attribution
- one collaborative source of truth
- low latency replication
- no need to wait for the filesystem watcher to rediscover what we already know

#### Why this matters

This is the only realistic way to make CLI-agent edits feel as first-class as editor edits.

### Path B: unmanaged terminal tool fallback

This is the compatibility path for:

- human shell usage
- Vim/Neovim
- sed/perl/awk scripts
- arbitrary third-party CLI agents

#### Runtime behavior

1. tool writes to disk normally
2. `projectWatcher` observes the mutation
3. `useAgentFileSync` or its workspace-owned replacement applies the change to Yjs
4. provenance service correlates the mutation back to the best matching terminal command
5. activity and checkpoints are logged with `probable` or `fallback` confidence

This path is less exact than managed agent mode, but it still routes terminal edits into Yjs for collaboration.

### Decision

Cozea should support both paths:

- managed agent mode for strong attribution
- unmanaged watcher-capture mode for compatibility

## Filesystem Watcher Role

The watcher remains essential even after adding stronger provenance.

Reason:

- it is the only universal observation point for unmanaged tools
- it validates that a disk mutation really happened
- it closes the loop for tools that bypass any explicit bridge

But the watcher should no longer be the entire attribution system.

The watcher should become:

- mutation detector
- fallback ingestion path
- provenance consumer

not:

- the sole owner of actor identity

## Checkpoints and Review State

### The rule

Checkpoints are batch review state, not live dirty truth.

### Capture points

Capture checkpoints on:

- local Yjs persistence batch completion
- remote writeback batch completion
- managed agent mutation batch completion
- optional explicit command barrier completion for terminal command groups

### Batch grouping

Keep `checkpointGroupId` as the logical batch key.

For managed terminal commands, tie batches to:

- `terminalId`
- `commandId`
- `runId`

This lets the changes feed say:

- Pierre
- Agent run `codex-cli-42`
- 8:31 PM
- `+21 -7`

and still open the exact Git patch locally.

## Binary Files

Binary files are outside Yjs text CRDT semantics.

Decision:

- Git truth still counts them as dirty
- checkpoints still include them as patchable Git state where applicable
- attribution uses watcher/provenance metadata
- collaboration for binary durability remains a separate path

Important current-state note:

- `src/lib/sync/BinaryFileSync.ts` is still a placeholder queue

That means binary attribution should be specified in this architecture, but production correctness depends on finishing binary durability later.

## Auto-GitHub Operations Barrier

Future automatic commit / PR / push operations must never run directly off stale UI state.

Introduce a workspace-scoped flush barrier:

```ts
interface WorkspaceFlushBarrierResult {
  workspaceId: string
  gitCwd: string
  yjsOutboundFlushed: boolean
  yjsInboundApplied: boolean
  remoteWritebackDrained: boolean
  watcherQueueDrained: boolean
  binaryQueueDrained: boolean
  dirtySnapshot: GitDirtySnapshot
  completedAt: number
}
```

### Barrier sequence

Before auto GitHub operations:

1. stop accepting a new automated action for the workspace
2. flush pending outbound Yjs updates
3. wait for inbound updates to apply
4. wait for remote writeback timers to settle
5. wait for watcher debounce queues to drain
6. wait for managed agent mutation queue to drain
7. wait for binary queue to settle or explicitly mark it excluded
8. recompute `GitDirtySnapshot`
9. only then run Git automation

This is mandatory.

Without it, attribution and diff truth can diverge at exactly the moment automation matters most.

## Multi-project and Current-route Behavior

The user asked for one current route at a time for the header, but eventual multi-project multitasking everywhere else.

The correct behavior is:

- every workspace may have its own dirty-state service and provenance state
- only the focused route renders the header badge
- switching routes swaps the subscribed `workspaceId` and `gitCwd`
- background workspaces continue syncing and capturing checkpoints if they are live

This is consistent with the runtime ownership model already described in `docs/tmux-inspired-runtime-architecture.md`.

## Implementation Phases

### Phase 1: background Git truth service

Ship:

- `GitDirtyStateService` in Electron main
- IPC subscribe/unsubscribe for dirty snapshots
- renderer hook to replace direct header polling

Do not change:

- current synthetic diff algorithm

Success criteria:

- header is still exact
- Git work moves out of React

### Phase 2: richer attribution metadata

Ship:

- expanded Yjs outbound metadata
- richer remote origin parsing
- activity row attribution fields
- confidence levels

Success criteria:

- remote and local text edits show actor identity more precisely than today

### Phase 3: terminal provenance service

Ship:

- shell integration
- command lifecycle tracking
- terminal-to-command-to-mutation correlation
- watcher enrichment with `terminalId` and `commandId`

Success criteria:

- terminal edits stop appearing as generic external changes in the common case

### Phase 4: managed CLI agent bridge

Ship:

- managed agent run identity
- direct mutation bridge
- Yjs-first apply path for managed CLI agents

Success criteria:

- Cozea-launched CLI agents can mutate files with strong attribution and low-latency collaboration

### Phase 5: automation barrier

Ship:

- workspace flush barrier
- GitHub automation preflight checks

Success criteria:

- future auto GitHub flows operate on settled repo truth

## Validation Checklist

1. Edit a file in the editor and confirm:
   - Git dirty snapshot updates
   - Yjs metadata preserves actor identity
   - activity feed shows strong attribution
2. Edit a file from another collaborator and confirm:
   - remote writeback updates local disk
   - checkpoint batch matches across peers
   - attribution remains correct
3. Edit a file from a Cozea terminal using a normal shell command and confirm:
   - watcher routes it back into Yjs
   - attribution resolves to the terminal or falls back explicitly
4. Edit a file from a Cozea-managed CLI agent and confirm:
   - mutation enters Yjs directly
   - attribution is strong
   - remote peers receive the change without waiting on watcher fallback
5. Create untracked files and confirm:
   - header Git count includes them
6. Switch away from the project route and confirm:
   - terminal lives
   - sync continues
   - returning shows correct dirty state
7. Run the future flush barrier and confirm:
   - no pending writeback remains
   - Git snapshot matches the eventual commit payload

## Open Questions

1. How much shell integration do we want to support in the first pass?

Initial recommendation:

- zsh
- bash
- fish

2. Should managed CLI agents be required to use a direct mutation bridge?

Recommendation:

- no for compatibility
- yes for strong attribution and first-class UX

3. Should the dirty-state service compute exact `+/-` for every invalidation or only after burst-settle?

Recommendation:

- exact recompute after burst-settle
- cheap dirty flag immediately

4. Should fallback attribution ever claim a user identity it cannot prove?

Recommendation:

- no
- use explicit confidence labels instead

## Sources

### Official tmux sources

- tmux Control Mode wiki: https://github.com/tmux/tmux/wiki/Control-Mode
- tmux Formats wiki: https://github.com/tmux/tmux/wiki/Formats
- tmux Advanced Use wiki: https://github.com/tmux/tmux/wiki/Advanced-Use
- tmux manual page, hooks and formats: https://man.openbsd.org/tmux.1

### T3 Code source references

- header implementation: https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/chat/ChatHeader.tsx
- diff panel implementation: https://github.com/pingdotgg/t3code/blob/main/apps/web/src/components/DiffPanel.tsx
- checkpoint contract: https://github.com/pingdotgg/t3code/blob/main/packages/contracts/src/orchestration.ts

### Current repo anchors

- `src/components/layouts/unified-header/HeaderProjectChangesButton.tsx`
- `electron/gitCheckpoints.ts`
- `src/lib/yjs/ProjectFilesPersistence.ts`
- `src/lib/yjs/CollabWsProvider.ts`
- `src/hooks/useYjsFileWriteback.ts`
- `src/hooks/useAgentFileSync.ts`
- `electron/projectWatcher.ts`
- `electron/services/TerminalService.ts`
- `electron/services/WorkbenchRuntimeClient.ts`
- `electron/workbench-runtime/child.ts`
- `src/features/projects/workspaces/WorkspaceRuntimeHosts.tsx`
- `docs/tmux-inspired-runtime-architecture.md`
- `implementation_plan.md`
