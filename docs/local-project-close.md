# Local workspace close

**Close Workspace** is a preservation-only action in local project settings and the missing-folder surface. It stops the selected workspace's local runtimes, then returns to the project list. The local project, workspace binding, lanes, name, visibility, files, private conversations, drafts and layouts remain available. Opening the project again uses the same identities. Hide on This Device remains independent of close.

## Durable intent

Main owns `workspace.projects.close`, `resumeClose` and `cancelClose`. It serializes close with create/open/repair, checks the active local project and records the exact workspace ID, project root, binding revision and sorted runtime roots before effects. The bounded roots include catalog lanes, including independent worktrees. A pending folder repair must be recovered before close.

The existing `remove` journal family stores these receipts with immutable `closeOnly: true`, `removeLocalData: false` and `trashManagedFolder: false`. This is not a completed permanent-removal receipt. Generic renderer journal writes cannot create or complete it. Completed close replay acknowledges the original action without stopping runtimes started by a later reopen. Completed receipts are retained; deleting their idempotency keys during compaction would allow an old request to close a newly opened workspace.

Unacknowledged shutdown leaves an unknown receipt. Startup does not automatically retry it. Launch/settings recovery offers **Retry** and **Cancel Close**. Retry uses the saved scope; changed bindings or lane roots require cancellation and a new request. Cancel clears the unfinished intent, preserves all local data, and does not restart any runtime already stopped by that attempt. The user can reopen the project to resume work.

## Native shutdown

1. Main registers the exact current binding with projectd. A transactional preflight checks project/root/revision and refuses retained collaboration workbenches, session bindings or materialization folders. Close never performs Leave Session or discards a durable replica.
2. Main joins the existing chat-server startup before enumerating backend managers. Every registered backend receives a parent/child request for the exact catalog roots. A disconnected, failed or unacknowledged host prevents completion.
3. The shadow reads T3's authoritative archived shell snapshot. Running/starting chats and native background activity block close. Exact-root idle sessions, including archived chats and matching worktree scopes, receive session-stop commands. The shadow waits for the stopped snapshot; it does not delete threads or projects, interrupt an active turn, or trust command acceptance alone.
4. Main stops the workspace Dev Server, awaits terminal-owner exit events, releases native workbench/browser surfaces, and has projectd recheck retained sessions before idling ordinary workbenches. Ordinary daemon workbench identities and presentation remain.
5. The catalog checks that the binding and runtime roots still match before completing the receipt. Renderer success then releases only matching runtime mirrors/terminal views and navigates away. It does not run the historical best-effort project deletion helper.

Close is an explicit action at that moment, not a persistent ban on reopening the workspace. Concurrent attempts to start work are not permanent-removal exclusion leases. Permanent removal must establish those leases before deleting any binding or data.

## Disposal boundary

Managed Trash eligibility now requires the original directory's recorded device/inode/birthtime, canonical paths, strict containment in its recorded managed root, root-level binding and matching ownership marker. Overlapping workspace and other-workspace lane claims reject eligibility. Attached folders never receive deletion authority, even inside a managed directory. Missing physical proof, copied markers, replaced folders or symlinks reject the target.

This improves the existing ownership check; it does not implement durable Trash outcome reconciliation. Permanent removal still needs explicit data-retention controls, catalog/daemon exclusion receipts, authoritative cleanup acknowledgments, recoverable folder staging and journal compaction that preserves idempotency and repair provenance. Existing compatibility Trash/Clear all are not qualified by the new preservation-only close workflow.

See [catalog contracts](local-project-catalog.md), [routing and private identity](local-project-routing.md) and the [implementation ledger](current/project-system-implementation.md) for executed evidence and remaining acceptance.
