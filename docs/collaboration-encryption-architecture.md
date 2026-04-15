# Collaboration Encryption Architecture

Last reviewed: 2026-04-15

## Goal

Add end-to-end encryption to Cozea collaboration on top of the websocket-only collaboration path so that:

- the server can authenticate, authorize, route, and persist collaboration traffic
- the server cannot read project file contents
- Git remains completely unrelated to collaboration durability
- the shared-branch vs local-branch collaboration rule stays intact

This document is the concrete encryption follow-up to [git-collaboration-decoupling-refactor-map.md](./git-collaboration-decoupling-refactor-map.md).

## Product Rules

- Shared branch/context = collaboration-enabled mode.
- Any other branch = local-only mode.
- Encryption applies only to the collaboration-enabled shared room.
- Branch switching remains fully manual.
- Switching away from the shared branch must detach collaboration before any working tree rewrite happens.

So the encryption model is scoped to:

- one project
- one shared collaboration room
- one stable collaborative file universe

not to arbitrary local branches.

## Desired Security Outcome

After this work:

- websocket collaboration messages contain ciphertext, not plaintext Yjs updates
- Convex persistence stores opaque encrypted blobs, not readable Yjs update bytes
- server-side snapshots are encrypted too
- awareness payloads are encrypted too
- the server still sees only the metadata it needs:
  - project id
  - room id
  - sequence numbers
  - timestamps
  - client ids / device ids as needed

## Threat Model

### In scope

- server operators should not be able to read collaborative file contents from:
  - websocket traffic
  - Convex-stored Yjs update rows
  - Convex-stored snapshot rows
  - awareness payload storage
- accidental logging / inspection of collaboration payloads on the server should not reveal file contents
- room keys must not be recoverable from the server alone

### Out of scope for the first encryption slice

- hiding project membership metadata from the server
- hiding project ids or room ids from the server
- hiding who is collaborating from the server
- full local-at-rest secrecy for the user's working tree on disk
- complete recovery from total device loss with no trusted device available

## Current Plaintext Surfaces

Today collaboration payloads remain readable in several places:

### Client transport

- `src/lib/yjs/CollabWsProvider.ts`
  - `update_push.payload.updateBinary`
  - `awareness_push.payload.awarenessBinary`
  - `sync_delta.payload.updatesBinary`

### Client bootstrap and snapshoting

- `src/contexts/YjsProjectContext.tsx`
  - initial sync pulls readable update bytes from `api.yjs.syncWithServer`
  - periodic snapshot saves push readable `Y.encodeStateAsUpdate(...)` bytes to `api.yjs.saveSnapshot`

### Server persistence

- `server/src/routes/collab.ts`
  - receives readable update bytes
  - relays readable update bytes
- `convex/yjs.ts`
  - stores readable `update: v.bytes()`
  - stores readable `snapshot: v.bytes()`
- `convex/yjsAwareness.ts`
  - stores readable `update: v.bytes()`

### Local collab cache

- `src/lib/yjs/IndexedDBPersistence.ts`
  - uses `y-indexeddb`, which persists readable Yjs state locally

### Important nuance

The user's working tree on disk is already plaintext by design, because Cozea materializes the local project files. That is acceptable for now.

What is not acceptable for the target architecture is:

- duplicating readable collaboration payloads on the server
- keeping a second readable collaboration cache locally if we want the collaboration layer itself to be cleanly encrypted

## Architecture Decision

Use a per-room symmetric content key plus per-device asymmetric wrapping keys.

### Content encryption key

For each shared collaboration room:

- generate one random 256-bit room key
- use it for:
  - Yjs incremental update payloads
  - Yjs document snapshots
  - awareness payloads

### Device keys

Each desktop install gets its own device encryption identity:

- one device id
- one device public/private key pair
- private key stored locally using Electron safe storage / OS keychain
- public key uploaded to the backend

### Why device-level keys instead of user-level keys

Because Cozea is a desktop app and private keys should stay local to a device.

If we tried to use one user private key across devices, we would have to reintroduce:

- server escrow
- password-derived recovery
- or private-key sync

all of which make the security model messier.

So the clean model is:

- each device has its own key pair
- each device gets the room key wrapped specifically for it

## Crypto Primitives

### Payload encryption

Use:

- AES-GCM 256 for collaborative content payloads

For every encrypted payload:

- generate a new unique 96-bit IV
- include authenticated metadata as AAD
- version the envelope so the protocol can evolve later

### Key agreement / key wrapping

Use Web Crypto ECDH for the first implementation so we stay inside browser/Electron-native primitives without adding a crypto dependency.

Conservative first choice:

- ECDH P-256 device key pairs

Reason:

- broadly supported in Web Crypto environments
- no new dependency required
- easy to operate in renderer and Electron environments

The envelope should still include the wrap algorithm name so we can move to X25519 later without changing the overall data model.

### Envelope versioning

Every encrypted object should carry:

- `v`
- `alg`
- `iv`
- `ciphertext`
- `aad`
- `keyVersion`

so the system can support rotation and future algorithm changes safely.

## Data Model

We should not try to jam the full encryption model into the existing Yjs tables alone.

Add explicit collaboration encryption metadata tables.

### New table: `collabDevices`

Purpose:

- register collaboration-capable desktop devices
- hold only public device key material and metadata

Suggested fields:

- `userId`
- `deviceId`
- `deviceLabel`
- `platform`
- `publicKeyJwk`
- `publicKeyAlgorithm`
- `fingerprint`
- `createdAt`
- `lastSeenAt`
- `revokedAt`

### New table: `projectCollabRoomKeys`

Purpose:

- track room key versions for a project room
- no plaintext key material stored here

Suggested fields:

- `projectId`
- `roomId`
- `keyVersion`
- `status` (`active`, `rotating`, `revoked`)
- `createdByUserId`
- `createdByDeviceId`
- `createdAt`
- `rotatedAt`

### New table: `projectCollabWrappedKeys`

Purpose:

- store one wrapped room key per recipient device

Suggested fields:

- `projectId`
- `roomId`
- `keyVersion`
- `recipientUserId`
- `recipientDeviceId`
- `senderDeviceId`
- `wrapAlgorithm`
- `wrappedKey`
- `createdAt`
- `revokedAt`

### Existing tables that become ciphertext stores

#### `yjsUpdates`

- keep `projectId`, `roomId`, `seq`, `timestamp`, `clientId`, `idempotencyKey`
- change `update` semantics from plaintext Yjs bytes to encrypted envelope bytes

#### `yjsDocuments`

- keep `projectId`, `version`, `snapshotBaseSeq`, `createdAt`
- change `snapshot` semantics from plaintext Yjs snapshot bytes to encrypted envelope bytes

#### `yjsAwareness`

- keep `projectId`, `clientId`, `updatedAt`, `expiresAt`
- change `update` semantics from plaintext awareness bytes to encrypted envelope bytes

## Local Key Management

Re-use the local secure-storage pattern already used for integration credentials.

### New local key service

Add a dedicated collaboration key service in Electron, parallel to:

- `electron/integrationKeys.ts`
- `electron/integrationCrypto.ts`

Suggested new files:

- `electron/collabKeys.ts`
- `electron/collabCrypto.ts`

Responsibilities:

- generate device key pair
- persist private key locally using `safeStorage`
- expose public key to the renderer
- store decrypted room keys locally for fast reopen
- delete/revoke local room keys when device access is revoked

### Fail-closed rule

If secure storage is unavailable:

- do not silently downgrade to plaintext collaboration
- collaboration should fall back to:
  - local-only mode
  - or an explicit “secure collaboration unavailable on this device” state

That is the right enterprise behavior.

## Collaboration Session Bootstrap

The current `/collab/session` endpoint should stay the authentication/authorization entry point, but it must stop implying plaintext room readiness.

### Current behavior

`server/src/routes/collab.ts` returns:

- `projectId`
- `roomId`
- `collabWsUrl`
- `token`
- `protocolVersion`

### New behavior

The session response should also let the client determine key readiness, without ever returning a plaintext room key.

Suggested additions:

- `encryptionRequired: true`
- `activeKeyVersion`
- `recipientDeviceId`
- `wrappedRoomKeyAvailable`
- `roomKeyBootstrapState`

Possible bootstrap states:

- `ready`
- `missing_for_device`
- `room_not_initialized`
- `device_not_registered`

## Room Key Lifecycle

### Room initialization

When the first authorized client opens collaboration for a room:

- generate a random room key locally
- create `projectCollabRoomKeys(active)`
- wrap the key for the local device
- persist only wrapped copies

### Additional collaborator devices

When another device joins:

- server confirms the device is authorized
- device public key is already registered
- an already-authorized active device wraps the current room key for the new device
- the server stores the wrapped result

### Important product consequence

If no trusted device is available to share the room key:

- the new device can authenticate
- but it cannot decrypt project contents yet

That is the honest cost of keeping the room key off the server.

## Websocket Protocol Changes

### Current

`CollabWsProvider` sends and receives plaintext base64 payloads.

### New

The websocket protocol should carry encrypted envelopes instead.

#### `update_push`

Current payload:

- `updateBinary`

New payload:

- `encryptedUpdate`
- `keyVersion`
- `encryptionMetadata`

#### `sync_delta`

Current payload:

- `updatesBinary: string[]`

New payload:

- `encryptedUpdates: Array<...encrypted envelope...>`

#### `awareness_push`

Current payload:

- `awarenessBinary`

New payload:

- `encryptedAwareness`
- `keyVersion`

### AAD binding

For every encrypted message, include authenticated metadata such as:

- `projectId`
- `roomId`
- `messageType`
- `seq` if present
- `clientId`
- `keyVersion`

That prevents ciphertext from being replayed into the wrong room or message slot.

## Server Behavior

The server remains:

- auth layer
- room router
- persistence coordinator
- sequence allocator

The server does **not** become a decryption participant.

### `server/src/routes/collab.ts`

Must change to:

- validate metadata
- not inspect plaintext Yjs payloads
- relay encrypted blobs unchanged
- store encrypted blobs unchanged

### `convex/yjs.ts`

Must change to:

- persist ciphertext bytes
- still track sequence, timestamp, idempotency, room id
- stop assuming snapshot/update bytes are directly readable Yjs content

### `convex/yjsAwareness.ts`

Must change to:

- persist ciphertext awareness blobs
- keep TTL behavior the same

## Client Collaboration Flow

### Open shared branch project

1. Resolve project access.
2. Resolve websocket session.
3. Ensure local device key pair exists.
4. Resolve wrapped room key for this device.
5. Decrypt room key locally.
6. Bootstrap collaboration providers with that key.
7. Join websocket room.
8. Encrypt outgoing updates/awareness.
9. Decrypt incoming updates/awareness.

### Switch away from shared branch

1. Detach websocket collaboration.
2. Flush any local writeback already in progress.
3. Drop the active room key from memory.
4. Continue in local-only mode.

### Switch back to shared branch

1. Re-resolve session.
2. Reload wrapped room key.
3. Rejoin collaboration if the shared branch matches and the room key is available.

## Snapshot and Recovery

### Server snapshots

Current periodic snapshots from `YjsProjectContext.tsx` should stay, but they must be encrypted before upload.

That means:

- `Y.encodeStateAsUpdate(...)` remains local plaintext-in-memory only
- the saved snapshot row stores only encrypted bytes

### Initial sync

Current initial sync returns:

- plaintext server snapshot
- plaintext recent updates

New initial sync must return:

- encrypted snapshot bytes
- encrypted update bytes
- metadata only for sequencing

The client reconstructs the document locally after decrypting.

## Awareness and Presence

We should keep a separation between:

- encrypted rich awareness payloads
- optional server-readable coarse presence metadata

### Encrypted

- selections
- cursors
- any awareness user payload that can reveal file content or fine-grained editing behavior

### Server-readable if needed

- user is online in project
- last seen
- room connected/disconnected

This lets us keep product-level presence without making the rich awareness protocol server-readable.

## Local Persistence

### Target state

The collaboration layer should not write readable Yjs state to IndexedDB.

That means `src/lib/yjs/IndexedDBPersistence.ts` and `y-indexeddb` should eventually be replaced with an encrypted local cache.

### Practical rollout recommendation

#### Phase A

Prioritize server unreadability first:

- encrypted websocket payloads
- encrypted Convex persistence
- encrypted snapshots

#### Phase B

Replace `y-indexeddb` with an encrypted local persistence layer:

- encrypted snapshot blobs
- encrypted local update queue if needed
- same room key

This keeps rollout manageable while still moving immediately toward the main privacy goal.

## Rotation and Revocation

### When to rotate room keys

- collaborator removed
- device revoked
- suspected compromise
- explicit admin rotation

### Rotation flow

1. authorized device generates new room key
2. new `keyVersion` becomes active
3. new wrapped keys are created for remaining authorized devices
4. new outgoing traffic uses new version
5. old ciphertext remains readable only while old wrapped keys are retained

### Revoking a device

- revoke wrapped key entries for that device
- remove or revoke its `collabDevices` registration
- device can no longer unwrap future room keys

## Recovery and Onboarding Tradeoffs

This is the hardest part of true end-to-end encryption.

### Supported first

- new collaborator device can be approved by an already-authorized active device
- existing authorized device can re-wrap and share room keys

### Explicitly deferred

- magical recovery with no trusted device
- server-side escrow of plaintext room keys
- password-derived recovery of project collaboration keys

That deferral is intentional. It keeps the security model honest.

## Migration Strategy

### Step 1: add encryption metadata model

- add device registration
- add wrapped room key tables
- keep plaintext rooms working temporarily

### Step 2: encrypt new rooms first

- any newly-collaborative project uses encrypted room bootstrap

### Step 3: migrate existing rooms

For an existing plaintext project:

1. load current collaborative doc on an authorized client
2. generate room key
3. create encrypted snapshot from current doc
4. mark room as encrypted
5. from then on, accept only encrypted collaboration traffic for that room

This avoids trying to encrypt old server history in place.

## Implementation Map

### Electron

Add:

- `electron/collabKeys.ts`
- `electron/collabCrypto.ts`
- `electron/services/CollabKeyService.ts`

Change:

- `electron/preload.ts`
- `shared/electronApiTypes.ts`

### Renderer

Change:

- `src/hooks/useCollabSession.ts`
- `src/contexts/YjsProjectContext.tsx`
- `src/lib/yjs/CollabWsProvider.ts`
- `src/lib/yjs/IndexedDBPersistence.ts`

Possibly add:

- `src/lib/collab/encryption/roomKeyStore.ts`
- `src/lib/collab/encryption/cipherEnvelope.ts`
- `src/lib/collab/encryption/deviceKeyRegistry.ts`

### Server

Change:

- `server/src/routes/collab.ts`

### Convex

Add:

- `convex/collabKeys.ts`

Change:

- `convex/schema.ts`
- `convex/yjs.ts`
- `convex/yjsAwareness.ts`

## Recommended Execution Order

1. Add device key registration and local secure key storage.
2. Add room key metadata + wrapped-key schema.
3. Teach `/collab/session` to return encryption bootstrap state.
4. Encrypt websocket update payloads.
5. Encrypt awareness payloads.
6. Encrypt snapshot upload and initial sync.
7. Migrate new rooms to encrypted-only mode.
8. Replace local plaintext IndexedDB cache with encrypted persistence.
9. Add key rotation and device revocation UX.

## What We Reuse From The Existing App

- websocket-only collaboration transport
- project membership and join flows
- shared-branch collaboration rule
- Electron safe storage pattern already used for integrations
- current server room/session model

So this is not a fresh collaboration rewrite. It is a security layer on top of the collaboration architecture we already cleaned up.

## Bottom Line

The clean Cozea model is:

- Cozea collaboration is the product
- websocket is the transport
- Convex is persistence and metadata
- the server sees metadata, not file contents
- git stays manual and optional

That is the architecture we should build toward.
