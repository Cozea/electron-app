# Project-scoped agent chat history

Agent headers expose a 28px **Chat history** action before Artifacts. It uses the existing desktop context menu, not an application overlay. The menu is scoped to the Cozea project and the tile's provider kind; multiple configured instances of that provider remain distinct. Opening history never starts a turn.

## User flow

The menu contains **New chat**, up to 20 recent conversations/nonempty drafts, and **Older conversations…** / **Newer conversations…** navigation. Entries include date/status, distinguishing provider-instance labels, and originating branch/worktree information. The current conversation is checked. Completed conversations remain listed; explicitly archived/deleted ones do not. Empty untouched drafts are not history entries.

The menu refreshes the runtime's shell index and validates local project membership. A refresh failure is identified with a retry command; it is never presented as an empty history. The trigger is a keyboard-accessible button, stops pointer propagation into Dockview drag handling, and restores focus on cancellation.

Selection revalidates membership after the native menu closes, then waits for committed draft storage. An already-open conversation is focused, including an existing owning workbench via the established navigation-intent mechanism. Otherwise an idle tile is reused. A running/sending/binding thread, pending approval/input, checkpoint operation, metadata operation, or memory operation causes an activated sibling tab in the source Dockview group instead. The original controller/subscription is not interrupted.

**New chat** follows the same placement policy and retains model/provider-instance/mode preferences. It allocates a fresh opaque draft identity; the runtime conversation is created only on the first valid send. A missing bound conversation produces an unavailable/retry state, not a replacement conversation.

## Identity and execution safety

`features/assistant/history/assistantHistoryStore.ts` persists a version-1 localStorage association store at `cozea:assistant-history-associations:v1`. Associations record Cozea project, runtime project, workspace, lane, original root/branch, and optional provider-kind identity. No transcript, credentials, native resume payload, or runtime title is copied there.

The runtime remains authoritative for the conversation index, transcript, lifecycle, provider instance, model and native resume information. Pending unsent composer preferences supplement the runtime selection when reopening a draft. The current T3 client's `getSnapshot()` reads `subscribeShell`, not every conversation's detail stream; only the opened tile subscribes to its transcript. Shell pending-approval/input flags remain effective even before detail hydration.

Backfill requires an exact runtime-project root match against catalog-known Cozea workspace roots. Conflicting project matches remain unassigned. Validated tile bindings refine workspace/lane origins, and exact worktree roots resolve their own workspace identity. Names, Git remotes, and directory-prefix relationships are never membership evidence. Unknown historical lane information is left unset rather than copied from an unrelated current lane.

Project names are not keys, so renaming a project does not sever history. Relocation retains the original association and makes it read-only until its execution context is resolved. Before sending or acting on a thread operation, the controller resolves the workspace root and checks the current branch against the saved origin. It does not check out branches or relocate files. A conversation opened in another checkout can still show its available transcript, but cannot run there. Resolve the original folder/branch using existing workbench controls. Missing/disabled provider instances likewise do not silently fall back to another account.

## Durable drafts

`assistantDraftRepository.ts` owns IndexedDB database `cozea-assistant-drafts`, version 1, object store `drafts`, plus a reactive in-memory cache. Identities are `draft:<opaque draftId>` before binding and `thread:<runtime threadId>` afterward. Tile IDs are used only to adopt pre-existing legacy preferences/default draft identities.

Records contain text, cursor, image Blobs/metadata, annotation content, model selection, modes, context, timestamp and a content revision. Existing attachment limits still apply. Browser/terminal execution handles are not persisted as live capabilities: annotation content is descriptive and restored annotations never auto-submit or execute. No dependency was added for storage.

Every edit queues persistence. History replacement waits for the transaction's **completion**, not individual IndexedDB request success. Preview object URLs are recreated from stored bytes in an effect and revoked with that effect's lifecycle, including StrictMode replay; no blob URL is persisted. Unsent images remain local until an explicit send.

On successful conversation creation the draft is adopted under the acknowledged runtime identity. Pending edits from the old mounted draft controller are redirected to that identity. The tile remains bound even if the adoption's disk commit fails, preventing another runtime conversation on retry. Adoption writes and old-key deletion are retried atomically.

A send captures the content revision **before** asynchronous validation/upload/setup. An acknowledgment clears only that revision; newer text/images/annotations remain. Cursor and preference changes do not advance the content revision. Failed or uncertain submissions remain saved and are never automatically resent. If sending succeeds but clearing its saved draft fails, the UI explicitly says the message was sent and must not be resent.

Storage failures retain in-memory edits, show an error, and block history replacement until a successful flush. Closing a tile does not delete its record. Drafts can be recovered through a fresh same-provider tile after closing the original tile and restarting Cozea.

Storage is local to this Electron profile/device. It is not a cloud backup or an additional encrypted vault. Clearing the application profile/IndexedDB removes these local drafts; the association index is also localStorage-backed. This feature neither imports native-app history nor synchronizes drafts across devices.

## Cleanup and controller lifetimes

Explicit thread deletion removes its persisted content/Blobs, composer preferences, and conversation association. Existing project-deletion cleanup includes independently associated runtime projects and closed-tile drafts/preferences; other projects' data is retained. Ordinary tile closure and project archival do not invoke deletion cleanup.

The content controller is keyed by the draft identity, which stays stable on first-send binding. Intentional history switching replaces that identity and resets optimistic messages, errors, input answers and artifact selection. Ordinary text wrapping, shrinking and Chat/Artifacts toggling retain the editor/controller. The shared Dockview header registry returns its subscribed registration directly so React Compiler cannot memoize an unrelated map read and hide registered actions.

## Verification

Automated coverage is under `tests/assistant/history/` and `tests/projects/projectLocalCleanup.test.ts`: project/provider isolation, exact-root/ambiguous/worktree backfill, deterministic ordering and pagination, placement decisions, wire provider instances, durable content/Blob restart restoration, adoption and adoption failure, revision-safe acknowledgment, uncertain sends, quota failures, late callbacks after deletion, cleanup, and controller integration guards.

Live Electron QA on the Phase Eight Flow Test project verified native menu rendering and same-provider filtering, saved transcript opening without a turn, independent new drafts, text/image switching, closing the original draft tile, full process restart, and recovery of that draft with a successfully decoded 72×72 image. A harmless Codex response was started for the streaming test: selecting a saved draft opened an active sibling tab while the original response remained running. The original later completed, and reopening it focused the existing tab without adding a third tile. Both single and grouped headers were exercised. Space opened the native menu; Escape returned DOM focus to Chat history. Chat → Artifacts → Chat retained text and the image. The history and artifact controls had matching bounds at the user's display scale. Screenshot evidence is kept outside source control in the task's temporary QA directory.

Remaining live acceptance: a real pending-approval transition, alternate provider instances, cross-workspace navigation, and in-progress header-drag variants. These are covered partly by automated policy/integration checks, not represented as fully exercised live. Native-menu automation intermittently lost its active-window reference; successful transitions above were verified from fresh native accessibility and renderer state. No provider CLI updates, native-app handoffs, or worktree changes were performed for this feature.

The Browser plugin was not available. Native UI checks used CUA, and renderer diagnostics used the existing bundled Playwright against Electron's localhost DevTools endpoint. Application typecheck, test-only typecheck, lint, full tests and build are run separately; the unrelated `patchT3ServerBundleProviderUpdates` declaration failure in the existing CLI-update tests is tracked in continuity/delivery notes.

## Optional container checks

`Dockerfile.agent-checks` combines caller-selected official Node and Bun images without installing tooling on the host. Use a disposable clean checkout with no host `node_modules` when mounting `/workspace`; install the locked dependencies **inside** that container. Pin both image arguments to audited tags/digests for reproducible CI. Example:

```sh
docker build -f Dockerfile.agent-checks --build-arg NODE_IMAGE=node:lts-bookworm-slim --build-arg BUN_IMAGE=oven/bun:latest -t cozea-agent-checks .
docker run --rm -v /absolute/path/to/disposable-checkout:/workspace cozea-agent-checks sh -lc 'bun install --frozen-lockfile --ignore-scripts && bun run test -- tests/assistant/history'
```

The local Docker daemon was unavailable during this task, so this container recipe was not exercised. Verification used the pre-installed macOS Bun/Node toolchain; no system packages or dependencies were installed. Native Electron acceptance requires the host application.
