# Payment System Migration (BYO Providers + Managed Credits)

This document describes how Cozea will migrate from the current single-plan/credits billing model to **two subscription families**:

1. **BYO Providers (flat subscription)**: customers pay for access limits (seats/projects/storage) and use their **own provider credentials** to run AI.
2. **Managed Credits (Cozea keys + pooled credits)**: customers pay for a shared monthly credit pool (and optionally packs/overage); AI calls are made with **Cozea-managed provider keys**.

The migration affects the **Electron app**, the **Railway auth gateway** (`server/`), and **Convex** (`convex/`).

---

## Goals

- Offer a BYO subscription family where **Cozea does not pay token costs**:
  - Primary: **per-user OAuth** to provider subscription (OpenAI, Google).
  - Secondary: **workspace-shared API keys** (admin-managed).
- Offer a Managed subscription family where:
  - AI calls use **Cozea keys**.
  - Billing is **credits-based** (workspace pooled).
- Keep subscriptions **workspace-level** (same as today).
- Preserve/extend existing limits enforcement (projects/storage/seats).
- Keep secrets secure:
  - Encrypt tokens/keys at rest in Convex.
  - Never send access/refresh tokens to the renderer or website.

---

## Current System (As-Is)

### Data model

Convex stores workspace billing on `organizations`:

- `organizations.subscription.plan`: `free | pro | max | team | enterprise`
- `organizations.subscription.status`: `active | canceled | past_due | trialing`
- `organizations.credits.*`: monthly subscription credits + purchased lots + overage tracking
- `organizations.aiCredentials`: encrypted org-level keys (`anthropicKey/openaiKey/googleKey/xaiKey`)
- `organizations.aiSettings.byokPolicy`: `required | optional | disabled`

Reference:
- `convex/schema.ts`
- `convex/billing.ts` (subscription update handler)

### Limits

Limits are plan-based helpers:
- Projects + storage: `convex/lib/workspaceLimits.ts`
- Seats: `convex/lib/seatLimits.ts`

### Stripe / billing workflow

Railway gateway handles:
- `POST /stripe/create-checkout` (plan upgrades + credit packs)
- `POST /stripe/create-portal`
- `GET /stripe/invoices`
- `POST /stripe/webhook` (writes subscription/credits into Convex)

Reference:
- `server/src/routes/stripe.ts`
- `convex/billing.ts`

### AI request routing + credit charging

The gateway’s AI route selects an API key source and decides whether to charge credits:

- If `keySource === "organization"`:
  - requires subscription active/trialing
  - checks credits
  - deducts credits and logs usage
- If `keySource === "byok"`:
  - no credit checks
  - logs usage without charging credits

Reference:
- `server/src/routes/ai.ts`
- `convex/aiUsage.ts`

---

## Target System (To-Be)

### Two subscription families

**Family A: BYO Providers (flat subscription, no credits)**

- Intended for teams that want Cozea’s collaboration + product features but pay providers directly.
- AI requests must be authenticated using:
  - Per-user OAuth connection (preferred), OR
  - Workspace-shared API key (fallback; admin only).
- Credits features are disabled for this family (no packs, no overage, no monthly credit ledger).

**Family B: Managed Credits (Cozea keys + pooled credits)**

- Intended for orgs that want a single invoice and shared pool usage.
- AI requests are made with Cozea-managed keys and charged against credits.
- Packs/overage remain available.

### Plan matrix (locked product decision)

**BYO Providers (workspace subscription)**

| Plan | Monthly price | Seats | Projects | Storage |
|------|---------------|-------|----------|---------|
| byo_starter | $15 | 4 | 5 | 5 GB |
| byo_team | $30 | 10 | 20 | 20 GB |
| byo_custom | custom | custom | custom | custom |

**Managed Credits (workspace subscription)**

Credit unit convention: `1 credit = $0.01` (credits represent normalized spend, not tokens).

| Plan | Monthly price | Credits / month | Seats | Projects | Storage |
|------|---------------|-----------------|-------|----------|---------|
| managed_200 | $200 | 25,000 | 15 | 40 | 50 GB |
| managed_500 | $500 | 75,000 | 60 | 150 | 250 GB |
| managed_1000 | $1000 | 180,000 | 200 | 500 | 1 TB |
| managed_custom | custom | custom | custom | custom | custom |

Notes:
- “Custom” plans are represented in Convex as a plan type plus explicit limits/credits fields.
- **Workspace** remains the billing unit (same as today).

---

## Provider Credential Modes

### 1) Per-user OAuth (BYO family)

This is the “use your existing subscription” flow.

- **OpenAI**: use the Codex OAuth flow (PKCE public client), then call the Codex backend endpoint with Bearer token.
  - Reference implementation exists in local repo:
    - `/Users/kelyan/Downloads/opencode-dev/packages/opencode/src/plugin/codex.ts`
  - Key details:
    - OAuth issuer: `https://auth.openai.com`
    - Uses PKCE, stores `refresh_token`, rotates `access_token`
    - Calls Codex endpoint: `https://chatgpt.com/backend-api/codex/responses`
    - Sets `Authorization: Bearer <access_token>`
    - Sets `ChatGPT-Account-Id` when available (for org subscriptions)

- **Google / Gemini**: implement an OAuth flow that yields an access token usable for the “subscription” path.
  - We will mirror community-tested approaches and keep behind a feature flag until stable.

Important constraints:
- OAuth tokens are **encrypted at rest** in Convex.
- OAuth tokens are **never returned** to the Electron renderer; the gateway uses them server-side.

### 2) Workspace-shared API keys (BYO family fallback)

- Admin stores `organizations.aiCredentials.<providerKey>` (already exists).
- These calls are treated as `keySource = "byok"` (no credits).
- This is not “use subscription”; it’s traditional BYOK keys (but shared at workspace level).

### 3) Cozea-managed keys (Managed family only)

- Gateway uses provider keys from environment (or a controlled secret store).
- `keySource = "organization"`, credits enforced.

---

## Data Model Changes (Convex)

### `organizations.subscription`

Add:
- `family: "byo" | "managed"`
- `planV2: <new plan union>`
- (optional) `legacyPlan` for backward compatibility during rollout

Add optional per-plan override fields (for custom plans):
- `limits: { seats, projects, storageBytes }`
- `managedCreditsPerMonth` (managed family only)

Rationale:
- We need to represent **two different plan catalogs** without overloading the current `plan` field.
- We need to preserve existing orgs on `free/pro/max/team/enterprise` until migrated.

### New table for per-user provider connections

Add `userProviderConnections` (or similar) to store encrypted tokens:
- `userId`
- `provider: "openai" | "google" | ...`
- `connectionType: "oauth"`
- `encrypted`: `{ accessToken?, refreshToken, expiresAt, metadata }`
- `status: "active" | "expired" | "revoked" | "needs_reauth"`
- indexes: `by_user`, `by_user_and_provider`

Encryption:
- Use existing `convex/lib/encryption.ts` utilities.

Server-only access:
- Queries that return token material must require `AI_GATEWAY_SECRET` (pattern already used by `users:getByWorkosIdForServer` and `organizations:getByWorkosIdForServer`).

---

## Gateway Changes (Railway)

### Billing routes

`/stripe/*` routes must be updated to support:
- Creating checkout sessions for:
  - BYO subscription plans (2+custom)
  - Managed subscription plans (3+custom)
  - Optional managed credit packs (if retained)
- Portal sessions for subscription management

Environment variables:
- Replace plan price env vars with a new set that matches the new catalog (do not hardcode Stripe price IDs in code).
- Keep `stripeCatalog` Convex table in sync for UI display if we continue using it.

### Settings endpoints

The gateway should expose a single context endpoint for the app/website to render:
- subscription family + plan
- current limits (resolved)
- current credit status (managed family only)
- provider connection status (per-user OAuth + org shared key)

### AI routes

AI routing becomes:

1. Resolve workspace subscription family.
2. If `family === "byo"`:
   - DO NOT use Cozea-managed server keys.
   - Resolve provider auth in order:
     1) user OAuth for provider (if supported and connected)
     2) org shared API key (if present)
   - If none: return `402` with “Connect provider” action.
   - Always set `keySource = "byok"` and skip credit checks.
3. If `family === "managed"`:
   - Use Cozea-managed server keys only.
   - Enforce subscription + credits as today.

Fail-closed rules:
- If subscription family is unknown or lookup fails: reject the request.
- If BYO family and OAuth token refresh fails: treat as disconnected and return “reconnect”.

---

## App UI Changes (Electron)

### Billing page

Replace “Available Plans” with a two-family picker:
- Tab 1: **Bring your own provider**
  - shows BYO plan tiers + limits
  - “Upgrade” triggers checkout for BYO plans
  - hides credits UI (usage chart shows requests/tokens, not credits)
- Tab 2: **Managed credits**
  - shows managed plan tiers + monthly credits
  - includes “Buy credits” packs and portal link

### AI page

Split connections into:
- **Connect provider account** (per-user OAuth)
  - shows status + connect/disconnect
  - only shown when supported and family allows it
- **Workspace shared API keys** (admin only)
  - existing UI for `organizations.aiCredentials.*`
  - shown only for BYO family (or optionally for legacy)

---

## Migration Strategy

### Phase 0: Add V2 fields behind flags

- Introduce new schema fields and keep existing behavior when unset:
  - existing orgs continue using `subscription.plan` and current credit rules
  - new orgs can be created with `subscription.family/planV2`
- Add a feature flag in gateway:
  - `BILLING_V2_ENABLED=true|false`

### Phase 1: Stripe catalog + checkout support

- Create Stripe products/prices for:
  - `byo_starter`, `byo_team`
  - `managed_200`, `managed_500`, `managed_1000`
- Update gateway to accept `planV2` values and map to correct prices.

### Phase 2: Introduce BYO family in production (opt-in)

- Enable BYO for a test workspace first.
- Validate:
  - upgrades/downgrades
  - limits enforcement
  - OAuth connection success and token refresh stability

### Phase 3: Migrate existing workspaces

Decide mapping rules (example):
- Legacy `free` -> BYO starter (or BYO “legacy free” if we keep a free tier)
- Legacy `pro/max/team` -> Managed equivalent (or stay legacy until pricing cutoff)
- Legacy `enterprise` -> Managed custom

Perform migration via a server-only Convex mutation:
- patches `subscription.family/planV2`
- preserves `subscription.plan` as `legacyPlan` for audit
- recalculates credits fields only for managed family

### Phase 4: Remove legacy paths

- Once all orgs are migrated, remove:
  - references to old plan enum
  - old Stripe price env vars
  - legacy UI sections

---

## Security & Compliance Notes

- Store all provider tokens/keys encrypted using `convex/lib/encryption.ts`.
- Never return raw tokens/keys from Convex queries except server-only queries protected by `AI_GATEWAY_SECRET`.
- Gateway should not log secrets:
  - scrub `Authorization` headers and token payloads from logs
- Provide “disconnect” and “revoke” flows:
  - mark connection revoked and delete encrypted refresh token

---

## Testing Checklist

### Billing / Stripe

- Checkout session creation succeeds for each new plan.
- Portal sessions open correctly and return URLs land on billing page.
- Webhook updates correct fields in Convex for each plan.
- Switching between families requires explicit confirmation and behaves correctly.

### Limits

- BYO starter: cannot exceed 4 seats, 5 projects, 5GB storage.
- BYO team: cannot exceed 10 seats, 20 projects, 20GB storage.
- Managed plans enforce their limits.

### AI routing

- BYO family:
  - with user OAuth connected: AI call succeeds, no credits charged
  - with no OAuth but org API key present: AI call succeeds, no credits charged
  - with no credentials: AI call fails with actionable “connect provider”
- Managed family:
  - credits deducted and enforced
  - packs/overage work as expected

### OAuth reliability

- Token refresh works.
- Expired/revoked refresh token yields “reconnect” without leaking token details.

---

## Open Questions (must be locked before final rollout)

1. Do we keep a **free** tier after migration?
2. Which “subscription OAuth” providers are supported at launch:
   - OpenAI Codex only?
   - Google Gemini OAuth?
   - Anthropic (likely API key only initially)?
3. How do we handle “family switching” for existing managed credits:
   - credits forfeited immediately?
   - carry-over until period end?
4. Do we keep purchased credit packs in Managed family?

