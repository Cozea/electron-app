# Substrate store inventory

Date: 2026-08-26
Classifies Zustand / client stores as `product` | `assistant-runtime` | `bridge` per Track Inv.

## Summary

| Class | Count |
| --- | ---: |
| `product` | 18 |
| `assistant-runtime` | 8 |
| `bridge` | 4 |
| **Total** | **30** |

## `product` (18)

| Store module | Notes |
| --- | --- |
| `src/features/devapps/localProjectDevAppStore.ts` | Product / workbench / collab UI state |
| `src/features/projects/components/sidebar/sidebarWidthStore.ts` | Product / workbench / collab UI state |
| `src/features/projects/devserver/devServerRunStore.ts` | Product / workbench / collab UI state |
| `src/features/projects/lib/projectBranchSessionStore.ts` | Default product UI state |
| `src/features/projects/workspaces/useWorkspaceRuntimeStore.ts` | Product / workbench / collab UI state |
| `src/lib/collab/EncryptedLocalSnapshotStore.ts` | Default product UI state |
| `src/stores/editorPreferences.ts` | Product / workbench / collab UI state |
| `src/stores/markdown-links.ts` | Product / workbench / collab UI state |
| `src/stores/types.ts` | Default product UI state |
| `src/stores/useAutoUpdateStore.ts` | Product / workbench / collab UI state |
| `src/stores/useCollaborationActivityStore.ts` | Product / workbench / collab UI state |
| `src/stores/useCreateProjectDialogStore.ts` | Product / workbench / collab UI state |
| `src/stores/useNativePreviewStore.ts` | Product / workbench / collab UI state |
| `src/stores/usePageContextStore.ts` | Product / workbench / collab UI state |
| `src/stores/useProjectHeaderStore.ts` | Product / workbench / collab UI state |
| `src/stores/useProjectWorkbenchStore.ts` | Workbench layout / selection — product shell |
| `src/stores/useQueryCache.ts` | Product / workbench / collab UI state |
| `src/stores/useSettingsDrawerStore.ts` | Product / workbench / collab UI state |

## `assistant-runtime` (8)

| Store module | Notes |
| --- | --- |
| `src/features/projects/components/assistant/chat/composerDraftStore.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/assistant-store.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/assistant-wsTransport.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/orchestrationReadModelProjector.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/orchestrationRecovery.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/providerModels.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |
| `src/stores/threadSession.ts` | Assistant WS / orchestration / provider projection — replace with client-runtime atoms (Phase 2+) |

## `bridge` (4)

| Store module | Notes |
| --- | --- |
| `src/stores/terminalContext.ts` | Git changes / terminal context bridges assistant + product — thin after VcsDriver |
| `src/stores/useChangesSidebarStore.ts` | Git changes / terminal context bridges assistant + product — thin after VcsDriver |
| `src/stores/useGitChangesStore.ts` | Git changes / terminal context bridges assistant + product — thin after VcsDriver |
| `src/stores/useTerminalStore.ts` | Git changes / terminal context bridges assistant + product — thin after VcsDriver |
