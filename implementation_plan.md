# Hybrid T3-Style Collaborative Changes System

This document now reflects the implementation that landed in the Electron app. The goal was to replace the old heavy “store full before/after file contents in Convex” approach with a T3-style local Git checkpoint system, while still preserving a multiplayer-safe event timeline and comments layer.

## What Shipped

### 1. Electron local checkpoint engine

`electron/gitCheckpoints.ts` is now the source of truth for diff generation and change stats.

Implemented capabilities:
- `captureCheckpoint(cwd, checkpointId, authorName, authorEmail?)`
- `diffCheckpoints({ cwd, fromCheckpointId?, toCheckpointId, filePath? })`
- `readCheckpointFilePair({ cwd, fromCheckpointId?, toCheckpointId, filePath })`
- `deleteCheckpointRefs({ cwd, checkpointIds })`
- `deleteAllCheckpointRefs(cwd)`
- `getHeadDiffStats(cwd, authorName?)`

Key behavior:
- Checkpoints are synthetic commits created from an isolated temporary Git index.
- Refs are stored under `refs/cozea/checkpoints/<checkpointGroupId>`.
- Diff rendering is local, fast, and exact.
- Header stats are derived from a synthetic workspace snapshot vs `HEAD`, so untracked files are included.

The checkpoint APIs are exposed through:
- `electron/ipc/registerSyncHandlers.ts`
- `electron/preload.ts`
- `shared/electronApiTypes.ts`
- `src/features/projects/lib/projectOpenDesktopClient.ts`

### 2. Convex activity became a lightweight timeline

The `fileChanges` table is no longer treated as the diff source. It now acts as a shared event feed that carries:
- who changed something
- when it happened
- which file changed
- what kind of change it was
- lightweight line stats
- `checkpointGroupId` to link the event back to the local Git checkpoint range

Implemented changes:
- `convex/schema.ts` adds `checkpointGroupId`
- `convex/activity.ts` accepts and returns `checkpointGroupId`
- `convex/activity.ts` includes `clearEphemeralChanges(projectId)`

Current state:
- `oldContent` and `newContent` are still present in the schema for compatibility
- new writes from the Yjs persistence path no longer rely on them for diff rendering

### 3. Remote replication now carries checkpoint identity

The main collaboration problem was not just rendering local diffs, but making remote edits appear as the same logical checkpoint batch on every machine.

That is now handled by:
- `src/lib/yjs/checkpointGroups.ts`
- `src/lib/yjs/origins.ts`
- `src/lib/yjs/CollabWsProvider.ts`
- `src/lib/yjs/YConvexProvider.ts`
- `src/hooks/useYjsFileWriteback.ts`

How it works:
1. A local edit batch is assigned a `checkpointGroupId`.
2. That ID is embedded into the outbound encrypted Yjs metadata.
3. Receiving clients apply the update with a structured remote origin carrying the same `checkpointGroupId`.
4. Remote writeback materializes the file change on disk.
5. The receiving client captures a local Git checkpoint using that same `checkpointGroupId`.

Result:
- all peers can render the same logical change from their own local Git refs
- the Convex timeline stays lightweight
- comments still attach to shared `fileChanges` rows

### 4. Project file persistence now logs events, not full diffs

`src/lib/yjs/ProjectFilesPersistence.ts` was refactored so each local debounce batch:
- resolves a shared `checkpointGroupId`
- logs lightweight file change rows to Convex
- captures one local Git checkpoint for the batch

Remote-origin changes are excluded from re-logging, which prevents activity duplication and feedback loops.

### 5. The changes UI is now a one-column T3-style feed

`src/features/projects/pages/ChangesPage.tsx` was replaced with a single-column inline experience.

The new page:
- uses Convex only for timeline rows and comments
- expands each change inline instead of using the old split diff panel
- shows author and timestamp in the card header
- loads the actual patch from local checkpoint refs
- renders the patch via Pierre diffs

New rendering pieces:
- `src/features/projects/components/changes/CheckpointDiffWorkerProvider.tsx`
- `src/features/projects/components/changes/CheckpointPatchView.tsx`

The visual model is now intentionally much closer to T3 Code than the previous heavy inspector layout.

### 6. Header stats are local Git-backed, and commit cleanup is automatic

`src/components/layouts/unified-header/HeaderProjectChangesButton.tsx` now:
- polls local Git diff stats for `+X -Y`
- polls local git status alongside those stats
- detects the repo transitioning from dirty to clean with a new `HEAD`
- clears Convex ephemeral change rows on that transition
- deletes all local checkpoint refs on that transition

This matches the desired behavior for manual commits:
- edits stay visible and commentable while they are uncommitted
- once a real commit lands, the temporary review feed is cleared

## Current Architecture

In short:
- Convex stores the shared social layer
- local Git stores the actual diff snapshots
- Yjs transport metadata keeps checkpoint identity stable across collaborators
- the UI renders a one-column feed of lightweight shared events backed by local patches

## Remaining Follow-Up

The core migration is done, but a few cleanup tasks remain:

1. Remove old compatibility paths that still assume DB-backed diff content.
   Examples: `getChangeWithContent`, the old diff panel components, and any stale query-cache prewarm behavior tied to selected change content.

2. Fully slim the Convex schema if we want to permanently drop legacy content fields.
   Right now the runtime has stopped depending on them, but the schema still carries them for compatibility.

3. Decide whether checkpoint cleanup should also be triggered from any future non-header commit surfaces.
   The current automatic cleanup works for the existing manual commit flow while the app is open, which matches the current product expectation.

## Verification Checklist

1. Edit files locally and confirm new activity rows appear in the one-column Changes feed.
2. Expand a row and confirm the patch is rendered from local checkpoint refs, not Convex file content.
3. Make edits from another collaborator and confirm remote writeback captures a matching local checkpoint.
4. Confirm the header shows local `+X -Y` numbers from Git, including untracked files.
5. Create a real commit and confirm:
   - the repo becomes clean
   - Convex ephemeral changes are cleared
   - local checkpoint refs are deleted
