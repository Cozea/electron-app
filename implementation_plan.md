# Hybrid T3-Style Collaborative Changes System

This plan adapts the T3 local-git-plumbing system to a multiplayer context. We will gut the heavy payload of our Convex `fileChanges` table, relying purely on the local Git `electron` engine for rapid diff computation and stats. However, we will preserve a lightweight event log in Convex to sync *who* made changes and safely anchor collaborative `changeComments`. 

This ensures everyone on the Collab branch shares the identical changes history and can comment on it, but the heavy lifting of diffing is purely local and perfectly accurate. Finally, we will clear this ephemeral history explicitly whenever a real commit occurs.

## Proposed Changes

---

### Electron Backend (Local Diffing Engine)

#### [NEW] `electron/gitCheckpoints.ts`
Implement the core Checkpointing engine using `git` primitives:
- `captureCheckpoint(cwd, eventId, author)`: Creates an isolated `GIT_INDEX_FILE`, stages dirty work, generates a tree and commit with the author's metadata, and saves it under `refs/cozea/checkpoints/<eventId>`.
- `diffCheckpoints(cwd, fromRef, toRef)`: Executes a fast local `git diff --patch --minimal` to pull diff contents.
- `getHeadDiffStats(cwd)`: Runs `git diff HEAD --shortstat` to supply the header numbers (e.g., `+14 -2`).

#### [MODIFY] `electron/main.ts` & `shared/electronApiTypes.ts`
- Bind the new engine logic to standard IPC invoke channels so the React frontend can request diff renders securely.

---

### Convex Backend (Lightweight Collab Sync)

#### [MODIFY] `convex/schema.ts`
- **Modify `fileChanges`**: Strip out `oldContent`, `newContent`, `additions`, `deletions`, and `totalLines`. These were massively bloating the DB. This table now serves *strictly* as a lightweight "Event/Timeline" tracker (who changed what file, and when).
- **Keep `changeComments`**: These remain completely intact, joined to the `fileChanges` ID, ensuring multiplayer code review continues to work.

#### [MODIFY] `convex/activity.ts`
- **Update `logFileChange`**: Remove content storage logic.
- **[NEW] `clearEphemeralChanges`**: A new mutation that drops all `fileChanges` and `changeComments` for a project. We will call this the moment a user successfully runs `GitSyncCommit`, ensuring the history only survives until the next commit (exactly matching T3's behavior).

---

### React Frontend (UI & Triggers)

#### [MODIFY] `src/lib/yjs/ProjectFilesPersistence.ts`
- When a file is modified (via human or agent), trigger *both*:
  1. `api.activity.logFileChange` (to sync the "Who/When" event globally).
  2. An IPC call to `git:captureCheckpoint` to snapshot the exact local edit.
- Crucially, when remote Yjs updates arrive from a teammate, we *also* trigger a local `git:captureCheckpoint` on the receiving machine tied to the same event ID, so their local `.git` perfectly mirrors the remote history for immediate diff panel rendering.

#### [MODIFY] `src/components/layouts/unified-header/HeaderProjectChangesButton.tsx`
- Replace Convex query logic with a rapid poll interval against the IPC `git:getHeadDiffStats` call, granting absolute 0-latency header numbers.

#### [MODIFY] `src/features/projects/pages/ChangesPage.tsx`
- The Changes UI will still list events from Convex's lightweight `fileChanges` (to get the comments and correct multiplayer timeline context), but the heavy lifting of the *actual file contents* requested by `<DiffPanel />` will be fulfilled directly by our IPC `git:diffCheckpoints` call. 

## Verification Plan
1. Ensure the header UI correctly reflects `+X -Y` via local Git IPC.
2. Ensure when an AI or teammate types, `fileChanges` correctly registers a lightweight event, comments can be attached, and the local `.git` engine renders the diff.
3. Verify that running an actual Git Commit flawlessly purges the ephemeral `fileChanges` and `changeComments` to reset the slate.
