# Substrate IPC inventory

Date: 2026-08-26
Source: Cozea `main` @ `197c7d25` — scanned all `ipcMain.handle` under `electron/` (**215** handlers).

Companion docs: `docs/t3code-implementation-plan.md` (Track Inv), `docs/substrate-store-inventory.md`, `docs/substrate-gap-table.md`, `docs/substrate-t3-pin.md`.

> **Removal delta (2026-08-31):** This remains a historical inventory of the stated source commit.
> The current branch has deleted all 19 `workbenchBrowser:*` handlers plus
> `workbenchSession:getBrowserBinding`, `workbenchSession:bindBrowser`, and
> `workbenchSession:releaseBrowser`. Their preload exposure is also gone. Any `keep-ipc` disposition
> for those 22 rows below is superseded; the future T3 browser must not restore this API surface.

## Summary counts

| Disposition | Count |
| --- | ---: |
| `keep-ipc` | 150 |
| `move-to-server-rpc` | 60 |
| `delete` | 5 |
| **Total handlers** | **215** |

Notes:
- Assistant turn orchestration is primarily **WebSocket** (`electron/assistant-runtime`), not IPC — see gap table.
- `delete` = delete **after** replacement exists (Phase 4b), not immediately.
- Overlay keepers that mutate git must call substrate status invalidation in Phase 4c.

## `keep-ipc` (150)

| Channel | File | Rationale |
| --- | --- | --- |
| `app:getGpuDiagnostics` | `electron/ipc/registerCoreHandlers.ts:100` | App/desktop chrome |
| `app:setNativeThemeSource` | `electron/ipc/registerCoreHandlers.ts:104` | App/desktop chrome |
| `collab:createRecoveryKit` | `electron/services/CollabEncryptionService.ts:59` | E2E collab crypto — Cozea overlay |
| `collab:deleteDeviceIdentity` | `electron/services/CollabEncryptionService.ts:85` | E2E collab crypto — Cozea overlay |
| `collab:ensureDeviceIdentity` | `electron/services/CollabEncryptionService.ts:31` | E2E collab crypto — Cozea overlay |
| `collab:getStoredDeviceIdentity` | `electron/services/CollabEncryptionService.ts:35` | E2E collab crypto — Cozea overlay |
| `collab:isEncryptionAvailable` | `electron/services/CollabEncryptionService.ts:27` | E2E collab crypto — Cozea overlay |
| `collab:unwrapRecoveryKit` | `electron/services/CollabEncryptionService.ts:69` | E2E collab crypto — Cozea overlay |
| `collab:unwrapRoomKey` | `electron/services/CollabEncryptionService.ts:49` | E2E collab crypto — Cozea overlay |
| `collab:wrapRoomKey` | `electron/services/CollabEncryptionService.ts:39` | E2E collab crypto — Cozea overlay |
| `contextMenu:showFileTreeMenu` | `electron/ipc/registerContextMenuHandlers.ts:110` | OS / desktop chrome |
| `contextMenu:showGeneric` | `electron/ipc/registerContextMenuHandlers.ts:279` | OS / desktop chrome |
| `contextMenu:showNative` | `electron/ipc/registerContextMenuHandlers.ts:315` | OS / desktop chrome |
| `contextMenu:showOpenInEditorPicker` | `electron/ipc/registerContextMenuHandlers.ts:380` | OS / desktop chrome |
| `contextMenu:showTerminalSelection` | `electron/ipc/registerContextMenuHandlers.ts:48` | OS / desktop chrome |
| `contextMenu:showVisualEditorMenu` | `electron/ipc/registerContextMenuHandlers.ts:218` | OS / desktop chrome |
| `devServer:getState` | `electron/ipc/registerDevServerHandlers.ts:221` | Dev server / DevApps process control — product overlay |
| `devServer:isRunning` | `electron/ipc/registerDevServerHandlers.ts:206` | Dev server / DevApps process control — product overlay |
| `devServer:resize` | `electron/ipc/registerDevServerHandlers.ts:198` | Dev server / DevApps process control — product overlay |
| `devServer:start` | `electron/ipc/registerDevServerHandlers.ts:44` | Dev server / DevApps process control — product overlay |
| `devServer:stop` | `electron/ipc/registerDevServerHandlers.ts:183` | Dev server / DevApps process control — product overlay |
| `dialog:selectDirectory` | `electron/ipc/registerSettingsStorageHandlers.ts:544` | Native dialogs |
| `dialog:selectFile` | `electron/ipc/registerSettingsStorageHandlers.ts:568` | Native dialogs |
| `dialog:showMessageBox` | `electron/ipc/registerSettingsStorageHandlers.ts:594` | Native dialogs |
| `editor:listAvailableEditors` | `electron/ipc/registerCoreHandlers.ts:96` | Open-in-editor desktop helper |
| `editor:openInEditor` | `electron/ipc/registerCoreHandlers.ts:108` | Open-in-editor desktop helper |
| `fs:readDir` | `electron/ipc/registerProjectHandlers.ts:888` | Workbench FS helpers (revisit when server FS RPC exists) |
| `fs:readFile` | `electron/ipc/registerProjectHandlers.ts:928` | Workbench FS helpers (revisit when server FS RPC exists) |
| `nativePreview:captureScreenshot` | `electron/ipc/registerNativePreviewHandlers.ts:120` | Native preview — product overlay |
| `nativePreview:copyLastScreenshot` | `electron/ipc/registerNativePreviewHandlers.ts:130` | Native preview — product overlay |
| `nativePreview:getSessionState` | `electron/ipc/registerNativePreviewHandlers.ts:78` | Native preview — product overlay |
| `nativePreview:listIosSimulators` | `electron/ipc/registerNativePreviewHandlers.ts:41` | Native preview — product overlay |
| `nativePreview:resolveLaunchConfig` | `electron/ipc/registerNativePreviewHandlers.ts:48` | Native preview — product overlay |
| `nativePreview:rotate` | `electron/ipc/registerNativePreviewHandlers.ts:113` | Native preview — product overlay |
| `nativePreview:sendButton` | `electron/ipc/registerNativePreviewHandlers.ts:106` | Native preview — product overlay |
| `nativePreview:sendKey` | `electron/ipc/registerNativePreviewHandlers.ts:99` | Native preview — product overlay |
| `nativePreview:sendTouches` | `electron/ipc/registerNativePreviewHandlers.ts:85` | Native preview — product overlay |
| `nativePreview:sendWheel` | `electron/ipc/registerNativePreviewHandlers.ts:92` | Native preview — product overlay |
| `nativePreview:startSession` | `electron/ipc/registerNativePreviewHandlers.ts:58` | Native preview — product overlay |
| `nativePreview:stopSession` | `electron/ipc/registerNativePreviewHandlers.ts:68` | Native preview — product overlay |
| `preview:captureScreenshot` | `electron/ipc/registerPreviewHandlers.ts:1716` | In-app preview bridge — product overlay |
| `preview:captureVisibleRegion` | `electron/ipc/registerPreviewHandlers.ts:1697` | In-app preview bridge — product overlay |
| `preview:injectBridge` | `electron/ipc/registerPreviewHandlers.ts:1284` | In-app preview bridge — product overlay |
| `preview:inspectSelection` | `electron/ipc/registerPreviewHandlers.ts:1504` | In-app preview bridge — product overlay |
| `preview:probePort` | `electron/ipc/registerPreviewHandlers.ts:1534` | In-app preview bridge — product overlay |
| `preview:probeUrl` | `electron/ipc/registerPreviewHandlers.ts:1615` | In-app preview bridge — product overlay |
| `preview:updateSelectionStyles` | `electron/ipc/registerPreviewHandlers.ts:1514` | In-app preview bridge — product overlay |
| `preview:updateSelectionText` | `electron/ipc/registerPreviewHandlers.ts:1524` | In-app preview bridge — product overlay |
| `project:checkGhCliStatus` | `electron/ipc/registerProjectHandlers.ts:1019` | Project FS / desktop helpers — product |
| `project:copyDirectorySnapshot` | `electron/ipc/registerProjectHandlers.ts:757` | Project FS / desktop helpers — product |
| `project:copyPath` | `electron/ipc/registerProjectHandlers.ts:705` | Project FS / desktop helpers — product |
| `project:deletePath` | `electron/ipc/registerProjectHandlers.ts:655` | Project FS / desktop helpers — product |
| `project:exists` | `electron/ipc/registerProjectHandlers.ts:364` | Project FS / desktop helpers — product |
| `project:getContextOptions` | `electron/ipc/registerProjectHandlers.ts:568` | Project FS / desktop helpers — product |
| `project:getPathNativeIcon` | `electron/ipc/registerProjectHandlers.ts:324` | Project FS / desktop helpers — product |
| `project:listFiles` | `electron/ipc/registerProjectHandlers.ts:552` | Project FS / desktop helpers — product |
| `project:mergeLaneIntoCollab` | `electron/ipc/registerProjectHandlers.ts:262` | Lane → collab merge — Cozea overlay; must invalidate substrate status |
| `project:openFolder` | `electron/ipc/registerProjectHandlers.ts:332` | Project FS / desktop helpers — product |
| `project:pathExists` | `electron/ipc/registerProjectHandlers.ts:387` | Project FS / desktop helpers — product |
| `project:preflightImportSource` | `electron/ipc/registerProjectHandlers.ts:827` | Project FS / desktop helpers — product |
| `project:readFile` | `electron/ipc/registerProjectHandlers.ts:488` | Project FS / desktop helpers — product |
| `project:readFileBase64` | `electron/ipc/registerProjectHandlers.ts:520` | Project FS / desktop helpers — product |
| `project:renameFile` | `electron/ipc/registerProjectHandlers.ts:589` | Project FS / desktop helpers — product |
| `project:resolveRoot` | `electron/ipc/registerProjectHandlers.ts:404` | Project FS / desktop helpers — product |
| `project:watchStart` | `electron/ipc/registerProjectHandlers.ts:859` | Project FS / desktop helpers — product |
| `project:watchStop` | `electron/ipc/registerProjectHandlers.ts:871` | Project FS / desktop helpers — product |
| `project:writeFile` | `electron/ipc/registerProjectHandlers.ts:417` | Project FS / desktop helpers — product |
| `runtime:detectProjectRuntime` | `electron/ipc/registerRuntimeHandlers.ts:72` | Local runtime ensure/detect — product |
| `runtime:ensureCommandRuntime` | `electron/ipc/registerRuntimeHandlers.ts:89` | Local runtime ensure/detect — product |
| `runtime:ensureForCommand` | `electron/ipc/registerRuntimeHandlers.ts:101` | Local runtime ensure/detect — product |
| `runtime:ensureRuntime` | `electron/ipc/registerRuntimeHandlers.ts:113` | Local runtime ensure/detect — product |
| `runtime:getProjectCapabilities` | `electron/ipc/registerRuntimeHandlers.ts:59` | Local runtime ensure/detect — product |
| `runtime:getRuntimeStatus` | `electron/ipc/registerRuntimeHandlers.ts:131` | Local runtime ensure/detect — product |
| `runtime:resolveCommand` | `electron/ipc/registerRuntimeHandlers.ts:85` | Local runtime ensure/detect — product |
| `settings:get` | `electron/ipc/registerSettingsStorageHandlers.ts:521` | Local settings |
| `settings:set` | `electron/ipc/registerSettingsStorageHandlers.ts:525` | Local settings |
| `shell:listAvailableBrowsers` | `electron/ipc/registerCoreHandlers.ts:77` | OS shell helpers |
| `shell:openExternal` | `electron/ipc/registerCoreHandlers.ts:65` | OS shell helpers |
| `shell:openInBrowser` | `electron/ipc/registerCoreHandlers.ts:81` | OS shell helpers |
| `storage:clearAll` | `electron/ipc/registerSettingsStorageHandlers.ts:744` | Local storage / project list |
| `storage:clearCache` | `electron/ipc/registerSettingsStorageHandlers.ts:643` | Local storage / project list |
| `storage:clearLogs` | `electron/ipc/registerSettingsStorageHandlers.ts:680` | Local storage / project list |
| `storage:deleteProject` | `electron/ipc/registerSettingsStorageHandlers.ts:701` | Local storage / project list |
| `storage:getSnapshot` | `electron/ipc/registerSettingsStorageHandlers.ts:600` | Local storage / project list |
| `storage:getUsage` | `electron/ipc/registerSettingsStorageHandlers.ts:615` | Local storage / project list |
| `storage:listProjects` | `electron/ipc/registerSettingsStorageHandlers.ts:621` | Local storage / project list |
| `storage:openProjectsDirectory` | `electron/ipc/registerSettingsStorageHandlers.ts:627` | Local storage / project list |
| `updates:check` | `electron/ipc/registerCoreHandlers.ts:37` | Auto-update |
| `updates:download` | `electron/ipc/registerCoreHandlers.ts:43` | Auto-update |
| `updates:getState` | `electron/ipc/registerCoreHandlers.ts:35` | Auto-update |
| `updates:install` | `electron/ipc/registerCoreHandlers.ts:53` | Auto-update |
| `window:isFullScreen` | `electron/ipc/registerCoreHandlers.ts:153` | Window chrome |
| `window:openSettings` | `electron/ipc/registerCoreHandlers.ts:157` | Window chrome |
| `workbenchBrowser:captureScreenshot` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:170` | Workbench browser tiles — product overlay |
| `workbenchBrowser:destroyTile` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:39` | Workbench browser tiles — product overlay |
| `workbenchBrowser:ensureTile` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:20` | Workbench browser tiles — product overlay |
| `workbenchBrowser:findInPage` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:143` | Workbench browser tiles — product overlay |
| `workbenchBrowser:focus` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:101` | Workbench browser tiles — product overlay |
| `workbenchBrowser:getSelectedText` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:163` | Workbench browser tiles — product overlay |
| `workbenchBrowser:getState` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:66` | Workbench browser tiles — product overlay |
| `workbenchBrowser:getViewBounds` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:73` | Workbench browser tiles — product overlay |
| `workbenchBrowser:goBack` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:80` | Workbench browser tiles — product overlay |
| `workbenchBrowser:goForward` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:87` | Workbench browser tiles — product overlay |
| `workbenchBrowser:navigate` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:56` | Workbench browser tiles — product overlay |
| `workbenchBrowser:openExternal` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:115` | Workbench browser tiles — product overlay |
| `workbenchBrowser:reload` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:94` | Workbench browser tiles — product overlay |
| `workbenchBrowser:resetZoom` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:136` | Workbench browser tiles — product overlay |
| `workbenchBrowser:setBounds` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:46` | Workbench browser tiles — product overlay |
| `workbenchBrowser:stopFindInPage` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:153` | Workbench browser tiles — product overlay |
| `workbenchBrowser:toggleDevTools` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:108` | Workbench browser tiles — product overlay |
| `workbenchBrowser:zoomIn` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:122` | Workbench browser tiles — product overlay |
| `workbenchBrowser:zoomOut` | `electron/ipc/registerWorkbenchBrowserHandlers.ts:129` | Workbench browser tiles — product overlay |
| `workbenchSession:activateSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:41` | Workbench session bindings — product shell |
| `workbenchSession:backgroundSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:48` | Workbench session bindings — product shell |
| `workbenchSession:bindBrowser` | `electron/ipc/registerWorkbenchSessionHandlers.ts:137` | Workbench session bindings — product shell |
| `workbenchSession:bindTerminal` | `electron/ipc/registerWorkbenchSessionHandlers.ts:96` | Workbench session bindings — product shell |
| `workbenchSession:closeSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:64` | Workbench session bindings — product shell |
| `workbenchSession:ensureSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:34` | Workbench session bindings — product shell |
| `workbenchSession:getBrowserBinding` | `electron/ipc/registerWorkbenchSessionHandlers.ts:130` | Workbench session bindings — product shell |
| `workbenchSession:getSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:71` | Workbench session bindings — product shell |
| `workbenchSession:getTerminalBinding` | `electron/ipc/registerWorkbenchSessionHandlers.ts:89` | Workbench session bindings — product shell |
| `workbenchSession:listSessions` | `electron/ipc/registerWorkbenchSessionHandlers.ts:78` | Workbench session bindings — product shell |
| `workbenchSession:releaseBrowser` | `electron/ipc/registerWorkbenchSessionHandlers.ts:154` | Workbench session bindings — product shell |
| `workbenchSession:releaseTerminal` | `electron/ipc/registerWorkbenchSessionHandlers.ts:113` | Workbench session bindings — product shell |
| `workbenchSession:setNativePreviewSession` | `electron/ipc/registerWorkbenchSessionHandlers.ts:171` | Workbench session bindings — product shell |
| `workbenchSession:setPinned` | `electron/ipc/registerWorkbenchSessionHandlers.ts:82` | Workbench session bindings — product shell |
| `workspace:bindExistingFolder` | `electron/ipc/registerWorkspaceHandlers.ts:66` | Workspace catalog — Cozea product |
| `workspace:cloneForProject` | `electron/ipc/registerWorkspaceHandlers.ts:84` | Workspace catalog — Cozea product |
| `workspace:createForProject` | `electron/ipc/registerWorkspaceHandlers.ts:78` | Workspace catalog — Cozea product |
| `workspace:forget` | `electron/ipc/registerWorkspaceHandlers.ts:94` | Workspace catalog — Cozea product |
| `workspace:getActiveForProject` | `electron/ipc/registerWorkspaceHandlers.ts:48` | Workspace catalog — Cozea product |
| `workspace:getCatalogSnapshot` | `electron/ipc/registerWorkspaceHandlers.ts:151` | Workspace catalog — Cozea product |
| `workspace:importExistingFolder` | `electron/ipc/registerWorkspaceHandlers.ts:72` | Workspace catalog — Cozea product |
| `workspace:listCandidates` | `electron/ipc/registerWorkspaceHandlers.ts:98` | Workspace catalog — Cozea product |
| `workspace:listForProject` | `electron/ipc/registerWorkspaceHandlers.ts:40` | Workspace catalog — Cozea product |
| `workspace:openInFinder` | `electron/ipc/registerWorkspaceHandlers.ts:116` | Workspace catalog — Cozea product |
| `workspace:resolveProject` | `electron/ipc/registerWorkspaceHandlers.ts:34` | Workspace catalog — Cozea product |
| `workspace:setActiveForProject` | `electron/ipc/registerWorkspaceHandlers.ts:56` | Workspace catalog — Cozea product |
| `workspace:verify` | `electron/ipc/registerWorkspaceHandlers.ts:90` | Workspace catalog — Cozea product |
| `workspaceSync:ackOps` | `electron/ipc/registerWorkspaceSyncHandlers.ts:1039` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:deleteFiles` | `electron/ipc/registerWorkspaceSyncHandlers.ts:194` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:enqueueOps` | `electron/ipc/registerWorkspaceSyncHandlers.ts:1009` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:getJournalState` | `electron/ipc/registerWorkspaceSyncHandlers.ts:1065` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:gitReadConflictFile` | `electron/ipc/registerWorkspaceSyncHandlers.ts:499` | Collab conflict overlay |
| `workspaceSync:gitResolveConflictFile` | `electron/ipc/registerWorkspaceSyncHandlers.ts:519` | Collab conflict overlay |
| `workspaceSync:hashFile` | `electron/ipc/registerWorkspaceSyncHandlers.ts:69` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:mergePreview` | `electron/ipc/registerWorkspaceSyncHandlers.ts:973` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:mergeTreePreview` | `electron/ipc/registerWorkspaceSyncHandlers.ts:993` | Sync journal / collab merge preview — Cozea overlay |
| `workspaceSync:writeFiles` | `electron/ipc/registerWorkspaceSyncHandlers.ts:83` | Sync journal / collab merge preview — Cozea overlay |
| `yjs:setInterestRoots` | `electron/ipc/registerYjsHandlers.ts:6` | Yjs interest roots — Cozea overlay |

## `move-to-server-rpc` (60)

| Channel | File | Rationale |
| --- | --- | --- |
| `agentTools:getStatus` | `electron/services/AgentToolService.ts:303` | Assistant runtime status/tools — belongs on spawned server |
| `agentTools:loginCancel` | `electron/services/AgentToolService.ts:319` | Assistant runtime status/tools — belongs on spawned server |
| `agentTools:loginInput` | `electron/services/AgentToolService.ts:315` | Assistant runtime status/tools — belongs on spawned server |
| `agentTools:loginStart` | `electron/services/AgentToolService.ts:311` | Assistant runtime status/tools — belongs on spawned server |
| `agentTools:prepare` | `electron/services/AgentToolService.ts:307` | Assistant runtime status/tools — belongs on spawned server |
| `assistantRuntime:getStatus` | `electron/main.ts:675` | Assistant runtime status/tools — belongs on spawned server |
| `integrations:createRepository` | `electron/services/IntegrationService.ts:118` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:deleteKey` | `electron/services/IntegrationService.ts:49` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:encrypt` | `electron/services/IntegrationService.ts:58` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:generateKey` | `electron/services/IntegrationService.ts:36` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:getToolDefinition` | `electron/services/IntegrationService.ts:153` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:isEncryptionAvailable` | `electron/services/IntegrationService.ts:32` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:isToolAvailable` | `electron/services/IntegrationService.ts:149` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:keyExists` | `electron/services/IntegrationService.ts:53` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:listRepositories` | `electron/services/IntegrationService.ts:102` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:listRepositoryOwners` | `electron/services/IntegrationService.ts:90` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:listTools` | `electron/services/IntegrationService.ts:165` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:runTool` | `electron/services/IntegrationService.ts:136` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:startOAuth` | `electron/services/IntegrationService.ts:67` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:storeKey` | `electron/services/IntegrationService.ts:45` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `integrations:syncRepositoryAccess` | `electron/services/IntegrationService.ts:74` | Agent integrations/tools — server RPC; OAuth browser open may keep a tiny IPC helper |
| `project:checkoutGitBranch` | `electron/ipc/registerProjectHandlers.ts:226` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `project:createGitHubRepo` | `electron/ipc/registerProjectHandlers.ts:1044` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `project:createGitWorktree` | `electron/ipc/registerProjectHandlers.ts:240` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `project:listGitBranches` | `electron/ipc/registerProjectHandlers.ts:212` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `terminal:attachView` | `electron/services/TerminalService.ts:575` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:create` | `electron/services/TerminalService.ts:563` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:create` | `electron/ipc/registerTerminalWorkspaceHandlers.ts:24` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:detachView` | `electron/services/TerminalService.ts:580` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:getInfo` | `electron/services/TerminalService.ts:609` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:getOutputEventsSince` | `electron/services/TerminalService.ts:633` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:getProfiles` | `electron/services/TerminalService.ts:599` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:getSnapshot` | `electron/services/TerminalService.ts:623` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:input` | `electron/services/TerminalService.ts:584` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:kill` | `electron/services/TerminalService.ts:594` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:list` | `electron/services/TerminalService.ts:604` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:list` | `electron/ipc/registerTerminalWorkspaceHandlers.ts:59` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `terminal:resize` | `electron/services/TerminalService.ts:589` | PTY should consolidate on server terminal.attach (Phase 4a); thin display bridge may remain |
| `workspaceSync:getGitRuntimeHealth` | `electron/ipc/registerWorkspaceSyncHandlers.ts:283` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitAdoptWorkspace` | `electron/ipc/registerWorkspaceSyncHandlers.ts:572` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitClassifyRepoHealth` | `electron/ipc/registerWorkspaceSyncHandlers.ts:450` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitCloneIfMissing` | `electron/ipc/registerWorkspaceSyncHandlers.ts:309` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitCommitAll` | `electron/ipc/registerWorkspaceSyncHandlers.ts:598` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitCommitAndPush` | `electron/ipc/registerWorkspaceSyncHandlers.ts:649` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitEnsureRepo` | `electron/ipc/registerWorkspaceSyncHandlers.ts:287` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitFetchMain` | `electron/ipc/registerWorkspaceSyncHandlers.ts:336` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitGetHeadDiffStats` | `electron/ipc/registerWorkspaceSyncHandlers.ts:810` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:gitListChanges` | `electron/ipc/registerWorkspaceSyncHandlers.ts:833` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:gitPullMain` | `electron/ipc/registerWorkspaceSyncHandlers.ts:385` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitPushMain` | `electron/ipc/registerWorkspaceSyncHandlers.ts:623` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitReadChanges` | `electron/ipc/registerWorkspaceSyncHandlers.ts:885` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:gitReadChangesPatch` | `electron/ipc/registerWorkspaceSyncHandlers.ts:858` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:gitReplayLocalCommits` | `electron/ipc/registerWorkspaceSyncHandlers.ts:418` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitRestoreMain` | `electron/ipc/registerWorkspaceSyncHandlers.ts:540` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitSalvageReclone` | `electron/ipc/registerWorkspaceSyncHandlers.ts:472` | Git/VCS ops — VcsDriver / GitWorkflowService (Phase 4a); collab salvage may stay as thin adapter |
| `workspaceSync:gitStatus` | `electron/ipc/registerWorkspaceSyncHandlers.ts:363` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:subscribeGitChanges` | `electron/ipc/registerWorkspaceSyncHandlers.ts:914` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:subscribeGitDirtyState` | `electron/ipc/registerWorkspaceSyncHandlers.ts:945` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:unsubscribeGitChanges` | `electron/ipc/registerWorkspaceSyncHandlers.ts:929` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |
| `workspaceSync:unsubscribeGitDirtyState` | `electron/ipc/registerWorkspaceSyncHandlers.ts:958` | Status/changes fanout — replace with subscribeVcsStatus (Phase 4c) |

## `delete` (5)

| Channel | File | Rationale |
| --- | --- | --- |
| `workspaceSync:gitCaptureCheckpoint` | `electron/ipc/registerWorkspaceSyncHandlers.ts:681` | Duplicate checkpoint capture/diff — fold into VcsDriver.checkpoints (Phase 4b), then delete |
| `workspaceSync:gitDeleteAllCheckpointRefs` | `electron/ipc/registerWorkspaceSyncHandlers.ts:791` | Duplicate checkpoint capture/diff — fold into VcsDriver.checkpoints (Phase 4b), then delete |
| `workspaceSync:gitDeleteCheckpointRefs` | `electron/ipc/registerWorkspaceSyncHandlers.ts:768` | Duplicate checkpoint capture/diff — fold into VcsDriver.checkpoints (Phase 4b), then delete |
| `workspaceSync:gitDiffCheckpoints` | `electron/ipc/registerWorkspaceSyncHandlers.ts:714` | Duplicate checkpoint capture/diff — fold into VcsDriver.checkpoints (Phase 4b), then delete |
| `workspaceSync:gitReadCheckpointFilePair` | `electron/ipc/registerWorkspaceSyncHandlers.ts:741` | Duplicate checkpoint capture/diff — fold into VcsDriver.checkpoints (Phase 4b), then delete |

## By register module

### `electron/ipc/registerContextMenuHandlers.ts` (6)

| Channel | Disposition |
| --- | --- |
| `contextMenu:showFileTreeMenu` | `keep-ipc` |
| `contextMenu:showGeneric` | `keep-ipc` |
| `contextMenu:showNative` | `keep-ipc` |
| `contextMenu:showOpenInEditorPicker` | `keep-ipc` |
| `contextMenu:showTerminalSelection` | `keep-ipc` |
| `contextMenu:showVisualEditorMenu` | `keep-ipc` |

### `electron/ipc/registerCoreHandlers.ts` (13)

| Channel | Disposition |
| --- | --- |
| `app:getGpuDiagnostics` | `keep-ipc` |
| `app:setNativeThemeSource` | `keep-ipc` |
| `editor:listAvailableEditors` | `keep-ipc` |
| `editor:openInEditor` | `keep-ipc` |
| `shell:listAvailableBrowsers` | `keep-ipc` |
| `shell:openExternal` | `keep-ipc` |
| `shell:openInBrowser` | `keep-ipc` |
| `updates:check` | `keep-ipc` |
| `updates:download` | `keep-ipc` |
| `updates:getState` | `keep-ipc` |
| `updates:install` | `keep-ipc` |
| `window:isFullScreen` | `keep-ipc` |
| `window:openSettings` | `keep-ipc` |

### `electron/ipc/registerDevServerHandlers.ts` (5)

| Channel | Disposition |
| --- | --- |
| `devServer:getState` | `keep-ipc` |
| `devServer:isRunning` | `keep-ipc` |
| `devServer:resize` | `keep-ipc` |
| `devServer:start` | `keep-ipc` |
| `devServer:stop` | `keep-ipc` |

### `electron/ipc/registerNativePreviewHandlers.ts` (12)

| Channel | Disposition |
| --- | --- |
| `nativePreview:captureScreenshot` | `keep-ipc` |
| `nativePreview:copyLastScreenshot` | `keep-ipc` |
| `nativePreview:getSessionState` | `keep-ipc` |
| `nativePreview:listIosSimulators` | `keep-ipc` |
| `nativePreview:resolveLaunchConfig` | `keep-ipc` |
| `nativePreview:rotate` | `keep-ipc` |
| `nativePreview:sendButton` | `keep-ipc` |
| `nativePreview:sendKey` | `keep-ipc` |
| `nativePreview:sendTouches` | `keep-ipc` |
| `nativePreview:sendWheel` | `keep-ipc` |
| `nativePreview:startSession` | `keep-ipc` |
| `nativePreview:stopSession` | `keep-ipc` |

### `electron/ipc/registerPreviewHandlers.ts` (8)

| Channel | Disposition |
| --- | --- |
| `preview:captureScreenshot` | `keep-ipc` |
| `preview:captureVisibleRegion` | `keep-ipc` |
| `preview:injectBridge` | `keep-ipc` |
| `preview:inspectSelection` | `keep-ipc` |
| `preview:probePort` | `keep-ipc` |
| `preview:probeUrl` | `keep-ipc` |
| `preview:updateSelectionStyles` | `keep-ipc` |
| `preview:updateSelectionText` | `keep-ipc` |

### `electron/ipc/registerProjectHandlers.ts` (25)

| Channel | Disposition |
| --- | --- |
| `fs:readDir` | `keep-ipc` |
| `fs:readFile` | `keep-ipc` |
| `project:checkGhCliStatus` | `keep-ipc` |
| `project:checkoutGitBranch` | `move-to-server-rpc` |
| `project:copyDirectorySnapshot` | `keep-ipc` |
| `project:copyPath` | `keep-ipc` |
| `project:createGitHubRepo` | `move-to-server-rpc` |
| `project:createGitWorktree` | `move-to-server-rpc` |
| `project:deletePath` | `keep-ipc` |
| `project:exists` | `keep-ipc` |
| `project:getContextOptions` | `keep-ipc` |
| `project:getPathNativeIcon` | `keep-ipc` |
| `project:listFiles` | `keep-ipc` |
| `project:listGitBranches` | `move-to-server-rpc` |
| `project:mergeLaneIntoCollab` | `keep-ipc` |
| `project:openFolder` | `keep-ipc` |
| `project:pathExists` | `keep-ipc` |
| `project:preflightImportSource` | `keep-ipc` |
| `project:readFile` | `keep-ipc` |
| `project:readFileBase64` | `keep-ipc` |
| `project:renameFile` | `keep-ipc` |
| `project:resolveRoot` | `keep-ipc` |
| `project:watchStart` | `keep-ipc` |
| `project:watchStop` | `keep-ipc` |
| `project:writeFile` | `keep-ipc` |

### `electron/ipc/registerRuntimeHandlers.ts` (7)

| Channel | Disposition |
| --- | --- |
| `runtime:detectProjectRuntime` | `keep-ipc` |
| `runtime:ensureCommandRuntime` | `keep-ipc` |
| `runtime:ensureForCommand` | `keep-ipc` |
| `runtime:ensureRuntime` | `keep-ipc` |
| `runtime:getProjectCapabilities` | `keep-ipc` |
| `runtime:getRuntimeStatus` | `keep-ipc` |
| `runtime:resolveCommand` | `keep-ipc` |

### `electron/ipc/registerSettingsStorageHandlers.ts` (13)

| Channel | Disposition |
| --- | --- |
| `dialog:selectDirectory` | `keep-ipc` |
| `dialog:selectFile` | `keep-ipc` |
| `dialog:showMessageBox` | `keep-ipc` |
| `settings:get` | `keep-ipc` |
| `settings:set` | `keep-ipc` |
| `storage:clearAll` | `keep-ipc` |
| `storage:clearCache` | `keep-ipc` |
| `storage:clearLogs` | `keep-ipc` |
| `storage:deleteProject` | `keep-ipc` |
| `storage:getSnapshot` | `keep-ipc` |
| `storage:getUsage` | `keep-ipc` |
| `storage:listProjects` | `keep-ipc` |
| `storage:openProjectsDirectory` | `keep-ipc` |

### `electron/ipc/registerTerminalWorkspaceHandlers.ts` (2)

| Channel | Disposition |
| --- | --- |
| `terminal:create` | `move-to-server-rpc` |
| `terminal:list` | `move-to-server-rpc` |

### `electron/ipc/registerWorkbenchBrowserHandlers.ts` (19)

| Channel | Disposition |
| --- | --- |
| `workbenchBrowser:captureScreenshot` | `keep-ipc` |
| `workbenchBrowser:destroyTile` | `keep-ipc` |
| `workbenchBrowser:ensureTile` | `keep-ipc` |
| `workbenchBrowser:findInPage` | `keep-ipc` |
| `workbenchBrowser:focus` | `keep-ipc` |
| `workbenchBrowser:getSelectedText` | `keep-ipc` |
| `workbenchBrowser:getState` | `keep-ipc` |
| `workbenchBrowser:getViewBounds` | `keep-ipc` |
| `workbenchBrowser:goBack` | `keep-ipc` |
| `workbenchBrowser:goForward` | `keep-ipc` |
| `workbenchBrowser:navigate` | `keep-ipc` |
| `workbenchBrowser:openExternal` | `keep-ipc` |
| `workbenchBrowser:reload` | `keep-ipc` |
| `workbenchBrowser:resetZoom` | `keep-ipc` |
| `workbenchBrowser:setBounds` | `keep-ipc` |
| `workbenchBrowser:stopFindInPage` | `keep-ipc` |
| `workbenchBrowser:toggleDevTools` | `keep-ipc` |
| `workbenchBrowser:zoomIn` | `keep-ipc` |
| `workbenchBrowser:zoomOut` | `keep-ipc` |

### `electron/ipc/registerWorkbenchSessionHandlers.ts` (14)

| Channel | Disposition |
| --- | --- |
| `workbenchSession:activateSession` | `keep-ipc` |
| `workbenchSession:backgroundSession` | `keep-ipc` |
| `workbenchSession:bindBrowser` | `keep-ipc` |
| `workbenchSession:bindTerminal` | `keep-ipc` |
| `workbenchSession:closeSession` | `keep-ipc` |
| `workbenchSession:ensureSession` | `keep-ipc` |
| `workbenchSession:getBrowserBinding` | `keep-ipc` |
| `workbenchSession:getSession` | `keep-ipc` |
| `workbenchSession:getTerminalBinding` | `keep-ipc` |
| `workbenchSession:listSessions` | `keep-ipc` |
| `workbenchSession:releaseBrowser` | `keep-ipc` |
| `workbenchSession:releaseTerminal` | `keep-ipc` |
| `workbenchSession:setNativePreviewSession` | `keep-ipc` |
| `workbenchSession:setPinned` | `keep-ipc` |

### `electron/ipc/registerWorkspaceHandlers.ts` (13)

| Channel | Disposition |
| --- | --- |
| `workspace:bindExistingFolder` | `keep-ipc` |
| `workspace:cloneForProject` | `keep-ipc` |
| `workspace:createForProject` | `keep-ipc` |
| `workspace:forget` | `keep-ipc` |
| `workspace:getActiveForProject` | `keep-ipc` |
| `workspace:getCatalogSnapshot` | `keep-ipc` |
| `workspace:importExistingFolder` | `keep-ipc` |
| `workspace:listCandidates` | `keep-ipc` |
| `workspace:listForProject` | `keep-ipc` |
| `workspace:openInFinder` | `keep-ipc` |
| `workspace:resolveProject` | `keep-ipc` |
| `workspace:setActiveForProject` | `keep-ipc` |
| `workspace:verify` | `keep-ipc` |

### `electron/ipc/registerWorkspaceSyncHandlers.ts` (37)

| Channel | Disposition |
| --- | --- |
| `workspaceSync:ackOps` | `keep-ipc` |
| `workspaceSync:deleteFiles` | `keep-ipc` |
| `workspaceSync:enqueueOps` | `keep-ipc` |
| `workspaceSync:getGitRuntimeHealth` | `move-to-server-rpc` |
| `workspaceSync:getJournalState` | `keep-ipc` |
| `workspaceSync:gitAdoptWorkspace` | `move-to-server-rpc` |
| `workspaceSync:gitCaptureCheckpoint` | `delete` |
| `workspaceSync:gitClassifyRepoHealth` | `move-to-server-rpc` |
| `workspaceSync:gitCloneIfMissing` | `move-to-server-rpc` |
| `workspaceSync:gitCommitAll` | `move-to-server-rpc` |
| `workspaceSync:gitCommitAndPush` | `move-to-server-rpc` |
| `workspaceSync:gitDeleteAllCheckpointRefs` | `delete` |
| `workspaceSync:gitDeleteCheckpointRefs` | `delete` |
| `workspaceSync:gitDiffCheckpoints` | `delete` |
| `workspaceSync:gitEnsureRepo` | `move-to-server-rpc` |
| `workspaceSync:gitFetchMain` | `move-to-server-rpc` |
| `workspaceSync:gitGetHeadDiffStats` | `move-to-server-rpc` |
| `workspaceSync:gitListChanges` | `move-to-server-rpc` |
| `workspaceSync:gitPullMain` | `move-to-server-rpc` |
| `workspaceSync:gitPushMain` | `move-to-server-rpc` |
| `workspaceSync:gitReadChanges` | `move-to-server-rpc` |
| `workspaceSync:gitReadChangesPatch` | `move-to-server-rpc` |
| `workspaceSync:gitReadCheckpointFilePair` | `delete` |
| `workspaceSync:gitReadConflictFile` | `keep-ipc` |
| `workspaceSync:gitReplayLocalCommits` | `move-to-server-rpc` |
| `workspaceSync:gitResolveConflictFile` | `keep-ipc` |
| `workspaceSync:gitRestoreMain` | `move-to-server-rpc` |
| `workspaceSync:gitSalvageReclone` | `move-to-server-rpc` |
| `workspaceSync:gitStatus` | `move-to-server-rpc` |
| `workspaceSync:hashFile` | `keep-ipc` |
| `workspaceSync:mergePreview` | `keep-ipc` |
| `workspaceSync:mergeTreePreview` | `keep-ipc` |
| `workspaceSync:subscribeGitChanges` | `move-to-server-rpc` |
| `workspaceSync:subscribeGitDirtyState` | `move-to-server-rpc` |
| `workspaceSync:unsubscribeGitChanges` | `move-to-server-rpc` |
| `workspaceSync:unsubscribeGitDirtyState` | `move-to-server-rpc` |
| `workspaceSync:writeFiles` | `keep-ipc` |

### `electron/ipc/registerYjsHandlers.ts` (1)

| Channel | Disposition |
| --- | --- |
| `yjs:setInterestRoots` | `keep-ipc` |

### `electron/main.ts` (1)

| Channel | Disposition |
| --- | --- |
| `assistantRuntime:getStatus` | `move-to-server-rpc` |

### `electron/services/AgentToolService.ts` (5)

| Channel | Disposition |
| --- | --- |
| `agentTools:getStatus` | `move-to-server-rpc` |
| `agentTools:loginCancel` | `move-to-server-rpc` |
| `agentTools:loginInput` | `move-to-server-rpc` |
| `agentTools:loginStart` | `move-to-server-rpc` |
| `agentTools:prepare` | `move-to-server-rpc` |

### `electron/services/CollabEncryptionService.ts` (8)

| Channel | Disposition |
| --- | --- |
| `collab:createRecoveryKit` | `keep-ipc` |
| `collab:deleteDeviceIdentity` | `keep-ipc` |
| `collab:ensureDeviceIdentity` | `keep-ipc` |
| `collab:getStoredDeviceIdentity` | `keep-ipc` |
| `collab:isEncryptionAvailable` | `keep-ipc` |
| `collab:unwrapRecoveryKit` | `keep-ipc` |
| `collab:unwrapRoomKey` | `keep-ipc` |
| `collab:wrapRoomKey` | `keep-ipc` |

### `electron/services/IntegrationService.ts` (15)

| Channel | Disposition |
| --- | --- |
| `integrations:createRepository` | `move-to-server-rpc` |
| `integrations:deleteKey` | `move-to-server-rpc` |
| `integrations:encrypt` | `move-to-server-rpc` |
| `integrations:generateKey` | `move-to-server-rpc` |
| `integrations:getToolDefinition` | `move-to-server-rpc` |
| `integrations:isEncryptionAvailable` | `move-to-server-rpc` |
| `integrations:isToolAvailable` | `move-to-server-rpc` |
| `integrations:keyExists` | `move-to-server-rpc` |
| `integrations:listRepositories` | `move-to-server-rpc` |
| `integrations:listRepositoryOwners` | `move-to-server-rpc` |
| `integrations:listTools` | `move-to-server-rpc` |
| `integrations:runTool` | `move-to-server-rpc` |
| `integrations:startOAuth` | `move-to-server-rpc` |
| `integrations:storeKey` | `move-to-server-rpc` |
| `integrations:syncRepositoryAccess` | `move-to-server-rpc` |

### `electron/services/TerminalService.ts` (11)

| Channel | Disposition |
| --- | --- |
| `terminal:attachView` | `move-to-server-rpc` |
| `terminal:create` | `move-to-server-rpc` |
| `terminal:detachView` | `move-to-server-rpc` |
| `terminal:getInfo` | `move-to-server-rpc` |
| `terminal:getOutputEventsSince` | `move-to-server-rpc` |
| `terminal:getProfiles` | `move-to-server-rpc` |
| `terminal:getSnapshot` | `move-to-server-rpc` |
| `terminal:input` | `move-to-server-rpc` |
| `terminal:kill` | `move-to-server-rpc` |
| `terminal:list` | `move-to-server-rpc` |
| `terminal:resize` | `move-to-server-rpc` |
