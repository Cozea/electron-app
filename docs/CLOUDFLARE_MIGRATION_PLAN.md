# Cloudflare Collaboration Reset

Updated: 2026-04-18

## Decision

We are not doing a conservative Railway-to-Cloudflare lift-and-shift.

We are replacing the current Railway-hosted collaboration gateway with a Cloudflare-native collaboration backend and using this migration to simplify the architecture before external access is opened.

The new target is:

- Convex stays
- Railway goes away
- Fastify collaboration gateway goes away
- Cloudflare Workers becomes the public collaboration edge
- Cloudflare Durable Objects becomes the realtime coordination layer

This is an architecture reset, not a hosting change.

## Repository Status

The migration is now partially scaffolded in-repo so the plan has an executable target:

- [`cloudflare/worker/package.json`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/package.json:1)
- [`cloudflare/worker/wrangler.jsonc`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/wrangler.jsonc:1)
- [`cloudflare/worker/src/index.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/index.ts:1)
- [`cloudflare/worker/src/durableObjects/CollabRoom.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/durableObjects/CollabRoom.ts:1)
- [`docs/cloudflare/worker/PROTOCOL.md`](/Users/admin/Downloads/electron-app-main/docs/cloudflare/worker/PROTOCOL.md:1)

This scaffold is intentionally not wired into production yet. It defines the target contract and removes ambiguity about what the Cloudflare replacement actually is.

## Immediate Next Build Steps

The scaffold turns the migration into four concrete implementation tracks:

1. Replace the stubbed Convex bridge in [`cloudflare/worker/src/lib/convex.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/lib/convex.ts:1) with real Convex HTTP actions for:
   - device-backed session bootstrap
   - project access verification
   - Yjs delta fetch
   - Yjs update persistence
2. Update the Electron client to speak protocol v2 while keeping the current backend temporarily available behind a feature flag.
3. Stand up a Cloudflare environment with Durable Object bindings and secrets, then verify:
   - session bootstrap
   - websocket hello
   - delta replay
   - update persistence
   - presence fanout
4. Delete the Railway/Fastify collaboration path only after Cloudflare has passed parity testing.

## Implementation Status

As of this pass, the in-repo migration is no longer just a scaffold.

Implemented:

- the Cloudflare worker session route now uses real Convex calls for:
  - local device profile bootstrap
  - project access verification
  - collab device registration
  - encryption bootstrap lookup
- the Durable Object now uses Convex for:
  - Yjs delta replay
  - Yjs update persistence
  - awareness persistence and hydration
- the Electron renderer now speaks the Cloudflare v2 websocket protocol:
  - `ready`
  - `sync.request`
  - `sync.delta`
  - `update.push`
  - `update.ack`
  - `presence.push`
  - `presence.snapshot`
  - `presence.remove`
- the collaboration session hook now supports a dedicated `VITE_COLLAB_BASE_URL` and no longer assumes cookie-backed gateway auth

Files:

- [`cloudflare/worker/src/lib/convex.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/lib/convex.ts:1)
- [`cloudflare/worker/src/routes/collabSession.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/routes/collabSession.ts:1)
- [`cloudflare/worker/src/durableObjects/CollabRoom.ts`](/Users/admin/Downloads/electron-app-main/cloudflare/worker/src/durableObjects/CollabRoom.ts:1)
- [`src/hooks/useCollabSession.ts`](/Users/admin/Downloads/electron-app-main/src/hooks/useCollabSession.ts:1)
- [`src/lib/yjs/CollabWsProvider.ts`](/Users/admin/Downloads/electron-app-main/src/lib/yjs/CollabWsProvider.ts:1)

## Remaining Work

What remains is operational, not architectural:

- add Cloudflare Worker secrets and bindings
- point the desktop app at the Cloudflare collab base URL
- deploy the worker
- verify end-to-end session bootstrap and live sync against the deployed environment

## Required Configuration

Cloudflare Worker secrets / vars:

- `CONVEX_URL`
- `AI_GATEWAY_SECRET`
- `COLLAB_JWT_SECRET`
- Durable Object binding: `COLLAB_ROOM`

Desktop / frontend env:

- `VITE_COLLAB_BASE_URL`

At that point the remaining decision is whether to keep the old Railway/Fastify path around temporarily for rollback or delete it immediately after validation.

## Product Constraint

We are still pre-access.

That means:

- we do not need to preserve accidental backend contracts just because they exist today
- we do not need to preserve the current Railway/Fastify implementation shape
- we should optimize for a simpler and more defensible long-term system, not migration comfort

## Why Be Radical Now

The current hosted backend is already mismatched with local expectations.

Symptoms:

- `POST /collab/session` returning `401` in production while the local repository does not model that route as cookie/session-auth dependent
- unclear split between local-device identity, Convex identity, and deployed session behavior
- a thin backend layer on Railway that mainly exists to terminate websockets and mint collaboration sessions

That is exactly the kind of architecture drift that should be removed before public rollout.

If we wait:

- more client code will harden around the current shape
- more implicit auth assumptions will leak into the product
- the cost of replacing Railway will go up

## Non-Negotiable Rules

1. Convex remains the durable system of record.
2. Cloudflare Durable Objects handle realtime room coordination.
3. No browser-cookie auth dependency exists in the Electron collaboration path.
4. Device identity is the root of desktop collaboration auth.
5. Durable Objects do not become a second durable database.
6. The production backend must match the repository architecture exactly.

## Current Architecture

### What Exists Today

Hosted backend responsibilities:

- `GET /`
- `GET /health`
- `GET /collab/capabilities`
- `POST /collab/session`
- websocket upgrade and room coordination at `/collab/ws`

Current implementation files:

- [`server/src/server/app.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/app.ts:1)
- [`server/src/server/core.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/core.ts:1)
- [`server/src/server/services/collabRuntime.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/services/collabRuntime.ts:1)
- [`server/src/routes/collab.ts`](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts:1)
- [`server/src/lib/convex.ts`](/Users/admin/Downloads/electron-app-main/server/src/lib/convex.ts:1)

### What Convex Already Owns

Convex already owns the parts that should stay authoritative:

- local device profile creation
- project access checks
- Yjs update persistence
- snapshots
- encryption bootstrap
- wrapped keys
- awareness persistence
- tombstones and delete conflict semantics

That is good. We should lean into it.

### What Is Accidental Complexity

The following are not strategic assets:

- Fastify as the collaboration runtime shell
- Railway as the collaboration host
- Node `ws` server coordination logic
- any implicit browser-session or cookie assumptions for Electron collaboration
- protocol decisions made only to fit a stateless Node gateway

## Target Architecture

### Layer 1: Electron Client

Responsibilities:

- local device identity generation and storage
- desktop renderer/session behavior
- Yjs document handling
- collaboration bootstrap request
- websocket client

This remains in the app.

### Layer 2: Cloudflare Worker

Responsibilities:

- public HTTP entrypoint
- `GET /health`
- `GET /collab/capabilities`
- `POST /collab/session`
- websocket upgrade entry
- request validation
- edge-level rate limiting and abuse controls
- collab JWT minting

This replaces the public Railway gateway.

### Layer 3: Cloudflare Durable Object

Responsibilities:

- one room coordinator per collaboration room
- websocket termination
- room membership registry
- fanout
- presence coordination
- client `knownSeq` tracking
- reconnect coordination
- ephemeral awareness state
- stale socket cleanup

This replaces the current room coordination logic in the Node server.

### Layer 4: Convex

Responsibilities:

- durable identity and authorization
- Yjs update durability
- snapshots
- encryption bootstrap
- wrapped key storage
- project membership checks
- file tombstone and delete conflict support

This remains the durable backend.

## Auth Reset

### Current Problem

The current auth model is understandable locally but muddy in production:

- app auth is device-based in [`AuthContext.tsx`](/Users/admin/Downloads/electron-app-main/src/contexts/AuthContext.tsx:1)
- collaboration bootstrap in production is still behaving like it may depend on an HTTP session or older gateway assumptions

That ambiguity must be removed.

### New Auth Model

The collaboration path should have one and only one desktop auth model:

1. Electron creates or restores a local device identity.
2. The app ensures a local device profile in Convex.
3. The client asks the Worker for a collab session using:
   - `projectId`
   - device identity metadata
   - device public key data
4. The Worker asks Convex:
   - who is this device-backed user
   - can they edit this project
   - what is the encryption bootstrap state
5. The Worker returns a short-lived collaboration JWT.
6. The Durable Object accepts only verified collaboration JWTs.

### Explicitly Removed

The Electron collaboration path must not require:

- browser cookies
- WorkOS web session cookies
- shared login state with a browser tab
- Railway-era middleware assumptions

### Collaboration Token Rules

The collab JWT is:

- short-lived
- scoped to one project and one room
- scoped to one device
- signed by Cloudflare Worker secret
- verified by Worker and Durable Object

Claims should include:

- `projectId`
- `roomId`
- `userId`
- `deviceId`
- `clientType`
- `protocolVersion`

Claims that only exist because of old gateway assumptions should be removed if not needed.

## Room Model

### Room Identity

Each collaboration room gets one Durable Object instance.

Initial rule:

- `roomId = projectId` unless we explicitly introduce sub-rooms later

### What Lives In The Room Object

- active websocket connections
- connection metadata
- ready state
- presence state
- per-client `knownSeq`
- room heartbeat and cleanup timers
- transient awareness cache

### What Does Not Live In The Room Object

- project membership truth
- device registration truth
- durable Yjs history
- encryption source of truth
- anything that must survive object eviction as business state

If it matters after eviction, it belongs in Convex.

## Protocol Reset

### Allowed To Change

We are allowed to change:

- HTTP route payloads
- websocket message schema
- reconnect flow
- sequencing model
- awareness flow

as long as the resulting system is cleaner and the Electron client is updated accordingly.

### Protocol Design Goals

The new protocol should:

1. minimize messages
2. make room coordination explicit
3. distinguish durable sync from transient fanout
4. separate bootstrap auth from room traffic
5. be easy to reason about under reconnect

### Recommended Message Types

Do not blindly preserve the current Fastify-era message shapes. Prefer a cleaner protocol such as:

- `hello`
- `ready`
- `sync.request`
- `sync.delta`
- `update.push`
- `update.ack`
- `presence.push`
- `presence.snapshot`
- `error`

The final message format should be versioned from day one.

## Recommended Flow

### Session Bootstrap

1. Renderer gets local device identity from Electron.
2. Renderer `POST`s to Cloudflare `/collab/session`.
3. Worker validates payload.
4. Worker calls Convex:
   - `users:ensureLocalDeviceProfile`
   - `projectMembers:getProjectAccessForServer`
   - `yjs:registerCollabDevice`
   - `yjs:getEncryptionBootstrap`
5. Worker signs collab JWT.
6. Worker returns:
   - `roomId`
   - `collabWsUrl`
   - `token`
   - `protocolVersion`
   - encryption bootstrap data

### WebSocket Connect

1. Renderer opens websocket to Cloudflare.
2. Worker routes by `roomId` into Durable Object.
3. Client sends `hello`.
4. Durable Object verifies JWT.
5. Durable Object binds connection into room.
6. Durable Object returns `ready` plus any required room snapshot metadata.

### Sync

Durable sync remains backed by Convex.

Recommended split:

- Durable Object handles room coordination and fanout
- Convex handles authoritative persisted updates and snapshots

That means:

- live message fanout is fast and room-local
- reconnect and durability still come from Convex

### Presence

Presence should be coordinated in the Durable Object first.

Only persist to Convex if there is a product reason to read presence outside the room object.

If Convex persistence of awareness exists only because the old server needed it, remove it.

## What We Are Deleting

The end state should delete the collaboration server path under `server/` entirely unless a non-collab server use case still remains.

Delete after cutover:

- [`server/src/server/app.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/app.ts:1)
- [`server/src/server/core.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/core.ts:1)
- [`server/src/server/services/collabRuntime.ts`](/Users/admin/Downloads/electron-app-main/server/src/server/services/collabRuntime.ts:1)
- [`server/src/routes/collab.ts`](/Users/admin/Downloads/electron-app-main/server/src/routes/collab.ts:1)
- [`server/src/entrypoints/all.ts`](/Users/admin/Downloads/electron-app-main/server/src/entrypoints/all.ts:1)
- [`server/src/entrypoints/collab-runtime.ts`](/Users/admin/Downloads/electron-app-main/server/src/entrypoints/collab-runtime.ts:1)

Keep temporarily only as reference during implementation.

## New Code Layout

Recommended new structure:

- `cloudflare/worker/src/index.ts`
- `cloudflare/worker/src/routes/health.ts`
- `cloudflare/worker/src/routes/collabCapabilities.ts`
- `cloudflare/worker/src/routes/collabSession.ts`
- `cloudflare/worker/src/durableObjects/CollabRoom.ts`
- `cloudflare/worker/src/lib/convex.ts`
- `cloudflare/worker/src/lib/jwt.ts`
- `cloudflare/worker/src/lib/protocol.ts`
- `cloudflare/worker/src/lib/validation.ts`

Optional:

- `cloudflare/worker/wrangler.jsonc`
- `cloudflare/worker/test/`

## Phase Plan

### Phase 1: Define The New Contract

Deliverables:

- new collaboration protocol spec
- new `/collab/session` request/response schema
- new websocket message schema
- explicit auth model doc

Acceptance:

- no reference to cookie/session auth remains in the collab architecture
- all auth depends on device identity + Convex access + collab JWT

### Phase 2: Build Cloudflare Worker

Deliverables:

- Worker app scaffold
- health and capabilities routes
- Convex integration wrapper
- secret handling

Acceptance:

- Worker deploys to staging
- Worker can call Convex successfully

### Phase 3: Build Session Issuance

Deliverables:

- `POST /collab/session`
- device-based access resolution
- encryption bootstrap pass-through
- collab JWT issuance

Acceptance:

- Electron client can obtain a collab session without any browser-cookie dependency

### Phase 4: Build Durable Object Room Runtime

Deliverables:

- room coordinator object
- websocket upgrade path
- hello/ready handshake
- room fanout
- reconnect handling
- presence handling

Acceptance:

- two clients can join the same room and exchange updates
- invalid tokens are rejected cleanly

### Phase 5: Rewrite Client Integration

Deliverables:

- update [`useCollabSession.ts`](/Users/admin/Downloads/electron-app-main/src/hooks/useCollabSession.ts:1)
- update [`CollabWsProvider.ts`](/Users/admin/Downloads/electron-app-main/src/lib/yjs/CollabWsProvider.ts:1)
- update [`YjsProjectContext.tsx`](/Users/admin/Downloads/electron-app-main/src/contexts/YjsProjectContext.tsx:1)
- remove any logic preserved only for Railway/Fastify quirks

Acceptance:

- client is natively aligned with the Cloudflare backend
- no compatibility shims remain without a clear purpose

### Phase 6: Remove Railway And Old Server

Deliverables:

- delete old collaboration gateway code
- remove Railway deploy path
- update environment docs and deployment docs

Acceptance:

- Cloudflare + Convex is the only collaboration backend

## Security Model

### Secrets

Store in Cloudflare:

- `CONVEX_URL`
- `AI_GATEWAY_SECRET` if still needed for server-only Convex queries
- `COLLAB_JWT_SECRET`

Never expose these to the renderer.

### Request Validation

All public routes must validate:

- input schema
- allowed origin policy
- request rate limits

All websocket sessions must validate:

- JWT signature
- audience
- expiry
- room/project match
- client type if relevant

### Abuse Resistance

We are not public yet, but we should still build this correctly:

- per-IP session route limits
- per-device session route limits
- per-room connection ceilings
- invalid token fast-reject path

## Testing Plan

### Unit Tests

Add tests for:

- session issuance input validation
- token mint/verify
- room routing
- invalid hello rejection
- presence merge behavior
- reconnect and seq handling

### Integration Tests

Add tests for:

- session bootstrap against Convex staging/dev
- websocket connect and room join
- live update fanout
- reconnect with missed updates
- encryption bootstrap handling

### Manual QA

Required scenarios:

1. Open the same project in two local clients and verify live updates.
2. Disconnect one client and reconnect it after edits occurred.
3. Verify token expiry behavior.
4. Verify unauthorized device/project pairing is rejected.
5. Verify two rooms do not leak updates or presence.
6. Verify hidden workspace runtimes do not trigger auth noise when no active collab session can be established.

## Risks

### Risk 1: Rebuilding Too Much At Once

Mitigation:

- keep Convex untouched as the durable layer
- limit the rewrite to the collaboration edge and room coordination layer

### Risk 2: Repeating Auth Ambiguity

Mitigation:

- forbid cookie/session auth in the Electron collaboration path
- document the auth chain explicitly

### Risk 3: Durable Objects Becoming A Database

Mitigation:

- keep Durable Objects ephemeral and coordination-only

### Risk 4: Preserving Old Protocol Baggage

Mitigation:

- treat existing protocol as reference only
- redesign where it meaningfully simplifies the client/backend interaction

## Success Criteria

This reset is complete when:

1. Electron collaboration bootstraps from Cloudflare only.
2. No Railway infrastructure remains in the collaboration path.
3. No browser-cookie auth assumption exists in the desktop collaboration flow.
4. Durable Objects coordinate rooms.
5. Convex remains the durable authority.
6. The backend is simpler than the current Railway/Fastify version, not just relocated.

## Direct Implementation Recommendation

Do not start by porting Fastify.

Start in this order:

1. define the new Cloudflare-native session + websocket contract
2. implement the Worker session route
3. implement the Durable Object room runtime
4. update the Electron client to the new contract
5. delete the old Railway collaboration server

That is the cleanest path because we are still pre-access and do not need to carry old backend mistakes forward.
