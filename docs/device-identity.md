# Device Identity

Last reviewed: 2026-09-06

## Product model

Cozea has no human account or login layer. One physical Cozea installation is one independent device principal.

- `identityKey` is the sole public immutable device identity and uses `czd_<26 Crockford-base32 characters>`.
- `principalId` is the internal Convex `devicePrincipals` document ID used by database relationships. It is not a public product identity.
- There are no public `deviceId` or `userId` aliases for `identityKey`.
- `displayName` and avatar are mutable presentation metadata only; changing them never changes authentication, membership, key ownership, or encrypted-room access.
- Organizations are groups of device principals and use public `czg_<opaque id>` identifiers.
- Public IDs are identifiers, not credentials. Possession of a `czd_…` or `czg_…` value grants no authority.
- Private signing and encryption keys never leave Electron secure storage and are never exposed to the renderer or clipboard.

This is a breaking pre-user cutover. Old UUID/email/account identity rows, cached account-shaped sessions, and identity aliases are intentionally unsupported rather than migrated.

## Device keys

Electron creates two independent P-256 keypairs in `electron/collabKeys.ts`:

- ECDH P-256 encrypts and unwraps collaboration room keys.
- ECDSA P-256 signs authentication challenges.

The encrypted `device-identity.bin` record is schema version 3 and stores cryptographic machine identity only: `identityKey`, platform, public/private key material, fingerprints, and creation metadata. OS hostname or display name is not persisted as identity state. An obsolete local identity record is replaced rather than compatibility-upgraded. Plaintext storage exists only behind `COZEA_ALLOW_INSECURE_DEVICE_IDENTITY=1` for explicit testing.

## Authentication flow

1. Electron sends `identityKey`, platform, and the registered public signing/encryption material to `POST /auth/device/challenge`. Mutable presentation is not an authentication claim.
2. The Cloudflare worker persists a rate-limited, short-lived challenge nonce in Convex.
3. Electron signs the exact challenge envelope with the device ECDSA private key.
4. `POST /auth/device/complete` verifies and atomically consumes the challenge. A new principal binds both signing and ECDH public identities. An existing principal must present the exact registered signing and ECDH identities; authentication cannot rotate either key.
5. The worker returns a short-lived ES256 access token whose subject is the device `identityKey`, with a unique `jti`, signing-key version, and token issuance boundary.
6. The renderer gives that token to Convex. Convex validates it against the worker JWKS endpoint and resolves the internal `principalId` from the authenticated subject.

Convex checks active/revoked state, signing-key version, and `tokenValidAfter` on authenticated public functions. Sensitive worker paths perform the corresponding live-state checks. Presentation updates are separate authenticated operations and never mutate key or authorization state.

The collaboration session endpoint requires the device bearer, derives the canonical principal from it, and verifies project edit authority. Callers do not submit a second identity alias to select another principal.

## Presentation and avatars

A freshly registered principal has explicit presentation lifecycle state. First-run onboarding asks for a required device display name and an optional avatar; there is no account creation form.

Avatar bytes are optimized in the desktop and uploaded through an authenticated Convex action. The server validates the bounded WebP payload, owns the storage write, records the resulting storage object on the authenticated principal, and cleans up superseded objects. A caller cannot claim an arbitrary pre-existing storage object as its avatar.

## Device groups

An authenticated device can create a group and copy its public `czg_…` ID. An admin creates a pending enrollment for another initialized `czd_…` device. The target must authenticate and explicitly accept before membership exists. Membership records reference internal principal IDs while UI and sharing surfaces expose canonical device presentation and public identity keys.

Removing a member removes project authorization, revokes that principal's wrapped room keys for group projects, and marks affected encrypted rooms for rotation. Pending key requests are never automatically approved by the live collaboration controller.

## Recovery and revocation

- A trusted active admin can enroll a replacement device by its new `czd_…` identity.
- Group recovery creates a bounded one-time recovery credential without cloning a lost device's identity or keys.
- Resetting local identity globally self-revokes the old principal, increments its signing-key version, deletes local private keys, and creates a fresh `czd_…` identity after reload.
- The new principal does not inherit the old principal's project/group membership or wrapped room keys.
- Security-sensitive challenge, enrollment, recovery, and revocation events are recorded without private key material or raw recovery credentials.

## Destructive pre-user cutover

There is deliberately no compatibility migration for the old user/account model. Before deploying this branch to a shared or production Convex deployment:

1. Export any development/test cloud data that is actually worth retaining. Do not treat old identity rows as authoritative input to the new model.
2. Remove/reset obsolete account-era identity, membership, invitation, trusted-device, collaboration-device, and cached test data using the approved Convex dashboard/admin maintenance path for that deployment. Do not invent a `convex reset` CLI command.
3. Preserve local project working directories; source code on disk is independent of the cloud identity reset.
4. Deploy the Cloudflare worker/JWKS configuration and Convex schema/functions as one coordinated cutover.
5. Deploy Convex with `bunx convex deploy`. Never run `convex dev` in this repository.
6. Restart/reinitialize desktop clients whose old local bootstrap/session or pre-v3 identity data is incompatible. They intentionally become fresh device principals rather than inheriting old cloud authority.
7. Run the packaged two-device collaboration acceptance flow before enabling the collaboration feature broadly.

## Required deployment configuration

The Cloudflare worker requires the device-auth/gateway configuration used by the current worker, including the challenge secret, gateway secret, issuer/audience, current ES256 keypair/key ID, optional previous public key during rotation, and `CONVEX_URL`.

Convex requires matching `COZEA_DEVICE_AUTH_ISSUER`, `COZEA_DEVICE_AUTH_AUDIENCE`, and `AI_GATEWAY_SECRET` values. Desktop builds use `VITE_AUTH_SERVER_URL` (or `VITE_COLLAB_BASE_URL`) for the issuer/gateway base URL.

Deploy the worker first so JWKS is reachable, then use `bunx convex deploy`. Never use `convex dev`. Do not point clients at a custom hostname until that hostname is actually attached to the worker.

## Convex authorization boundary

Authenticated public Convex functions derive the acting device principal from `ctx.auth`. Server-only gateway functions use the server-secret boundary. Project, organization, DevApp, presence, and collaboration APIs use `principalId` for internal relationships and `identityKey` only where the public cryptographic identity is required. Presentation fields are never authority.

Regression tests enforce the account-free schema, alias-free transport, direct-principal membership, immutable signing/ECDH binding, server-owned avatar storage, and authenticated endpoint boundary.
