# Assistant Runtime UI/CLI Upgrade Checklist

This is the current ordered implementation list for tightening the connection between the chat UI, orchestration layer, provider runtimes, and the underlying CLIs.

The first integrated pass should land the runtime signal path, stop lifecycle wiring, and cancelled/interrupted state visibility together. Those changes are tightly coupled and have the biggest user-facing impact.

## Status Snapshot

Completed in repo:
- Slice 1.1 event projection in `ProviderRuntimeIngestion.ts`
- Slice 1.3 session/work-log support in `session-logic.ts`
- Slice 1.4 richer work-row rendering in `MessagesTimeline.tsx`
- Slice 1.5 inline persisted-file rendering improvements in the timeline and work-log derivation
- Slice 2.6 through 2.13 stop lifecycle wiring and state visibility
- Slice 3.14 through 3.18 Cursor ACP cancelled-tool fidelity
- Slice 4 foundation: shared tool canonicalization in `shared/assistant-shared/toolActivity.ts`
- Slice 4 adapter normalization in `ClaudeAdapter.ts`, `CodexAdapter.ts`, `CursorAdapter.ts`, and `OpenCodeAdapter.ts`
- Slice 5 provider persistence/observability work in `ProviderService.ts`, `ProviderSessionRuntime.ts`, `ProviderSessionDirectory.ts`, `ProviderSessionReaper.ts`, `serverLayers.ts`, and `OpenCodeProvider.ts`
- Slice 6 provider architecture cleanup via `CodexSessionRuntime.ts` and `builtInProviderCatalog.ts`
- Slice 7 descriptor-based model options, draft state, and UI controls in `shared/assistant-contracts/model.ts`, `shared/assistant-shared/model.ts`, `composerDraftStore.ts`, `ProviderOptionControls.tsx`, and `useWorkbenchAssistantTileController.tsx`
- Slice 8 coverage for ingestion/session-logic/thread-session/ACP runtime event mapping, shared model helpers, server settings merging, and Codex session runtime input building

Still open:
- A dedicated persisted-file tree/list abstraction in place of the inline timeline treatment
- A more ambitious searchable provider/model/traits picker UX if we want to match or exceed the latest upstream `t3code` picker
- Repo-wide typecheck and the blocked assistant-runtime import/test issues that predate this work

## Slice 1: Immediate Event Projection And Tool Display Wins

1. `electron/assistant-runtime/orchestration/Layers/ProviderRuntimeIngestion.ts`
   - Project dropped runtime events into thread activities
   - Preserve structured `request.opened.args` and `request.resolved.resolution`
   - Surface `files.persisted`, `tool.progress`, `tool.summary`, reroutes, warnings, auth, rate limits, and MCP status

2. `shared/assistant-shared/toolActivity.ts`
   - Expand the canonical tool formatter to derive summaries, command previews, file paths, and richer metadata from structured payloads

3. `src/features/projects/components/assistant/chat/session-logic.ts`
   - Consume the shared tool formatting path instead of rebuilding local heuristics
   - Support the new runtime activity kinds in the work log

4. `src/features/projects/components/assistant/chat/MessagesTimeline.tsx`
   - Render persisted-file rows, richer tool rows, reroutes, warnings, and approval detail

5. `src/features/projects/components/assistant/chat/ChangedFilesTree.tsx`
   - Support plain persisted filename lists, not only diff-tree summaries

## Slice 2: Run Lifecycle, Interrupt UX, And Stop-State UI

6. `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx`
   - Replace the ad hoc interrupt flow with the lifecycle hook
   - Stop clearing interrupt state immediately after dispatch
   - Pass pending-start and force-stop state through to the chat surface

7. `src/features/projects/components/workbench/assistant/useAssistantTurnLifecycle.ts`
   - Make this the source of truth for pending-start, interrupt, interrupt failure, and `thread.session.stop` escalation

8. `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx`
   - Surface `Stopping...`, `Force stop agent`, start timeout, interrupt failure, and interrupted/stopped copy

9. `src/stores/threadSession.ts`
   - Preserve `interrupted` and `stopped` in the UI-facing session model instead of flattening them to `ready` and `closed`

10. `src/features/projects/components/assistant/chat/session-logic.ts`
    - Add richer session phases so interrupted/stopped/error runs do not collapse into generic ready/disconnected states

11. `src/features/projects/components/assistant/chat/useAssistantThreadViewModel.ts`
    - Reflect interrupted/stopped runs in completion summaries and active work state

12. `src/features/projects/components/sidebar/SidebarLaneTiles.tsx`
    - Add agent pills for `Interrupted`, `Stopped`, and `Error`

13. `src/features/projects/components/assistant/chat/ProviderStatusBanner.tsx`
    - Keep provider availability separate from thread runtime stop/interruption state

## Slice 3: Cursor ACP And Cancelled Tool Fidelity

14. `electron/assistant-runtime/provider/Layers/CursorAdapter.ts`
    - Preserve the real ACP cancel path and improve emitted cancel outcome metadata

15. `electron/assistant-runtime/provider/acp/AcpRuntimeModel.ts`
    - Carry enough state for cancelled/failed ACP tool calls to project cleanly

16. `electron/assistant-runtime/provider/acp/AcpCoreRuntimeEvents.ts`
    - Normalize ACP tool lifecycle events so cancelled/completed/failed outcomes stay visible to orchestration

17. `src/features/projects/components/assistant/chat/session-logic.ts`
    - Render cancelled tool/run rows distinctly from completed and failed rows

18. `src/features/projects/components/assistant/chat/MessagesTimeline.tsx`
    - Show cancelled tool/run rows honestly; do not imply there is per-tool stop when the stop path is session scoped

## Slice 4: Adapter Payload Quality

19. `electron/assistant-runtime/provider/Layers/ClaudeAdapter.ts`
20. `electron/assistant-runtime/provider/Layers/CodexAdapter.ts`
21. `electron/assistant-runtime/provider/Layers/CursorAdapter.ts`
22. `electron/assistant-runtime/provider/Layers/OpenCodeAdapter.ts`

Normalize payload richness across adapters so the UI does not have to guess from title/detail strings.

## Slice 5: Provider State, Persistence, And Observability

23. `electron/assistant-runtime/provider/Layers/ProviderService.ts`
24. `electron/assistant-runtime/persistence/Services/ProviderSessionRuntime.ts`
25. `electron/assistant-runtime/provider/Layers/ProviderSessionDirectory.ts`
26. `electron/assistant-runtime/serverLayers.ts` plus `ProviderSessionReaper.ts`
27. `electron/assistant-runtime/provider/Layers/OpenCodeProvider.ts`

Add richer persisted state, lifecycle cleanup, and better provider observability.

## Slice 6: Provider Architecture Cleanup

28. `electron/assistant-runtime/provider/Layers/CodexSessionRuntime.ts`
29. `electron/assistant-runtime/provider/Layers/CodexAdapter.ts`
30. `electron/assistant-runtime/provider/Layers/ProviderRegistry.ts` plus `builtInProviderCatalog.ts`

Move provider-native session construction and provider catalog policy out of the UI-facing orchestration path.

## Slice 7: GUI/CLI Options Contract

31. `shared/assistant-contracts/model.ts`
32. `shared/assistant-shared/model.ts`
33. `src/features/projects/components/assistant/chat/ProviderModelPicker.tsx`
34. `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx`
35. `src/features/projects/components/assistant/chat/composerDraftStore.ts`

Move from provider-shaped option structs to descriptor/selection-based model options and persist draft state separately from tile identity.

## Slice 8: Tests

36. `tests/electron/assistant-runtime/orchestration/Layers/ProviderRuntimeIngestion.test.ts`
37. `tests/shared/assistant-shared/toolActivity.test.ts`
38. `tests/assistant/chat/session-logic.test.ts`
39. `tests/src/stores/threadSession.test.ts`
40. `tests/electron/assistant-runtime/provider/acp/AcpCoreRuntimeEvents.test.ts`
41. `tests/electron/assistant-runtime/provider/acp/AcpRuntimeModel.test.ts`
42. `tests/electron/assistant-runtime/provider/Layers/CursorAdapter.test.ts`

## Recommended Execution Order

1. Slice 1
2. Slice 2
3. Slice 3
4. Slice 8 as each slice lands
5. Slices 4 through 7 after the runtime/event path is stable
