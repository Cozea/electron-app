# Pure Device Principal Identity Cutover

Status: active implementation plan

## Goal

Cozea has no human account model. One physical Cozea installation is one principal. The principal is authenticated by its local signing key and is identified publicly by its immutable `czd_…` identity key. A device may choose a mutable display name and avatar solely for presentation in the UI and collaboration.

There is no login account, email identity, first/last-name profile, username namespace, or relationship in which several devices belong to one human user.

## Core invariants

1. One physical installation is one device principal.
2. `identityKey` is the immutable public `czd_…` security identity.
3. The Convex document ID is an internal database relationship identifier, not a public product identity.
4. `displayName` and `avatar` are mutable presentation metadata only.
5. Renaming a device or changing its avatar must never rotate keys, invalidate tokens, alter memberships, change room-key access, or create a new principal.
6. Resetting/revoking a device identity creates a genuinely new principal; the new principal must not silently inherit the old principal's memberships or encrypted-room access.
7. Authentication must never overwrite presentation metadata.
8. Presentation updates must never mutate authentication, authorization, or encryption state.
9. Public mutations derive the acting principal from authenticated device authority. Callers do not supply their own actor/user ID when the server can derive it.
10. A single canonical principal record is the source of truth for device identity, display metadata, signing public key, and ECDH public key.

## Target principal record

The final schema should represent the device principal approximately as:

```ts
devicePrincipals: defineTable({
  identityKey: v.string(),

  displayName: v.optional(v.string()),
  avatarStorageId: v.optional(v.id("_storage")),

  platform: v.string(),

  encryptionPublicKeyJwk: v.string(),
  encryptionPublicKeyAlgorithm: v.string(),
  encryptionFingerprint: v.string(),

  signingPublicKeyJwk: v.string(),
  signingPublicKeyAlgorithm: v.string(),
  signingFingerprint: v.string(),

  status: v.union(v.literal("active"), v.literal("revoked")),
  signingKeyVersion: v.number(),
  tokenValidAfter: v.number(),
  lastAuthenticatedAt: v.number(),
  revokedAt: v.optional(v.number()),
  revocationReason: v.optional(v.string()),

  presentationConfiguredAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_identity_key", ["identityKey"])
```

Exact table/field naming may be adjusted during implementation, but no account-compatible fields should survive merely for compatibility.

## Remove the account-era identity model

Delete the user/account semantics inherited from the old SaaS build:

- `workosId`
- `email`
- `normalizedEmail`
- `firstName`
- `lastName`
- `profileImageUrl`
- `jobTitle`
- WorkOS/email indexes used for identity lookup
- synthetic `device+…@local.cozea.app` identities
- `isLocalDeviceEmail` presentation heuristics
- first-name/email fallback formatting
- email-based project and organization invitation paths that identify a principal by email
- email notification preference fields that exist only because an account had an email

Historical development data does not need a compatibility migration. This is a breaking pre-user cutover.

## Identifier terminology

Use two distinct concepts only:

- `principalId`: internal Convex document ID used by foreign keys.
- `identityKey`: public immutable `czd_…` device identity.

Do not use `userId` to mean both a Convex document ID and the public `czd_…` value. Do not expose aliases where `deviceId`, `userId`, and `identityKey` all contain the same public string.

## Local Electron identity

The encrypted local identity owns cryptographic material only:

- identity key
- platform/runtime metadata needed by authentication
- ECDSA signing keypair
- ECDH encryption keypair
- fingerprints
- creation/version metadata

The OS hostname is not identity state. It may be used at most as a first-run suggestion and must never become authoritative or overwrite a custom display name.

## Device authentication

The device challenge/complete protocol carries only authentication and cryptographic registration data. Mutable display name/avatar are not challenge claims and are not refreshed from local system metadata.

The complete endpoint establishes a live device session and resolves the canonical principal. Presentation is loaded from the canonical principal record and is never rewritten as a side effect of authentication.

## First-run presentation setup

A new cryptographic principal may exist before presentation is configured. On first launch after device authentication, Cozea asks for:

- device display name: required
- avatar: optional

There is no account creation screen, email field, password, or username registration. The app should describe this as naming/identifying the local device for collaboration.

## Avatar storage

Avatars should use Cozea-controlled storage, preferably Convex Storage, with the principal record referencing the storage object. Do not treat arbitrary remote URLs as canonical avatar identity.

Reuse/generalize the existing safe PNG/JPEG/WebP image pipeline used by DevApp logos: validate, decode, square-crop, resize, and re-encode before upload. Replacing/removing an avatar should clean up the superseded storage object where safe.

## Project membership and sharing

A project member is directly a device principal. The target shape is approximately:

```ts
projectMembers {
  projectId
  principalId
  role
  addedAt
  addedByPrincipalId
}
```

Delete `contactEmail` and the account-to-device split.

### Remove `projectTrustedDevices`

`projectTrustedDevices` duplicates authorization in a one-device-one-principal model. Project membership already states that the device has access and its role. Project access must not have a second independent role/authorization source.

### Replace email project invites

Remove email-keyed project invitations and historical email contact discovery. Support device-native sharing through:

1. join links: normal convenient sharing flow;
2. explicit `czd_…` pending enrollment: precision/admin flow.

The target device must authenticate and accept an explicit enrollment before membership exists.

Join-link acceptance derives the joining principal from authenticated device authority; the caller does not provide its own `userId`, `deviceId`, label, platform, or fingerprint.

## Organizations

Keep the newer device-group model and `czg_…` public group IDs. Organization membership directly references device principals.

Keep the current device-enrollment/recovery semantics, but return/display canonical principal presentation:

- identity key
- display name
- avatar
- platform
- role

Remove remaining WorkOS/email/human-profile output and legacy organization invite paths.

## Collaboration encryption

Keep the existing cryptographic architecture:

- one private signing identity per device
- one private ECDH identity per device
- room content keys
- per-device wrapped room keys
- key rotation
- revocation
- recovery

### Remove duplicate device registries

The canonical principal already owns the encryption public key, fingerprint, platform, status and identity key. `collabDevices` should not become a second source of identity truth.

The collaboration gateway should derive the device and encryption identity from the authenticated canonical principal. A collaboration session request should eventually need only project/client information, not caller-supplied device identity metadata already registered during authentication.

`projectCollabRoomKeys`, wrapped-key records, key requests, recovery kits and key rotation remain because they model room cryptography rather than a second identity system.

## Presence and Yjs awareness

Presence heartbeat payloads contain ephemeral activity only. The server derives principal identity and current presentation from authenticated authority.

Remove `userEmail` from presence. Rename user-shaped presentation fields to device-principal terminology.

Yjs awareness should expose the public `identityKey`, display name, avatar and deterministic collaboration color rather than account/email data or an opaque database identity as the product identifier.

## Attribution surfaces

Normalize all actor/member presentation through one principal presentation contract. Impacted surfaces include:

- sidebar/device menu
- organization members
- project members
- join previews
- presence avatars
- Yjs cursors/awareness
- activity timeline
- comments
- file locks
- tombstones/reconnection messages
- task assignees/actors
- DevApp publisher attribution

Historical artifact/activity records may deliberately snapshot the display name used at creation time, but authoritative identity remains the principal ID / identity key.

## Desktop session and settings semantics

Replace account-shaped renderer/session concepts with device-principal concepts. The encrypted desktop bootstrap should cache enough presentation data to render the device name/avatar immediately, but cached data never grants server authority.

Bump the bootstrap/session version rather than supporting old account-shaped cached sessions.

The settings surface should be device-oriented rather than account/profile-oriented:

- device name
- avatar
- public device identity (`czd_…`)
- security/reset controls

Reset remains a destructive identity operation; rename/avatar changes are cosmetic only.

## Public API authority cleanup

Authenticated public functions should derive the acting principal from `ctx.auth` whenever possible. Remove redundant caller-supplied fields such as `actorUserId`, `viewerUserId`, `createdBy`, or `userId` when they represent the caller rather than a target principal.

Explicit target IDs remain valid for operations on another member/principal.

## Development-data reset

No compatibility migration is required. The cutover may invalidate/delete existing development rows and cached sessions whose shape depends on the old user/account model.

Do not delete or move local project working directories as part of the identity reset. Source code on disk is independent of the cloud identity-schema cleanup.

## Implementation sequence

1. Establish principal terminology and shared presentation contracts.
2. Cut the Convex identity schema and remove account-era identity fields/indexes.
3. Refactor device auth so authentication never carries or mutates presentation.
4. Refactor Electron local identity to remove hostname/display metadata and public ID aliases.
5. Refactor device session/bootstrap around principal data and bump cached-session version.
6. Add first-run device-name/avatar setup and editable Device Identity settings.
7. Replace project email invites/trusted-device authorization with direct principal membership, join links and device enrollment.
8. Remove duplicate collaboration device registration and simplify collaboration-session bootstrap.
9. Normalize presence, Yjs awareness, activity, locks, tombstones, tasks, organizations and DevApp attribution.
10. Delete dead account-era helpers/types/routes/i18n/docs.
11. Reset test/dev identity data as needed and regenerate Convex types.
12. Run typecheck, lint/build and identity/collaboration/project/DevApp tests; perform two-device packaged collaboration QA before merge.

## Required acceptance tests

### Presentation mutation

Given an initialized device with project membership, organization membership and encrypted-room access, changing its display name/avatar must leave all of the following unchanged:

- `identityKey`
- internal principal ID
- signing keys/fingerprints
- encryption keys/fingerprints
- signing key version
- token validity boundary
- project roles
- organization roles
- wrapped room-key access
- recovery/revocation state

Other connected devices should observe the updated presentation without the renamed device rejoining projects/groups.

### Identity reset

Reset/revoke must:

- revoke the old identity;
- erase the old local private keys;
- create a new `czd_…` identity after reload;
- create a new canonical principal;
- not inherit old project/group membership automatically;
- not inherit wrapped room keys automatically.

### Authorization

Presentation fields must never be accepted as authority. A forged display name/avatar or caller-supplied principal identifier cannot grant project, group, DevApp or collaboration access.

### Collaboration

Two independently initialized packaged desktop instances with custom names and avatars must be able to:

- join the same project/group through the supported device-native flow;
- see each other's names/avatars in collaboration UI;
- edit concurrently with encrypted Yjs traffic;
- rename/change avatar during membership without losing access;
- revoke one device and correctly rotate future encrypted access.
