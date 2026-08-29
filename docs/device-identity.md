# Device Identity

Last reviewed: 2026-08-29

## Product model

Cozea has no separate human account in the beta identity model. One physical device is one
user principal:

- `deviceId === userId === identityKey`
- new public identity IDs use `czd_<26 Crockford-base32 characters>`
- organizations are groups of device principals and use `czg_<opaque id>`
- both IDs are public, copyable identifiers; possession of an ID never authenticates a device
- the private signing and encryption keys never leave Electron secure storage and are never
  exposed to the renderer or clipboard

This is a clean cutover. Pre-cutover UUID identities and email-based organization membership are
not migrated or accepted by the new identity path. Historical production test rows remain
storage-valid only so deployment does not delete data; access helpers reject rows without valid
`czd_` or `czg_` identities.

## Device keys

Electron creates two independent P-256 keypairs in `electron/collabKeys.ts`:

- ECDH P-256 encrypts and unwraps collaboration room keys
- ECDSA P-256 signs authentication challenges

The encrypted `device-identity.bin` record is schema version 2. If an older record is found it is
replaced with a new device identity; there is no compatibility upgrade. Plaintext storage remains
available only behind `COZEA_ALLOW_INSECURE_DEVICE_IDENTITY=1` for explicit local testing.

## Authentication flow

1. The desktop sends its public ID, public keys, and public metadata to
   `POST /auth/device/challenge` on the Cloudflare worker.
2. The worker persists a rate-limited, two-minute, HMAC-protected challenge nonce in Convex.
3. Electron signs that exact envelope with the device ECDSA private key.
4. `POST /auth/device/complete` verifies both the worker envelope and device signature, atomically
   consumes the nonce, then binds the public ID to the signing key through the server-secret path.
5. The worker returns a 15-minute ES256 access token with fixed issuer/audience and
   `sub === device_id`, a unique `jti`, the device's `key_version`, and a custom
   `token_issued_at` copy because Convex intentionally does not expose the standard `iat`
   housekeeping claim to functions.
6. The renderer gives that token to the Convex client. Convex validates it against the worker's
   `/.well-known/jwks.json` endpoint.

Convex checks active/revoked state, `key_version`, and `tokenValidAfter` on every authenticated
public query and mutation. The Worker performs the same live-state check before sensitive
gateway work. JWKS can publish the current and one previous public key during a no-downtime
issuer rotation; only the current private key issues new tokens.

The collaboration session endpoint also requires this bearer token, verifies that its subject
matches the requested device, verifies the registered ECDH public key, and rejects projects for
which the device lacks edit access.

## Device groups

An authenticated device can create a group and copy its public `czg_…` ID. An admin creates a
seven-day pending enrollment for another initialized `czd_…` device. The target must explicitly
accept before membership exists. Admins can cancel pending enrollments, change roles, transfer
ownership, and revoke a member; the backend guarantees that a group retains an admin and that
its owning admin is transferred before removal or demotion.

Group membership propagates to projects attached to that group. Removing a member immediately
removes project authorization, revokes that device's wrapped room keys for group projects, and
marks affected encrypted rooms as needing key rotation. Project Settings exposes the required
rotation and explicit approval of pending key requests; the collaboration controller never
automatically grants a pending device a room key.

## Recovery and revocation

- A trusted active admin can invite a replacement device by its new `czd_…` ID.
- An admin can create one high-entropy, one-time group recovery code. Creating another code
  revokes the prior one; codes expire after 30 days and are stored only as keyed verifiers.
- A replacement device redeems the code with its own authenticated identity and becomes a group
  admin. It never receives or clones the lost device's private key or device ID.
- Removing a device from a group is scoped to that group. Resetting the local identity performs
  global self-revocation, increments the signing-key version, erases the local private keys, and
  creates a fresh identity after reload. The old ID remains permanently revoked.
- Security-sensitive challenge, enrollment, recovery, and revocation events are recorded in the
  identity audit stream without private key material or raw recovery codes.

## Required deployment configuration

The Cloudflare worker requires these secrets/variables:

- `COLLAB_JWT_SECRET`
- `DEVICE_AUTH_CHALLENGE_SECRET`
- `AI_GATEWAY_SECRET`
- `DEVICE_AUTH_ISSUER`
- `DEVICE_AUTH_AUDIENCE`
- `DEVICE_AUTH_PRIVATE_JWK` (P-256 private JWK; secret)
- `DEVICE_AUTH_PUBLIC_JWK` (matching public JWK)
- `DEVICE_AUTH_KEY_ID`
- `DEVICE_AUTH_PREVIOUS_PUBLIC_JWK` and `DEVICE_AUTH_PREVIOUS_KEY_ID` during an optional issuer
  rotation overlap
- `CONVEX_URL`

The Convex production deployment requires matching `COZEA_DEVICE_AUTH_ISSUER` and
`COZEA_DEVICE_AUTH_AUDIENCE` values plus its matching `AI_GATEWAY_SECRET`. The desktop build uses
`VITE_AUTH_SERVER_URL` (or `VITE_COLLAB_BASE_URL`) for the issuer/gateway base URL.

Deploy the worker first so JWKS is reachable, then use `bunx convex deploy`. Never use
`convex dev` in this repository.

The production issuer currently runs at
`https://cozea-collab.kelyan-engone.workers.dev`. The Worker and production Convex deployment
were updated together on 2026-08-29. `api.cozea.app` is not currently attached because its
Cloudflare zone is not owned or discoverable from the Worker's account; do not configure clients
to use that hostname until the zone is explicitly connected.

## Convex authorization boundary

Every public Convex query and mutation is now defined through the authenticated function boundary,
except deployment operations whose names end in `ForServer` and require the gateway secret. The
boundary resolves the canonical device from `ctx.auth`, rejects revoked or stale tokens, rejects
legacy caller identity fields that do not match that device, and checks project access before the
handler runs. Destructive maintenance is internal-only. A regression test inventories this rule so
a newly exported unauthenticated endpoint fails CI.
