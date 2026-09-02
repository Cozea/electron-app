# Loading State Inventory

Last reviewed: 2026-04-13

## Current Status

The 2026-04-13 desktop-loading refactor already removed or softened several of the most visible gates:

- common settings/admin route `Suspense` loaders were removed by eagerly importing those surfaces in [routes.tsx](<home>/Downloads/electron-app-main/src/router/routes.tsx)
- [General.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/General.tsx) no longer shows a visible `Loading workspace settings…` banner
- [Members.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Members.tsx), [Roles.tsx](<home>/Downloads/electron-app-main/src/pages/teams/Roles.tsx), and [MemberDetails.tsx](<home>/Downloads/electron-app-main/src/pages/teams/MemberDetails.tsx) now render shell-first and only use inline background-refresh copy
- [SourceControl.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/SourceControl.tsx) now renders immediately and keeps controls disabled until the connection snapshot is known instead of showing page-level loading cards
- [BillingContent.tsx](<home>/Downloads/electron-app-main/src/pages/workspace/billing/BillingContent.tsx) now keeps the seat-assignment table visible and uses inline refresh text instead of replacing the table with a loading row
- [ProjectWorkbenchPage.tsx](<home>/Downloads/electron-app-main/src/features/projects/pages/ProjectWorkbenchPage.tsx) no longer blocks on the workbench slice existing before rendering the shell
- several local-only pages now use calmer empty-state language instead of explicit `Checking…` / `Loading…` copy:
  - [Storage.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Storage.tsx)
  - [Tooling.tsx](<home>/Downloads/electron-app-main/src/pages/settings/Tooling.tsx)
  - [ProjectSidebar.tsx](<home>/Downloads/electron-app-main/src/features/projects/components/ProjectSidebar.tsx)

The lists below still include the remaining gates and mixed states that should be reviewed later.

This inventory is split for a desktop app mindset:

- `cloud data loading gates`: waiting on auth, Convex, server routes, provider APIs, or other remote data
- `local / code / desktop runtime loading gates`: waiting on lazy chunks, Electron IPC, filesystem, PTY, git, simulators, browser views, or other local runtime setup
- `mixed gates`: one visible loading state hides both cloud and local work

This focuses on user-facing loading UI and silent loading states that disable or defer UI in `src/`.

## Cloud Data Loading Gates

These are the loaders we should treat as real remote-data waits.

### App / Auth / Scope Resolution

- Full app boot spinner in `src/App.tsx`
- Auth gate `Loading workspace…` in `src/router/routes.tsx`
- Workspace resolution gate `Resolving workspace…` in `src/router/routes.tsx`

### Personal Settings

- Profile-backed account settings silently loading in `src/pages/settings/Account.tsx`

### Workspace Settings

- `Loading workspace settings…` in `src/pages/workspace/General.tsx`
- Billing summary, seat, and invoice loaders in:
  - `src/pages/workspace/billing/BillingContent.tsx`
  - `src/pages/workspace/billing/useBillingController.ts`
- Integrations connection state and provider/API loading in:
  - `src/pages/workspace/Integrations.tsx`
  - `src/components/integrations/IntegrationConnectDialog.tsx`
  - `src/components/integrations/ApiKeyForm.tsx`
  - `src/components/integrations/ServiceAccountForm.tsx`
  - `src/components/integrations/IntegrationCard.tsx`
- Source control connection and namespace loading in `src/pages/workspace/SourceControl.tsx`

### Workspace People / Admin

- `Loading members...` in `src/pages/teams/Members.tsx`
- `Loading member details...` in `src/pages/teams/MemberDetails.tsx`
- `Loading workspace roles…` in `src/pages/teams/Roles.tsx`

### Workspace / Project Entry

- Workspace launch gating in `src/features/projects/pages/ProjectsLaunchPage.tsx`
- Project invite / join data loading in:
  - `src/features/projects/pages/ProjectJoinPage.tsx`
  - `src/features/projects/pages/ProjectInvitePage.tsx`
- Login spinner in `src/components/login-form.tsx`

### Project Lists / Headers / Sharing

- `Loading projects…` in `src/features/projects/components/ProjectSidebar.tsx`
- Inbox dropdown loading in `src/components/layouts/unified-header/HeaderInboxButton.tsx`
- Share dialog data loading in `src/components/layouts/unified-header/HeaderProjectShareButton.tsx`
- Project-level sync/loading state in `src/features/projects/components/ProjectSyncIndicator.tsx`

### Project Pages

- `Loading project settings…` in `src/features/projects/pages/ProjectSettingsPage.tsx`
- `Loading project team…` in `src/features/projects/pages/ProjectTeamPage.tsx`
- `Loading tasks…` and `Loading people...` in `src/features/projects/pages/TasksPage.tsx`
- Comments/change selection loading in `src/features/projects/pages/ChangesPage.tsx`

### Silent Cloud-Backed Loading

- Workspace general data in `src/hooks/useScopedGeneralData.ts`
- Workspace people data in `src/hooks/useScopedWorkspacePeopleData.ts`
- Member details data in `src/hooks/useScopedMemberDetailsData.ts`
- Project workspace context in `src/features/projects/hooks/useProjectWorkspaceContext.ts`
- Project presence in `src/hooks/useProjectPresence.ts`

## Local / Code / Desktop Runtime Loading Gates

These are not network waits. They are chunk loads, local state restore, local git/runtime setup, or Electron-native work.

### Route Code-Splitting / Suspense

All of these use `Suspense` + `RouteLoading` in `src/router/routes.tsx`, so they are local code-load gates, not data fetches:

- `Loading project invite…`
- `Loading project…`
- `Loading settings…`
- `Loading billing…`
- `Loading integrations…`
- `Loading source control…`
- `Loading account settings…`
- `Loading appearance settings…`
- `Loading storage settings…`
- `Loading tooling settings…`
- `Loading team members…`
- `Loading member details…`
- `Loading roles…`
- `Loading policies…`
- `Loading invitation…`
- `Loading workspaces…`
- `Loading workspace setup…`

Shared component:

- `RouteLoading` in `src/router/RouteLoading.tsx`

### Shared Local Loading Primitives

- Skeleton primitive in `src/components/ui/skeleton.tsx`
- Sidebar skeleton rows in `src/components/ui/sidebar.tsx`
- Assistant loading toasts in `src/features/projects/components/assistant/ui/toast.tsx`
- Presence spinner in `src/components/presence/PresenceAvatarGroup.tsx`

### Personal Settings

- Storage page loading in `src/pages/settings/Storage.tsx`
  - disk snapshot
  - local projects table
  - local destructive actions
- Tooling page loading in `src/pages/settings/Tooling.tsx`
  - git runtime check
  - local runtime inventory check
- Appearance page has no dedicated in-page loader beyond route chunk loading

### Desktop Runtime / Git / Filesystem

- Repository owner/repository loading in:
  - `src/components/git/RepositoryProvisioner.tsx`
  - `src/components/git/ConnectedRepositoryPicker.tsx`
- Local workspace creation UI validation in `src/components/workspaces/CreateWorkspaceDialog.tsx`
- Local git inspection in `src/features/projects/components/CreateProjectDialog.tsx`
- Legacy redirect spinner in `src/features/projects/pages/LegacyProjectRedirectPage.tsx`
- Project conflicts local loading in `src/features/projects/pages/ProjectConflictsPage.tsx`

### Workbench Shell / Panels

- `Loading workbench…` in `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- Lazy panel fallback `Loading panel…` in `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`
- Workbench lane restore/loading in `src/features/projects/hooks/useProjectLaneState.ts`

### Workbench Tiles

- Terminal boot `Preparing terminal…` in `src/features/projects/components/workbench/WorkbenchTerminalTile.tsx`
- Branch control local fetch/switch spinner in `src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx`
- Dev server preview startup in `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`
- Native iOS preview runtime loading in `src/features/projects/components/previews/IosSimulatorViewport.tsx`
- Browser tile local load/overlay state in:
  - `src/features/projects/browser/browserTileModel.ts`
  - `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- Assistant diff loading in `src/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog.tsx`
- Assistant local runtime/config loading in:
  - `src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts`
  - `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx`
  - `src/features/projects/components/workbench/assistant/useAssistantServerConfig.ts`

## Mixed Gates

These are the places where one visible loading state hides both remote and local work.

### New Project / Import Flows

- `src/pages/NewProject.tsx`
  - can involve immediate local picker/runtime work
  - can also lead into project creation mutations
- `src/features/projects/components/CreateProjectDialog.tsx`
  - local git inspection
  - owner/provider loading
  - project creation submit

### Workspace Creation

- `src/components/workspaces/CreateWorkspaceDialog.tsx`
  - local validation feel
  - workspace creation is still remote data creation

### Integrations / Source Control

- `src/pages/workspace/Integrations.tsx`
- `src/pages/workspace/SourceControl.tsx`
- `src/components/git/RepositoryProvisioner.tsx`
- `src/components/git/ConnectedRepositoryPicker.tsx`

These are mixed because the visible loader often combines:

- remote provider/account data
- local dialog state
- local menu/control disable states

### Project Pages With Split Context

- `src/features/projects/pages/TasksPage.tsx`
  - tasks / people are cloud-backed
  - preview/file context loading is local
- `src/features/projects/pages/ChangesPage.tsx`
  - comments are cloud-backed
  - diff preview/update states can be local/runtime-driven
- `src/features/projects/pages/ProjectWorkbenchPage.tsx`
  - project/workspace route context is cloud-backed
  - workbench session/lane restoration is local

## Cleanup Lens

Now that the inventory is split correctly for a desktop app, the cleanup work should probably treat these as different classes:

- `cloud gates`
  - okay to be more explicit
  - should explain what data is being resolved
- `local/runtime gates`
  - should feel faster and lighter
  - often should avoid full-screen blockers
- `mixed gates`
  - should probably be decomposed so local prep does not masquerade as remote waiting

## Suggested Next Pass

If we want to simplify this systematically, the clean next step is to mark every item with one of:

- `cloud`
- `local`
- `mixed`

and then separately decide:

- which ones deserve a blocking loader
- which ones should become inline progress only
- which ones should become optimistic with no loader at all
