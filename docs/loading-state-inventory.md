# Loading State Inventory

Last reviewed: 2026-04-13

This is a user-facing inventory of loading UI across the app:

- route fallbacks
- full-page boot/loading shells
- in-page loading messages
- spinners on buttons and menus
- shimmer/skeleton states
- silent loading states that only disable controls

This intentionally excludes backend-only `pending` enums and internal non-UI async state in `electron/`, `convex/`, and `server/` unless they surface visible loading UI in `src/`.

## Global App Shell

- `App` full-screen workspace boot spinner in `src/App.tsx`
- Shared route fallback spinner component `RouteLoading` in `src/router/RouteLoading.tsx`
- Auth gate fallback `Loading workspace…` in `src/router/routes.tsx`
- Workspace resolution fallback `Resolving workspace…` in `src/router/routes.tsx`

## Route-Level Lazy Loading

These all use `Suspense` + `RouteLoading` via `createLazyRouteComponent` in `src/router/routes.tsx`.

- `Loading project invite…` for:
  - `ProjectJoinPage`
  - `ProjectInvitePage`
- `Loading project…` for `LegacyProjectRedirectPage`
- `Loading settings…` for workspace/personal general settings
- `Loading billing…` for billing
- `Loading integrations…` for integrations / CLI tools
- `Loading source control…` for source control
- `Loading account settings…` for account
- `Loading appearance settings…` for appearance
- `Loading storage settings…` for storage
- `Loading tooling settings…` for tooling
- `Loading team members…` for members
- `Loading member details…` for member details
- `Loading roles…` for roles
- `Loading policies…` for policies
- `Loading invitation…` for invitation acceptance
- `Loading workspaces…` for workspace selector
- `Loading workspace setup…` for workspace creation

## Shared Loading Primitives

- Generic skeleton primitive in `src/components/ui/skeleton.tsx`
- Sidebar menu skeleton rows in `src/components/ui/sidebar.tsx`
- Loading toast visual state in `src/features/projects/components/assistant/ui/toast.tsx`
- Presence spinner in `src/components/presence/PresenceAvatarGroup.tsx`

## Personal Settings

### Account

- Silent profile-loading state disables notification toggles in `src/pages/settings/Account.tsx`

### Appearance

- No dedicated loading UI found beyond route-level loading

### Storage

- Initial storage snapshot load in `src/pages/settings/Storage.tsx`
- Initial local-projects table load in `src/pages/settings/Storage.tsx`
- `Loading projects...` in the projects table in `src/pages/settings/Storage.tsx`
- Action spinners in `src/pages/settings/Storage.tsx` for:
  - `Clear cache`
  - `Clear logs`
  - `Refresh`
  - `Change` project directory
  - `Delete selected`
  - per-project delete
  - `Clear all local data`

### Tooling

- `Checking git runtime...` state in `src/pages/settings/Tooling.tsx`
- Git runtime spinner in `src/pages/settings/Tooling.tsx`
- `Checking runtime inventory...` state in `src/pages/settings/Tooling.tsx`

## Workspace Settings

### General

- `Loading workspace settings…` in `src/pages/workspace/General.tsx`
- Save spinner in `src/pages/workspace/General.tsx`
- Delete workspace spinner in `src/pages/workspace/General.tsx`

### Billing

- Manage billing portal action spinner in `src/pages/workspace/billing/BillingContent.tsx`
- Change-plan action spinners in `src/pages/workspace/billing/BillingContent.tsx`
- Seat-assignment action spinners in `src/pages/workspace/billing/BillingContent.tsx`
- `Loading workspace members...` inside billing seat coverage in `src/pages/workspace/billing/BillingContent.tsx`
- Invoice-history spinner in `src/pages/workspace/billing/BillingContent.tsx`
- `Loading invoices...` empty-state label from `src/pages/workspace/billing/useBillingController.ts`

### Integrations / CLI Tools

- Connect/disconnect pending states in `src/pages/workspace/Integrations.tsx` via:
  - `src/components/integrations/IntegrationConnectDialog.tsx`
  - `src/components/integrations/ApiKeyForm.tsx`
  - `src/components/integrations/ServiceAccountForm.tsx`
  - `src/components/integrations/IntegrationCard.tsx`
- Repository owner/repository loading in `src/components/git/RepositoryProvisioner.tsx`
- `Loading repositories...` / `Loading...` / repository refresh spinner in `src/components/git/RepositoryProvisioner.tsx`
- Remote repository pagination and branch loading in `src/components/git/ConnectedRepositoryPicker.tsx`
- `Loading repositories...`, `Loading more repositories...`, and branch `Loading...` in `src/components/git/ConnectedRepositoryPicker.tsx`

### Source Control

- Page-level `Loading GitHub settings…` in `src/pages/workspace/SourceControl.tsx`
- Page-level `Loading source control connections…` in `src/pages/workspace/SourceControl.tsx`
- Namespace/owner loading in `src/pages/workspace/SourceControl.tsx`
- `Loading namespaces…` in the namespace selector in `src/pages/workspace/SourceControl.tsx`
- Refresh / reconnect / connect action spinners in `src/pages/workspace/SourceControl.tsx`

### Policies

- No dedicated in-page loading UI found beyond route-level loading

## Workspace People / Admin Pages

### Members

- `Loading members...` in `src/pages/teams/Members.tsx`
- Invite action spinner in `src/pages/teams/Members.tsx`
- Member row action loading is handled through pending menu actions in `src/pages/teams/Members.tsx`

### Member Details

- `Loading member details...` in `src/pages/teams/MemberDetails.tsx`
- Organization-members count fallback `Loading...` in `src/pages/teams/MemberDetails.tsx`

### Roles

- `Loading workspace roles…` in `src/pages/teams/Roles.tsx`
- Role create/update/delete action spinners in `src/pages/teams/Roles.tsx`

## Auth / Workspace Entry

- Login button spinner in `src/components/login-form.tsx`
- Full app auth boot spinner in `src/App.tsx`
- Workspace launch spinner and empty-state loading shell in `src/features/projects/pages/ProjectsLaunchPage.tsx`
- `Loading workspace` and `Loading projects` variants in `src/features/projects/pages/ProjectsLaunchPage.tsx`
- New project import flow spinner in `src/pages/NewProject.tsx`
- Workspace creation dialog validation and submit spinners in `src/components/workspaces/CreateWorkspaceDialog.tsx`

## Project Entry / Invite / Redirect Flow

- Project join page full-card loading state in `src/features/projects/pages/ProjectJoinPage.tsx`
- Project join page action spinner for join/login in `src/features/projects/pages/ProjectJoinPage.tsx`
- Project invite page full-card loading state in `src/features/projects/pages/ProjectInvitePage.tsx`
- Project invite page action spinners for accept / decline / login / logout in `src/features/projects/pages/ProjectInvitePage.tsx`
- Legacy project redirect spinner in `src/features/projects/pages/LegacyProjectRedirectPage.tsx`

## Project Shell / Sidebar / Header

- `Loading projects…` in `src/features/projects/components/ProjectSidebar.tsx`
- Project row action spinner in `src/features/projects/components/ProjectSidebar.tsx`
- Sync indicator spin state in `src/features/projects/components/ProjectSyncIndicator.tsx`
- Header inbox dropdown `Loading...` state in `src/components/layouts/unified-header/HeaderInboxButton.tsx`
- Header share menu `Loading project sharing settings…` in `src/components/layouts/unified-header/HeaderProjectShareButton.tsx`
- Header share menu `Loading contacts…` in `src/components/layouts/unified-header/HeaderProjectShareButton.tsx`
- Header share menu action spinners for invite/cancel/resend/remove/role/link operations in `src/components/layouts/unified-header/HeaderProjectShareButton.tsx`

## Project Pages

### Workbench

- `Loading workbench…` in `src/features/projects/pages/ProjectWorkbenchPage.tsx`
- Lazy workbench panel fallback `Loading panel…` in `src/features/projects/components/workbench/WorkbenchDockPanels.tsx`

### Project Settings

- `Loading project settings…` in `src/features/projects/pages/ProjectSettingsPage.tsx`
- Save/archive/delete action spinners in `src/features/projects/pages/ProjectSettingsPage.tsx`

### Project Team

- `Loading project team…` in `src/features/projects/pages/ProjectTeamPage.tsx`
- Invite/member mutation spinners in `src/features/projects/pages/ProjectTeamPage.tsx`

### Tasks

- `Loading tasks…` in `src/features/projects/pages/TasksPage.tsx`
- `Loading people...` in assignee picker in `src/features/projects/pages/TasksPage.tsx`
- `Loading previews...` / `Loading files...` in task context pickers in `src/features/projects/pages/TasksPage.tsx`
- Task action spinners in `src/features/projects/pages/TasksPage.tsx`

### Changes

- `Loading comments…` shimmer in `src/features/projects/pages/ChangesPage.tsx`
- `Updating…` shimmer in `src/features/projects/pages/ChangesPage.tsx`
- `Loading diff preview...` in `src/features/projects/components/changes/DiffPanel.tsx`
- `Loading selected diff...` in `src/features/projects/components/changes/DiffPanel.tsx`

### Conflicts

- `Loading conflicts…` in `src/features/projects/pages/ProjectConflictsPage.tsx`
- Conflict status refresh spinner in `src/features/projects/pages/ProjectConflictsPage.tsx`
- File-content loading spinner in `src/features/projects/pages/ProjectConflictsPage.tsx`
- Resolve/save spinner in `src/features/projects/pages/ProjectConflictsPage.tsx`

## Workbench Tiles / Embedded Tools

### Terminal

- `Preparing terminal…` in `src/features/projects/components/workbench/WorkbenchTerminalTile.tsx`

### Branch Control

- Branch fetch/switch spinner in `src/features/projects/components/workbench/WorkbenchHeaderBranchControl.tsx`

### Dev Server / Preview

- `Starting preview…` empty state in `src/features/projects/components/workbench/WorkbenchDevServerTile.tsx`
- Native iOS preview loading states in `src/features/projects/components/previews/IosSimulatorViewport.tsx`:
  - `Loading iOS simulators...`
  - `Starting native preview session...`
- Native-preview action/state loading is wired through `src/features/projects/hooks/useIosNativePreview.ts`

### Browser Tile

- Browser load state exists in `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- Current visible loading is mostly indirect through tile readiness / overlay handling, not a dedicated text loader

### Assistant

- Assistant composer interrupt spinner in `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx`
- Assistant pending-user-input submit label `Submitting...` in `src/features/projects/components/assistant/chat/CozeaChatSurface.tsx`
- Assistant diff dialog `Loading diff…` in `src/features/projects/components/workbench/assistant/WorkbenchAssistantDiffDialog.tsx`
- Assistant config-loading state is tracked in:
  - `src/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore.ts`
  - `src/features/projects/components/workbench/assistant/useWorkbenchAssistantTileController.tsx`
  - `src/features/projects/components/workbench/assistant/useAssistantServerConfig.ts`

## Project / Workspace Creation Dialogs

### Create Project Dialog

- Local git inspection spinner in `src/features/projects/components/CreateProjectDialog.tsx`
- Owner loading in the remote-creation fallback flow in `src/features/projects/components/CreateProjectDialog.tsx`
- Submit spinner in `src/features/projects/components/CreateProjectDialog.tsx`

### Create Workspace Dialog

- Slug/name validation spinner in `src/components/workspaces/CreateWorkspaceDialog.tsx`
- Submit spinner in `src/components/workspaces/CreateWorkspaceDialog.tsx`

## Things That Currently Load Silently

These have real loading state, but the UI mostly responds by disabling controls or deferring render instead of showing a dedicated loader.

- Personal account profile fetch in `src/pages/settings/Account.tsx`
- Workspace general settings fetch in `src/hooks/useScopedGeneralData.ts`
- Workspace people fetches in `src/hooks/useScopedWorkspacePeopleData.ts`
- Member-details data assembly in `src/hooks/useScopedMemberDetailsData.ts`
- Project workspace context fetch in `src/features/projects/hooks/useProjectWorkspaceContext.ts`
- Project presence fetch in `src/hooks/useProjectPresence.ts`
- Workbench browser tile loading flags in `src/features/projects/browser/browserTileModel.ts` and `src/features/projects/components/workbench/useWorkbenchBrowserView.ts`
- Project lane restore/loading state in `src/features/projects/hooks/useProjectLaneState.ts`

## Notes For Cleanup

Patterns currently in use:

- full-screen spinner shell
- route-level spinner shell
- centered page/card spinner
- inline button spinner
- shimmer text placeholder
- skeleton rows
- silent disabled-controls loading

There is clear consolidation room here:

- route/page loaders could share fewer variants
- table loaders could use one shared row pattern
- silent loading vs visible loading is inconsistent between settings pages
- some action spinners are text-only and some are icon-only
