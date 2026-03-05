# OpenCode Provider Auth Notes (Local-Only Credentials)

This project now references the OpenCode OAuth pattern for provider-connected AI billing.

## Source inspected

- `external/opencode/packages/opencode/src/plugin/codex.ts`
- `external/opencode/packages/opencode/src/auth/index.ts`

## What OpenCode does

- Uses OpenAI OAuth with issuer `https://auth.openai.com`.
- Uses PKCE + state + local callback handling.
- Exchanges authorization code for access/refresh tokens.
- Refreshes tokens when expired.
- Stores auth locally on the machine (`auth.json`, owner-only permissions).
- Sends account headers (`ChatGPT-Account-Id`) and calls provider endpoints with bearer auth.

## Required direction for Cozea

To match the requested model:

- Do not monetize AI tokens/credits.
- AI charges are paid directly by each user's connected provider subscription.
- Workspace subscription monetizes collaboration infra (storage, project count, seats, sync/CRDT).
- Provider credentials must be local to each user machine, not stored in Convex.

## Implementation plan

1. Add Electron-side provider auth service:
- PKCE flow helper.
- OAuth callback handler.
- Token refresh logic.
- Local encrypted persistence via `safeStorage` under `app.getPath('userData')`.

2. Expose secure IPC methods:
- `providerAuth:connect(provider)`
- `providerAuth:disconnect(provider)`
- `providerAuth:getStatus()`
- `providerAuth:getAccessToken(provider)` (main-process only use; never expose raw tokens to renderer if avoidable)

3. Route AI execution through Electron for provider-auth requests:
- Resolve provider token locally per user.
- Attach provider auth headers in main/gateway path.
- Keep only usage/tokens telemetry in Convex.

4. Keep existing workspace `aiCredentials` only as temporary compatibility fallback.
- Mark fallback path as legacy.
- New default path should be local provider session.

## Current migration status

- Workspace billing/limits updated toward infra-only tiers.
- Credit lock checks removed from AI request routes.
- `provider_auth_required` errors now direct users to connect a provider.
- Full OpenCode-style local OAuth credential flow is not wired yet.
