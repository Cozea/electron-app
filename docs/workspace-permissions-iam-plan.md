# Workspace Permissions / IAM Plan

## Goal

Turn the current org-only `Permissions` page into a real IAM-style access management surface for organization workspaces.

This page should manage:

- who can access the workspace
- which role(s) they have
- what each role can do
- which members have direct exceptions or overrides

This is explicitly **organization-workspace only**.

Personal workspaces do not have:

- members
- org roles
- seat-based access
- workspace IAM

---

## Product Goals

The workspace permissions system should support all of the following:

- centralized workspace administration
- seat-gated member access
- role-based access control
- granular permission control
- per-member exceptions where needed
- safe defaults
- a page shape that feels closer to Google Cloud IAM than a simple “roles list”

It should be possible to control, at minimum:

- whether a member can **view workspace billing**
- whether a member can **manage workspace billing**
- whether a member can **create a project**
- whether a member can **import a project**
- whether a member can **invite/remove members**
- whether a member can **edit roles / permissions**
- whether a member can **view or change workspace AI settings**
- whether a member can **choose workspace model policy**
- whether a member can **use AI tools inside projects**
- whether a member can **manage integrations/tooling**

---

## Principles

### 1. Workspace IAM is org-only

The entire IAM model exists only for organization workspaces.

Personal workspaces remain:

- single-user
- no member list
- no role bindings
- no seat logic

### 2. Roles are permission bundles

Roles are not the primary object the user thinks about.

The user-facing goal is:

- “who can do what”

Roles are just reusable bundles of permissions used to make that manageable.

### 3. Member access is role bindings plus optional overrides

A member’s effective access should come from:

- assigned role(s)
- optional direct grants
- optional direct denies

This is what gives “granular per-member control” without exploding the number of custom roles.

### 4. Billing visibility and billing management are separate permissions

These must not be bundled together by default.

The product needs to support:

- a person who can view invoices / billing state
- a smaller set of people who can actually change subscription / seats / payment

### 5. Project creation/import are explicit permissions

Creating or importing projects is powerful and should not be implicit in generic member access.

### 6. AI usage and AI administration are separate

A member being allowed to use AI in a project does **not** mean they can change:

- model policy
- provider policy
- workspace tooling settings
- usage/budget settings

---

## Main Concepts

## A. Principals

Initially support:

- active workspace members
- pending invites

Future-safe but out of first scope:

- groups
- service identities

## B. Roles

Workspace-scoped role definitions.

Types:

- system roles
- custom roles

A role has:

- `roleId`
- `key`
- `name`
- `description`
- `permissions[]`
- `isSystem`
- `baseRole` (compatibility / migration only, not final authority)

## C. Bindings

A binding assigns one or more roles to a principal.

Examples:

- member A -> `workspace_admin`
- member B -> `member` + `project_creator`
- invite C -> `viewer`

## D. Overrides

Optional per-principal exceptions:

- direct grants
- direct denies

Example:

- member has `member`
- but direct grant `projects.import`
- and direct deny `billing.view`

This is the safest way to support “granular control for each individual member” without forcing admins to create too many roles.

## E. Effective Permissions

Effective permissions are computed as:

1. union of all assigned role permissions
2. plus direct grants
3. minus direct denies

This computed view must be visible in the UI.

---

## Permission Taxonomy

The permission model should be explicit and stable.

## 1. Workspace

- `workspace.view`
- `workspace.update`
- `workspace.delete`

## 2. Billing

- `billing.view`
- `billing.manage_subscription`
- `billing.manage_seats`
- `billing.view_invoices`
- `billing.manage_payment_method`

## 3. Members & Invites

- `members.view`
- `members.invite`
- `members.remove`
- `members.update_roles`
- `invites.view`
- `invites.send`
- `invites.revoke`

## 4. Roles / Permissions Administration

- `roles.view`
- `roles.create`
- `roles.update`
- `roles.delete`
- `roles.assign`

## 5. Projects

- `projects.view`
- `projects.create`
- `projects.import`
- `projects.archive`
- `projects.delete`
- `projects.share`

## 6. Project AI Usage

These are intentionally separate from workspace AI administration.

- `project_ai.use`
- `project_ai.use_tools`
- `project_ai.use_agents`

## 7. Workspace AI Administration

- `workspace_ai.view`
- `workspace_ai.manage_settings`
- `workspace_ai.manage_model_policy`
- `workspace_ai.manage_provider_policy`
- `workspace_ai.view_usage`

## 8. Tooling / Integrations

- `tooling.view`
- `tooling.manage`
- `integrations.view`
- `integrations.connect`
- `integrations.disconnect`

## 9. Usage / Audit / Storage

- `usage.view`
- `usage.export`
- `audit.view`

---

## Default System Roles

The system should ship with a small, sane set of default roles.

## 1. Owner

Full control.

Permissions:

- everything

Constraints:

- cannot remove the last owner-equivalent member

## 2. Billing Admin

Focused financial/admin role.

Permissions:

- `workspace.view`
- all `billing.*`
- `usage.view`
- `usage.export`

No member or project admin powers by default.

## 3. Workspace Admin

General operational admin.

Permissions:

- workspace settings
- member/invite management
- role assignment
- project create/import/share
- workspace AI/tooling administration

May or may not include billing view by default, but should not necessarily include payment modification.

## 4. Project Creator

Focused builder role.

Permissions:

- `workspace.view`
- `projects.view`
- `projects.create`
- `projects.import`
- `projects.share`
- `project_ai.use`
- `project_ai.use_tools`
- `project_ai.use_agents`

No billing or IAM management.

## 5. Member

Normal collaborator.

Permissions:

- `workspace.view`
- `projects.view`
- `project_ai.use`

Optional:

- `project_ai.use_tools`

## 6. Viewer

Read-only baseline.

Permissions:

- `workspace.view`
- `projects.view`

No project creation, import, billing, AI administration, or member management.

---

## How the Page Should Work

This should no longer be just a “roles page”.

It should become a real workspace IAM surface with three clear areas.

## Tab 1: Access

Primary tab. This is the main operational page.

### Purpose

Show which principals have which roles and effective access.

### Main table

Columns:

- principal
- type (`member`, `invite`)
- assigned roles
- direct overrides
- effective access summary
- status
- actions

### Actions per principal

- assign role
- remove role
- add direct permission grant
- add direct permission deny
- revoke invite
- remove member

### Why this matters

This is where admins answer:

- “Can this person import projects?”
- “Why can this person see billing?”
- “Who currently has AI tool access?”

## Tab 2: Roles

Role definition management.

### Contents

- system roles
- custom roles
- create custom role
- edit custom role
- duplicate custom role
- delete custom role

Each role card/list row shows:

- role name
- description
- category (`system` / `custom`)
- assigned principal count
- key permission summary

### Role editor

Use a side drawer or full modal.

Fields:

- name
- description
- optional starting template
- permission checklist grouped by category

## Tab 3: Permission Matrix

Audit/comparison view.

### Contents

- rows = permissions
- columns = roles
- each cell shows whether the role includes that permission

This is not the main editing surface.
It is an audit tool.

## Optional Tab 4: Activity

Later:

- role created
- role updated
- member role changed
- override added/removed
- invite role changed

This is useful for trust and debugging but not required for first launch.

---

## Workspace Page Behavior

## Access tab interactions

### Assigning a role

1. open member row action
2. click `Assign role`
3. choose one or more roles
4. save
5. effective permissions refresh immediately

### Adding an override

1. open member row action
2. click `Edit direct permissions`
3. show grouped list of permissions
4. allow:
   - neutral
   - grant
   - deny
5. save

### Invite flow

When inviting a member:

1. enter email
2. choose seat-consuming role(s)
3. optional direct overrides
4. send invite

The invite should preview:

- seat impact
- effective access after acceptance

## Roles tab interactions

### Creating a custom role

1. click `Create role`
2. choose a template:
   - Viewer
   - Member
   - Project Creator
   - Workspace Admin
3. edit permissions
4. save

### Editing a custom role

Show impact before saving:

- number of assigned members/invites
- what permissions are being added/removed

System roles should not be editable directly.

They can be:

- viewed
- copied into custom roles

---

## UX Structure Recommendation

Use this page structure:

- page header
  - title: `Permissions`
  - subtitle: `Manage who can do what in this workspace.`
- summary strip
  - members
  - invites
  - custom roles
  - admins / billing admins
- tabs:
  - `Access`
  - `Roles`
  - `Permission Matrix`
  - later `Activity`

This is better than a single long page because it separates:

- assignments
- role definitions
- auditing

---

## Seat Model Integration

Seats should affect access at the principal-binding layer.

Rules:

- active members consume seats
- pending invites consume seats
- if no seats remain:
  - new invites blocked
  - direct member add blocked

The page should show:

- seats purchased
- seats used
- seats reserved by pending invites

And in Access tab:

- pending invites should explicitly show seat consumption

---

## Safety Rules

These rules must be enforced both in UI and server logic.

### 1. Last owner/admin protection

Do not allow removal or downgrade of the last member who can:

- manage members
- manage roles
- manage billing
- delete workspace

### 2. Dangerous permission confirmation

Show explicit confirmation for granting:

- `workspace.delete`
- `billing.manage_subscription`
- `roles.assign`
- `members.update_roles`

### 3. Role impact preview

Before saving a role change:

- show affected members
- show permission delta

### 4. Invite acceptance consistency

Invite acceptance should materialize the assigned roles and overrides exactly as configured at invite time, unless the invite was edited before acceptance.

---

## Data Model Changes

The current system already has persisted organization roles.

The next additions should be:

## 1. Role bindings

`organizationRoleBindings`

Fields:

- `organizationId`
- `principalType` (`member`, `invite`)
- `principalId`
- `roleId`
- `assignedBy`
- `assignedAt`

## 2. Principal permission overrides

`organizationPermissionOverrides`

Fields:

- `organizationId`
- `principalType`
- `principalId`
- `permission`
- `mode` (`grant`, `deny`)
- `createdBy`
- `createdAt`

## 3. Optional role activity log

`organizationRoleAudit`

Fields:

- `organizationId`
- `actorUserId`
- `eventType`
- `targetType`
- `targetId`
- `payload`
- `createdAt`

---

## Authorization Model

Server authorization should stop relying on base-role shortcuts as the final authority.

The effective permission resolver should become the single source of truth.

Evaluation order:

1. resolve principal bindings
2. load role permissions
3. apply grants
4. apply denies
5. compute effective permissions
6. authorize request

Base roles should remain only as:

- templates
- migration anchors
- compatibility metadata

Not as the final auth decision.

---

## Relationship to Project Permissions

Workspace permissions and project permissions are different layers.

### Workspace permissions control

- workspace billing
- workspace AI/tooling policy
- member/invite management
- project creation/import/share ability

### Project permissions control

- project-specific editing/access inside a given project

The workspace `Permissions` page should not replace project team/access management.

But it should control whether a member is even allowed to:

- create projects
- import projects
- share projects
- use workspace-scoped AI capabilities

---

## Suggested Rollout Order

### Phase 1

- Rename and stabilize current page as `Permissions`
- Keep current roles UI
- Add Access tab
- Show principal bindings

### Phase 2

- Add explicit permission taxonomy listed above
- Add missing permissions:
  - `projects.create`
  - `projects.import`
  - `project_ai.use_tools`
  - `billing.view`
  - `billing.manage_subscription`

### Phase 3

- Add role bindings table
- Add effective-access summary per principal

### Phase 4

- Add direct per-member overrides

### Phase 5

- Convert server auth checks to effective-permission evaluation only

### Phase 6

- Add audit/history

---

## Immediate Next Implementation Slice

The next concrete step should be:

1. Add missing workspace permission keys for:
   - billing view
   - project create
   - project import
   - project AI tools
2. Split the current `Permissions` page into:
   - `Access`
   - `Roles`
   - `Permission Matrix`
3. Add a principal bindings view using current members + invites
4. Keep role editing where it is for now

That gets the page structurally aligned with IAM before the deeper data-model work lands.
