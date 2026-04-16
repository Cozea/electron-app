# SaaS Removal / Hosted Collab Refactor Map

Last reviewed: 2026-04-16

## Implementation Status

### Completed on the active path

- hosted runtime workspaces removed from the active server runtime path
- workspace/billing/admin/source-control SaaS routes redirected out of the active app flow
- local device-backed Convex profile bootstrap added
- app startup now falls back to a local device profile instead of requiring hosted login
- collaboration session bootstrap no longer requires WorkOS access tokens on the client
- collaboration session issuance no longer enforces billing/seat entitlements on the server
- collab session auth now resolves through a device-backed local profile on the server
- project collaboration access now accepts trusted device identity on the server path
- join links and invite acceptance now trust the current device during project access grant
- invite/join acceptance pages no longer depend on hosted sign-in or email-account matching
- project collaborator listings now expose device-native labels and contact emails on the active path
- legacy account-shaped inbox UI is removed from the local-device header path

### Still deferred

- full deletion of legacy SaaS pages/components/modules that are no longer on the active path
- full removal of WorkOS auth/session plumbing from Electron and the server
- full schema slimming away from organization/workspace-era tables

## Goal

Refactor Cozea from a SaaS-shaped desktop app into:

- a local-first desktop product
- with a hosted collaboration service
- without login
- without billing
- without workspace/org account management
- without source-control account linking

The product should keep collaboration and core desktop functionality, but remove the SaaS control plane.

## Product Boundary

### Keep

- local project creation and local project import
- project workbench
- terminal / browser / preview / simulator tiles
- AI agent tiles
- live collaboration
- presence / awareness
- encrypted collaboration
- collaborator invites
- collaborator roles
- device trust / revocation / recovery
- manual git workflows

### Remove

- WorkOS login
- user accounts as SaaS identities
- personal vs workspace account scopes
- Stripe billing
- subscription plans
- credit packs / invoices / overage handling
- seat limits
- GitHub / GitLab OAuth account linking
- workspace-level admin settings
- workspace-level source-control configuration

### Important constraint

This map assumes:

- the server remains hosted for collaboration
- the desktop app is fully usable without logging into a hosted account
- git stays local/manual
- collaboration trust is based on device identity and project membership

## New Core Model

The top-level shared object should become a **project**, not a workspace/org/account.

The durable collaboration model becomes:

- `Project`
- `Project collaborator`
- `Project invite`
- `Trusted device`
- `Encrypted room key`
- `Recovery kit`

The mental model becomes:

- Cozea project = the collaborative container
- trusted devices = identity
- hosted collab service = realtime/persistence layer
- git = optional local tool

## Identity Model Replacement

Replace account login with device identity.

### New identity principle

- each device gets a signing/encryption identity on first launch
- private key stays in OS secure storage
- public key is registered with the collab backend
- project membership is granted to devices, not SaaS users/workspaces

### Existing foundations we can reuse

- [electron/collabKeys.ts](../electron/collabKeys.ts)
- [electron/services/CollabEncryptionService.ts](../electron/services/CollabEncryptionService.ts)
- [src/hooks/useCollabSession.ts](../src/hooks/useCollabSession.ts)
- [src/contexts/YjsProjectContext.tsx](../src/contexts/YjsProjectContext.tsx)
- [convex/yjs.ts](../convex/yjs.ts)

### What changes

- remove dependency on WorkOS-backed user identity for collaboration
- replace user/workspace-scoped access checks with project/device trust checks
- make invite acceptance bind a device into a project trust set

## Server Scope After Refactor

### Keep on the server

- collaboration websocket gateway
- encrypted update persistence
- project invite / join flows
- device trust management
- recovery / key rotation endpoints
- minimal project collaboration metadata APIs

### Optional

- runtime workspaces

This is the one major architectural fork left.

If runtime workspaces stay:

- the server is more than a collab service
- it remains a collab + runtime control plane

If runtime workspaces go local-only:

- the server can become a much smaller collaboration service

## File Map

## 1. Frontend routes and pages

### Delete

- [src/pages/Login.tsx](../src/pages/Login.tsx)
- [src/pages/WorkspaceCreate.tsx](../src/pages/WorkspaceCreate.tsx)
- [src/pages/WorkspaceSelect.tsx](../src/pages/WorkspaceSelect.tsx)
- [src/pages/AcceptInvitation.tsx](../src/pages/AcceptInvitation.tsx)
- [src/pages/workspace/Billing.tsx](../src/pages/workspace/Billing.tsx)
- [src/pages/workspace/billing/BillingContent.tsx](../src/pages/workspace/billing/BillingContent.tsx)
- [src/pages/workspace/billing/billingShared.ts](../src/pages/workspace/billing/billingShared.ts)
- [src/pages/workspace/billing/useBillingController.ts](../src/pages/workspace/billing/useBillingController.ts)
- [src/pages/workspace/General.tsx](../src/pages/workspace/General.tsx)
- [src/pages/workspace/SourceControl.tsx](../src/pages/workspace/SourceControl.tsx)
- [src/pages/workspace/Policies.tsx](../src/pages/workspace/Policies.tsx)
- [src/pages/workspace/Integrations.tsx](../src/pages/workspace/Integrations.tsx)
- [src/pages/teams/Members.tsx](../src/pages/teams/Members.tsx)
- [src/pages/teams/Roles.tsx](../src/pages/teams/Roles.tsx)
- [src/pages/teams/MemberDetails.tsx](../src/pages/teams/MemberDetails.tsx)

### Rewrite

- [src/router/routes.tsx](../src/router/routes.tsx)
  - remove login/workspace/billing/source-control SaaS routes
  - collapse settings to app settings + project settings + collaborators
- [src/features/projects/pages/ProjectTeamPage.tsx](../src/features/projects/pages/ProjectTeamPage.tsx)
  - make it the primary collaborator management page
- [src/features/projects/pages/ProjectInvitePage.tsx](../src/features/projects/pages/ProjectInvitePage.tsx)
  - turn into device/project invite acceptance, not account/workspace join
- [src/features/projects/pages/ProjectJoinPage.tsx](../src/features/projects/pages/ProjectJoinPage.tsx)
  - rewrite around device trust and project access
- [src/features/projects/pages/ProjectSettingsPage.tsx](../src/features/projects/pages/ProjectSettingsPage.tsx)
  - remove SaaS/admin sections
  - keep project-local settings and collab security controls
- [src/pages/settings/Account.tsx](../src/pages/settings/Account.tsx)
  - replace account-profile semantics with device/app identity semantics

### Keep

- [src/pages/settings/Appearance.tsx](../src/pages/settings/Appearance.tsx)
- [src/pages/settings/Storage.tsx](../src/pages/settings/Storage.tsx)
- [src/pages/settings/Tooling.tsx](../src/pages/settings/Tooling.tsx)
- [src/features/projects/pages/ProjectWorkbenchPage.tsx](../src/features/projects/pages/ProjectWorkbenchPage.tsx)
- [src/features/projects/pages/ChangesPage.tsx](../src/features/projects/pages/ChangesPage.tsx)
- [src/features/projects/pages/TasksPage.tsx](../src/features/projects/pages/TasksPage.tsx)
- [src/features/projects/pages/AppStorePage.tsx](../src/features/projects/pages/AppStorePage.tsx)

## 2. Settings and navigation system

### Rewrite heavily

- [src/lib/settings/settingsRegistry.ts](../src/lib/settings/settingsRegistry.ts)
- [src/lib/settings/settingsNavigation.ts](../src/lib/settings/settingsNavigation.ts)
- [src/features/projects/components/SettingsSidebar.tsx](../src/features/projects/components/SettingsSidebar.tsx)
- [src/components/settings/SettingsDrawer.tsx](../src/components/settings/SettingsDrawer.tsx)

### Target

Replace:

- personal settings
- workspace settings
- billing/settings/admin surfaces

With:

- app settings
- project settings
- collaborators
- optional repository tools

## 3. Project collaboration UI

### Rewrite

- [src/components/layouts/unified-header/HeaderProjectShareButton.tsx](../src/components/layouts/unified-header/HeaderProjectShareButton.tsx)
  - remove workspace/source-control assumptions
  - make it pure project collaborator invite/role/join-link UI
- [src/components/layouts/unified-header/HeaderInboxButton.tsx](../src/components/layouts/unified-header/HeaderInboxButton.tsx)
  - stop depending on personal/workspace invite models
  - switch to project invite inbox if inbox remains
- [src/features/projects/components/ProjectSidebar.tsx](../src/features/projects/components/ProjectSidebar.tsx)
  - remove workspace/admin entry assumptions
- [src/features/projects/layouts/ProjectLayout.tsx](../src/features/projects/layouts/ProjectLayout.tsx)
  - strip workspace/account navigation logic

### Keep

- [src/features/projects/lib/projectBranchSessionStore.ts](../src/features/projects/lib/projectBranchSessionStore.ts)
  - shared branch = collab
  - non-shared branch = local-only

## 4. Electron app and preload layer

### Remove

- [electron/sourceControlOAuthCallback.ts](../electron/sourceControlOAuthCallback.ts)
- source-control callback handling in [electron/main.ts](../electron/main.ts)
- billing callback handling in [electron/main.ts](../electron/main.ts)
- [electron/services/ProjectSourceControlService.ts](../electron/services/ProjectSourceControlService.ts)

### Rewrite

- [electron/preload.ts](../electron/preload.ts)
  - remove auth/billing/source-control-account bridges
  - keep collaboration/device identity bridges
- [electron/main.ts](../electron/main.ts)
  - remove protocol handling for billing and source-control OAuth
  - add device bootstrap if needed

### Keep

- [electron/collabKeys.ts](../electron/collabKeys.ts)
- [electron/services/CollabEncryptionService.ts](../electron/services/CollabEncryptionService.ts)

These become the foundation for device identity and encrypted collaboration.

## 5. Convex modules

### Delete

- [convex/billing.ts](../convex/billing.ts)
- [convex/invitations.ts](../convex/invitations.ts)
- [convex/organizations.ts](../convex/organizations.ts)
- [convex/sourceControl.ts](../convex/sourceControl.ts)
- [convex/waitlist.ts](../convex/waitlist.ts)
- [convex/projectRepoAccess.ts](../convex/projectRepoAccess.ts)

### Delete helper libs

- [convex/lib/accountEntitlements.ts](../convex/lib/accountEntitlements.ts)
- [convex/lib/modelTiers.ts](../convex/lib/modelTiers.ts)
- [convex/lib/organizationAccess.ts](../convex/lib/organizationAccess.ts)
- [convex/lib/organizationRoles.ts](../convex/lib/organizationRoles.ts)
- [convex/lib/permissions.ts](../convex/lib/permissions.ts)
- [convex/lib/seatLimits.ts](../convex/lib/seatLimits.ts)
- [convex/lib/walletPolicy.ts](../convex/lib/walletPolicy.ts)
- [convex/lib/workspaceLimits.ts](../convex/lib/workspaceLimits.ts)
- [convex/lib/workspaceProjectAccess.ts](../convex/lib/workspaceProjectAccess.ts)
- [convex/lib/usagePeriods.ts](../convex/lib/usagePeriods.ts)
- [convex/lib/planNames.ts](../convex/lib/planNames.ts) if only billing/plan UI still uses it

### Rewrite

- [convex/projects.ts](../convex/projects.ts)
  - remove organization/workspace gating
  - make project access project-collab scoped
- [convex/projectMembers.ts](../convex/projectMembers.ts)
  - make this the primary collaborator authority
- [convex/projectInvites.ts](../convex/projectInvites.ts)
  - make invites device/project based, not user/account based
- [convex/projectJoinLinks.ts](../convex/projectJoinLinks.ts)
  - align with device trust model
- [convex/schema.ts](../convex/schema.ts)
  - remove billing/org/source-control-account tables
  - add or promote device-trust tables

### Keep

- [convex/yjs.ts](../convex/yjs.ts)
- [convex/yjsAwareness.ts](../convex/yjsAwareness.ts)
- [convex/projectPresence.ts](../convex/projectPresence.ts)
- [convex/projectFiles.ts](../convex/projectFiles.ts)
- [convex/projectAssets.ts](../convex/projectAssets.ts)
- [convex/projectTasks.ts](../convex/projectTasks.ts)
- [convex/fileTombstones.ts](../convex/fileTombstones.ts)

## 6. Convex schema target

### Remove from schema

- organization billing data
- subscription metadata
- seat/account limits
- workspace source-control connections
- SaaS user/workspace account scaffolding that is no longer needed

### Keep or reshape

- `projects`
- `projectMembers`
- `projectInvites`
- `projectJoinLinks`
- `yjs` encrypted room tables
- `yjsAwareness`
- trusted device / wrapped-key / recovery-kit tables

### Project record target

Project should become:

- local-first
- collab-first
- repo-optional

Project should not require:

- organizationId as a SaaS billing container
- source-control setup metadata for normal use
- billing-derived limits

## 7. Server routes

### Delete

- [server/src/routes/auth.ts](../server/src/routes/auth.ts)
- [server/src/routes/members.ts](../server/src/routes/members.ts)
- [server/src/routes/organizations.ts](../server/src/routes/organizations.ts)
- [server/src/routes/settings.ts](../server/src/routes/settings.ts)
- [server/src/routes/sourceControlAuth.ts](../server/src/routes/sourceControlAuth.ts)
- [server/src/routes/stripe.ts](../server/src/routes/stripe.ts)
- [server/src/routes/workspaceSettingsLinks.ts](../server/src/routes/workspaceSettingsLinks.ts)
- [server/src/routes/git.ts](../server/src/routes/git.ts) if git becomes entirely local/manual

### Keep

- [server/src/routes/collab.ts](../server/src/routes/collab.ts)

### Decision gate

- [server/src/routes/runtimeWorkspaces.ts](../server/src/routes/runtimeWorkspaces.ts)

If hosted runtimes stay, keep and slim it.

If v1 should be collab-only hosting, remove it.

## 8. Server infrastructure libs

### Delete

- [server/src/lib/authCallbackState.ts](../server/src/lib/authCallbackState.ts)
- [server/src/lib/billingSwitch.ts](../server/src/lib/billingSwitch.ts)
- [server/src/lib/jwt.ts](../server/src/lib/jwt.ts)
- [server/src/lib/session.ts](../server/src/lib/session.ts)
- [server/src/lib/sourceControlTokens.ts](../server/src/lib/sourceControlTokens.ts)
- [server/src/lib/stripeEnv.ts](../server/src/lib/stripeEnv.ts)
- [server/src/lib/workosMemberships.ts](../server/src/lib/workosMemberships.ts)
- [server/src/lib/workspaceIdentity.ts](../server/src/lib/workspaceIdentity.ts)
- [server/src/plugins/workos.ts](../server/src/plugins/workos.ts)

### Keep if still needed

- [server/src/lib/redis.ts](../server/src/lib/redis.ts)
  - only if collab/runtime or invite/device coordination still needs it
- [server/src/lib/convex.ts](../server/src/lib/convex.ts)
- [server/src/lib/agentLocks.ts](../server/src/lib/agentLocks.ts)

## 9. Server entrypoints

### Replace current profiles

Current entrypoints in [server/src/server/features.ts](../server/src/server/features.ts):

- all-in-one
- auth-control-plane
- collab-runtime
- git-service

### Target

- `collab-service`
- optional `runtime-service` only if hosted runtimes remain

Delete:

- auth-control-plane
- git-service

Simplify:

- all-in-one only if you still want one combined deploy for collab + runtime

## 10. Shared types

### Rewrite or delete

- [shared/types.ts](../shared/types.ts)
  - remove workspace membership model
- [shared/workspaceIdentity.ts](../shared/workspaceIdentity.ts)
  - remove workspace identity fallback logic
- [shared/versionControl.ts](../shared/versionControl.ts)
  - remove workspace source-control connection summaries and SaaS-hosted assumptions

### Keep and adapt

- [shared/projectShare.ts](../shared/projectShare.ts)
  - make it pure project invite/deep-link logic
- [shared/electronApiTypes.ts](../shared/electronApiTypes.ts)
  - remove auth/billing/source-control account IPC contracts
  - keep collab/device identity IPC contracts

## 11. Runtime and collab-specific code

### Keep

- [src/lib/yjs/CollabWsProvider.ts](../src/lib/yjs/CollabWsProvider.ts)
- [src/contexts/YjsProjectContext.tsx](../src/contexts/YjsProjectContext.tsx)
- [src/hooks/useCollabSession.ts](../src/hooks/useCollabSession.ts)
- [src/features/projects/contexts/ProjectSyncProviderRuntime.tsx](../src/features/projects/contexts/ProjectSyncProviderRuntime.tsx)
- [src/hooks/useYjsFileWriteback.ts](../src/hooks/useYjsFileWriteback.ts)

### Rewrite

- remove any remaining user/workspace assumptions in collab bootstrap
- align invite acceptance and trust checks with device identity

## 12. Manual git path

### Keep as optional local tooling

- [src/lib/git/projectGitRuntime.ts](../src/lib/git/projectGitRuntime.ts)
- [src/lib/git/projectRepositoryIntegration.ts](../src/lib/git/projectRepositoryIntegration.ts)
- local git status / branch UI
- terminal-based git workflows

### Remove SaaS coupling

- no GitHub OAuth
- no repo access automation
- no workspace source-control account setup
- no git required to create/open/share a project

## Migration plan

## Phase 1: Stop routing the app through SaaS identity

- remove login requirement from app bootstrap
- bootstrap device identity on first launch
- make existing local project access work without hosted user session

## Phase 2: Collapse navigation and settings

- remove workspace/personal/billing/admin settings routes
- replace with app settings + project settings + collaborators

## Phase 3: Remove billing and org backend

- delete billing/organization/workspace Convex modules
- delete Stripe routes and helpers
- delete WorkOS routes and helpers
- slim schema

## Phase 4: Rewrite project invite and membership model

- make membership project-scoped
- bind invites to device trust / project access
- remove workspace membership assumptions

## Phase 5: Reduce server to collab-focused runtime

- keep collab websocket
- decide whether hosted runtimes remain
- delete leftover auth/billing/source-control server paths

## Phase 6: Final destructive cleanup

- remove unused shared types
- remove dead settings surfaces
- remove stale IPC bridges
- remove old workspace/org language from UI copy

## Open decision

### Hosted runtime workspaces

This is the one major scope decision that changes the server size materially.

If yes:

- keep [server/src/routes/runtimeWorkspaces.ts](../server/src/routes/runtimeWorkspaces.ts)
- server remains collab + runtime

If no:

- remove runtime workspaces
- server becomes much cheaper and simpler
- app becomes truly local-first + hosted-collab

## Recommended v1 cut

For the cleanest open-source/free first version:

1. local-first desktop app
2. hosted encrypted collaboration only
3. no login
4. no billing
5. no runtime workspaces
6. no source-control account linking
7. manual git only

That is the smallest coherent product that still keeps Cozea’s distinctive value:

- local desktop workflow
- live collaboration
- encrypted hosted sync
- AI-assisted project workspace
