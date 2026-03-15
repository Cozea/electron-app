# Workspace Identity Implementation Plan

## Goal

Add workspace identity customization with:

- selectable workspace icon
- selectable workspace icon color
- current default behavior preserved when nothing is customized
- future support for workspace image URL without changing the render contract again

This plan is limited to workspace identity. It assumes the personal vs workspace scope work is already in place.

---

## Product Rules

### Identity model

Every workspace gets one identity contract:

1. `logoUrl` if present
2. `iconKey + iconColor` if configured
3. current default fallback by workspace type
   - personal workspace → `User`
   - organization workspace → `Building2`

### Storage rule

Do not store SVG payloads or uploaded icon data in Convex.

Store only references:

- `iconKey`
- `iconColor`
- later `logoUrl`

### Editing rule

- new workspaces can set icon and color during creation
- existing workspaces can modify icon and color from General settings
- if the product requirement really means “every workspace”, the personal workspace must also become editable

### Ownership rule

- WorkOS remains source of truth for org existence, membership, and canonical name
- Convex becomes source of truth for workspace identity fields
- UI should not derive identity directly from WorkOS payloads

### Permission rule

- identity editing belongs to workspace General settings
- organization workspace editing uses the same gate as current General updates
- personal workspace editing is owner-only

---

## Target Data Contract

Use flat fields on the existing organization record:

```ts
interface WorkspaceIdentityFields {
  iconKey?: WorkspaceIconKey
  iconColor?: WorkspaceIconColorKey
  logoUrl?: string
}
```

This is the least disruptive shape because `logoUrl` already exists in the schema.

### Icon keys

Use a curated registry of allowed keys. Do not accept arbitrary icon names.

Example set:

- `building-2`
- `briefcase`
- `sparkles`
- `bell`
- `rocket`
- `badge-dollar-sign`
- `heart`
- `map`
- `camera`
- `message-square`

### Color keys

Store palette keys, not raw hex values.

Example set:

- `default`
- `violet`
- `blue`
- `cyan`
- `teal`
- `green`
- `yellow`
- `orange`
- `red`
- `pink`
- `slate`

`default` must mean “keep the current neutral look”.

---

## Render Contract

Identity rendering must be centralized and deterministic.

### Render precedence

1. `logoUrl`
2. `iconKey + iconColor`
3. workspace-type fallback

### UI rule

The same workspace should render the same avatar on:

- workspace selection page
- context switcher trigger
- context switcher list
- General settings preview
- create workspace dialog preview

No surface should choose `User` or `Building2` directly once this is implemented.

---

## Surface Audit

## Creation surfaces

### `src/components/workspaces/CreateWorkspaceDialog.tsx`

Purpose:

- create a new workspace from anywhere in the app

Required change:

- add icon picker
- add color picker
- keep the current default as an explicit selectable state
- show a live preview

Notes:

- default state must not silently become “first palette color”
- name availability remains independent from icon/color selection

## Existing workspace settings

### `src/pages/workspace/General.tsx`

Purpose:

- edit workspace-level general metadata

Required change:

- add identity section
- reuse the same picker UI as create flow
- save icon/color through the same mutation path as other General settings

## Workspace discovery surfaces

### `src/pages/WorkspaceSelect.tsx`

Purpose:

- choose active workspace after login or when required

Required change:

- render the shared workspace avatar instead of hardcoded icons

### `src/components/context-switcher.tsx`

Purpose:

- show current workspace and switch between workspaces

Required change:

- use the same shared workspace avatar in the trigger and list

## Identity transport surfaces

### `src/contexts/AuthContext.tsx`

Purpose:

- normalize personal and organization workspaces into one client-side list

Required change:

- preserve `iconKey`, `iconColor`, `logoUrl`
- support identity in workspace creation response
- if personal workspace is supported, hydrate its identity from the synthetic personal Convex org

### `server/src/routes/organizations.ts`

Purpose:

- create workspaces
- list workspaces
- validate names
- update WorkOS organization metadata

Required change:

- enrich org list/create payloads with Convex identity fields
- accept icon/color during creation only if the final plan chooses server-side pass-through

### `server/src/routes/auth.ts`

Purpose:

- produce the initial authenticated session payload after login

Required change:

- ideally enrich organization memberships with identity fields before the workspace selector renders

This is optional for correctness, but recommended to avoid a post-login fallback flicker.

## Personal workspace

### Current reality

The personal workspace is synthetic in the auth context. It is not a native WorkOS org row.

### Product implication

If personal workspace identity must be editable too, there must be a personal-scope identity source in Convex and a personal General surface or equivalent editor.

If not implemented in v1, personal workspace keeps default identity only.

---

## File-by-File Implementation Plan

## 1. Shared types

### `shared/types.ts`

Change:

- extend `BaseWorkspaceMembership` with:
  - `iconKey?: string`
  - `iconColor?: string`
  - `logoUrl?: string`

Why:

- the selector and switcher already render `WorkspaceMembership`
- identity should travel with the same object the UI already consumes

Also audit:

- any duplicated workspace/org transport shapes in `shared/electronApiTypes.ts`

Rule:

- no parallel workspace identity type should be invented in app-local code if the shared type already owns it

---

## 2. Shared identity registry

### New file: `src/lib/workspaces/workspaceIdentity.ts`

Create:

- icon registry
- color registry
- default fallback definitions
- helper functions for render precedence

Expected exports:

- `WORKSPACE_ICON_OPTIONS`
- `WORKSPACE_COLOR_OPTIONS`
- `getWorkspaceFallbackIdentity(workspaceType)`
- `resolveWorkspaceIdentity(workspace)`
- `getWorkspaceIconComponent(iconKey)`
- `getWorkspaceColorClasses(colorKey)`

Rule:

- no surface manually maps icon keys or color keys

---

## 3. Shared renderer

### New file: `src/components/workspaces/WorkspaceAvatar.tsx`

Create one reusable renderer with:

- size variants for selector, switcher, settings preview
- icon-only and container variants
- later `logoUrl` support without API changes to callers

Render behavior:

- if `logoUrl` exists, render image
- else render resolved icon and color
- else render fallback by workspace type

Consumers after rollout:

- `src/pages/WorkspaceSelect.tsx`
- `src/components/context-switcher.tsx`
- `src/components/workspaces/WorkspaceIdentityPicker.tsx`
- `src/pages/workspace/General.tsx`
- `src/components/workspaces/CreateWorkspaceDialog.tsx`

---

## 4. Shared picker

### New file: `src/components/workspaces/WorkspaceIdentityPicker.tsx`

Create one reusable picker for both create and edit flows.

Contents:

- live preview using `WorkspaceAvatar`
- color swatches
- icon grid
- explicit default state

Expected props:

- current `iconKey`
- current `iconColor`
- change handlers
- optional disabled/read-only mode

Rule:

- create flow and General page must reuse this component

---

## 5. Convex schema

### `convex/schema.ts`

Extend `organizations` with:

- `iconKey: v.optional(v.string())`
- `iconColor: v.optional(v.string())`

Keep:

- existing `logoUrl`

Migration behavior:

- no backfill required
- missing fields resolve to defaults in UI

---

## 6. Convex organization lifecycle

### `convex/organizations.ts`

Touch these paths:

#### `syncFromWorkOS`

Current role:

- creates or updates Convex organization rows from WorkOS organization data

Required change:

- preserve existing `iconKey`, `iconColor`, `logoUrl` during sync updates
- do not wipe identity when WorkOS sync runs

#### `createPersonalWorkspaceOrganization` or equivalent synthetic-personal path

Audit:

- if a dedicated personal Convex org row exists or is created anywhere, it must be able to carry identity fields

#### `updateOrganization`

Required change:

- accept `iconKey`
- accept `iconColor`
- later optionally `logoUrl`

Rule:

- Convex is the canonical store for workspace identity
- WorkOS name updates and Convex identity updates can happen in the same user action, but they are different ownership domains

---

## 7. Server-side identity enrichment

### New helper: `server/src/lib/workspaceIdentity.ts`

Create a small helper that:

- looks up Convex orgs by WorkOS ID
- extracts `iconKey`, `iconColor`, `logoUrl`
- merges those fields onto organization membership payloads

Why:

- `server/src/routes/organizations.ts`
- `server/src/routes/auth.ts`

both need the same identity enrichment behavior

### `server/src/routes/organizations.ts`

Required change:

- enrich `GET /organizations`
- enrich `POST /organizations` response if possible
- if creation carries icon/color, return them directly so the UI has immediate consistency

### `server/src/routes/auth.ts`

Required change:

- enrich the organization list placed on the initial session payload

Why:

- avoid a workspace selector render that shows fallback icons first and then swaps later after Convex hydration

If this proves too costly in the login path, defer it, but keep the merge helper reusable for later.

---

## 8. Auth context and client normalization

### `src/contexts/AuthContext.tsx`

Required changes:

#### Workspace normalization

- preserve `iconKey`, `iconColor`, `logoUrl` from session/server payloads

#### Personal workspace construction

- if personal identity is supported in v1, read icon/color/logo from the synthetic personal Convex org
- otherwise keep the default neutral identity

#### Create flow

Change:

- `createOrganizationWorkspace(name: string, identity?: WorkspaceIdentityInput)`

Flow:

1. create workspace on auth server
2. sync or update Convex org
3. merge identity into client workspace state immediately

Rule:

- the switcher should show the chosen icon/color immediately after creation
- do not require a full reload

---

## 9. Create workspace dialog

### `src/components/workspaces/CreateWorkspaceDialog.tsx`

Required changes:

- add `WorkspaceIdentityPicker`
- keep the current name availability logic
- submit the selected identity with the create action
- show preview

UI rule:

- the identity picker must not change the modal’s “create a workspace” semantics
- default state should remain visually close to current app behavior

### `src/components/workspaces/CreateWorkspaceDialogHost.tsx`

Likely no logic change beyond threading the new payload through.

### `src/stores/useCreateWorkspaceDialogStore.ts`

No structural change required unless the store needs to carry defaults or return paths for identity editing behavior.

---

## 10. Existing workspace editing

### `src/pages/workspace/General.tsx`

Required changes:

- add a dedicated identity section
- reuse `WorkspaceIdentityPicker`
- include icon/color in save payload

UX rule:

- keep name, slug, description, and identity inside one General save surface
- do not create a separate workspace appearance page for this

### `src/hooks/useScopedGeneralData.ts`

Audit:

- confirm the data returned to General includes the current `iconKey`, `iconColor`, `logoUrl`

---

## 11. Personal workspace editing decision

### `src/lib/settings/settingsRegistry.ts`

If personal workspace editing is supported in v1:

- expose `General` for personal scope too

### `src/router/routes.tsx`

If personal workspace editing is supported in v1:

- allow the same General page under personal settings scope

### `src/pages/workspace/General.tsx`

Must support both:

- organization workspace General
- personal workspace General

Recommendation:

- do this in v1 if the requirement is truly “each workspace”
- otherwise document clearly that personal remains default-only for now

---

## 12. UI render consumers

### `src/pages/WorkspaceSelect.tsx`

Replace:

- direct `User` / `Building2`

With:

- `WorkspaceAvatar`

Keep unchanged:

- current check indicator
- row selection behavior
- existing table layout and hover behavior

### `src/components/context-switcher.tsx`

Replace:

- current hardcoded workspace icon rendering in trigger and list

With:

- `WorkspaceAvatar`

### `src/components/app-sidebar.tsx`

Audit only:

- confirm no stray hardcoded workspace icon remains outside `ContextSwitcher`

---

## 13. Future image URL support

### Existing field: `logoUrl`

Do not add a second image field.

Future work should only require:

- enabling `logoUrl` editing in `WorkspaceIdentityPicker`
- enabling `logoUrl` persistence in `General`
- optionally allowing it during creation later

Because the renderer already prefers `logoUrl`, callers should not need to change.

---

## 14. Rollout order

1. `shared/types.ts`
2. `src/lib/workspaces/workspaceIdentity.ts`
3. `src/components/workspaces/WorkspaceAvatar.tsx`
4. `src/components/workspaces/WorkspaceIdentityPicker.tsx`
5. `convex/schema.ts`
6. `convex/organizations.ts`
7. `server/src/lib/workspaceIdentity.ts`
8. `server/src/routes/organizations.ts`
9. `server/src/routes/auth.ts`
10. `src/contexts/AuthContext.tsx`
11. `src/components/workspaces/CreateWorkspaceDialog.tsx`
12. `src/pages/workspace/General.tsx`
13. personal General wiring if in scope
14. `src/pages/WorkspaceSelect.tsx`
15. `src/components/context-switcher.tsx`

This order keeps:

- data shape first
- render primitives second
- persistence next
- UI consumers last

---

## Validation Matrix

## Create flow

- create workspace with default identity
- create workspace with custom icon/color
- create workspace from:
  - workspace selector
  - onboarding
  - context switcher
- confirm immediate switcher update after create

## Edit flow

- edit icon/color in workspace General
- reload app and confirm persistence
- switch workspaces and confirm identity stays correct

## Personal workspace

- if supported in v1, edit personal workspace identity and verify selector and switcher both reflect it
- if not supported in v1, confirm personal workspace remains on the current default rendering

## Login/session

- sign out and back in
- confirm workspace selector shows customized identities on first render if session enrichment is implemented
- if enrichment is deferred, confirm fallback is still correct and stable after hydration

## Permissions

- user without General edit permission can view identity but cannot change it

## Fallbacks

- missing `iconKey`
- missing `iconColor`
- invalid registry value returned from stale data
- `logoUrl` absent

UI must still render a safe fallback identity.

---

## Success Criteria

The implementation is complete when:

- every workspace can render a stable identity through one shared renderer
- new workspaces can set icon/color during creation
- existing workspaces can edit icon/color
- personal workspace support is either implemented or explicitly deferred
- selector and context switcher use the same workspace identity pipeline
- no UI surface manually chooses workspace icons ad hoc
- future `logoUrl` support can be added without changing caller APIs
