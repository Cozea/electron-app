# Plan 002 — Stop trusting client-asserted identity in Convex (design-gated)

- **Status**: TODO — **blocked on a Phase 0 product decision by the maintainer**
- **Written against**: commit `8a807045` (dirty working tree; see Drift check)
- **Category**: security
- **Effort**: L (3+ days once Phase 0 is decided)
- **Risk of change**: high (auth changes can lock users out; production-only Convex deployment)

## Why this matters

Cozea's cloud backend is a **production-only Convex deployment** (`https://knowing-finch-546.convex.cloud` — the URL ships inside every packaged app as `VITE_CONVEX_URL`). There is **no `ctx.auth` usage anywhere in `convex/`**: every public query/mutation accepts identity as a plain argument and believes it.

Verified excerpts:

`convex/projects.ts:315-318` — `create` takes the caller's word for who they are:

```ts
export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    ...
```

`convex/users.ts:22-...` — identity bootstrap is `ensureLocalDeviceProfile`, an **unauthenticated public mutation** that mints/patches a user from a client-supplied device id:

```ts
export const ensureLocalDeviceProfile = mutation({
  args: { deviceId: v.string(), deviceLabel: v.string(), ... },
  handler: async (ctx, args) => {
    const localUserWorkosId = `device:${normalizedDeviceId}`
    ...
    userId = await ctx.db.insert("users", { workosId: localUserWorkosId, ... })
```

`src/contexts/ConvexProvider.tsx:33` — the client is a bare `ConvexReactProvider` (no `ConvexProviderWithAuth`), and `src/contexts/AuthContext.tsx:38-51` bootstraps the session by calling `ensureLocalDeviceProfile` with `window.electronAPI.collab.ensureDeviceIdentity()` output.

Consequence: anyone who extracts `VITE_CONVEX_URL` from the DMG (trivial) can call any public function with any `userId`/`projectId` — read other users' projects, members, file changes, Yjs updates (these are E2E-encrypted, which limits content exposure, but metadata, tasks, comments, presence etc. are plaintext), or destructively mutate them. The schema has ~30 tables (`convex/schema.ts:4-942`), nearly all reachable this way.

**This gap is already known to the maintainer** (flagged 2026-06-12). The blocker is that the *intended identity model* is ambiguous: `AGENTS.md` documents "Auth: WorkOS (SSO, organizations)", but the live code implements an offline-first local **device profile** (`device:<deviceId>` pseudo-users), and `docs/saas-removal-collab-hosted-refactor-map.md` records a deliberate move away from hosted-SaaS coupling. Wiring classic WorkOS SSO may contradict current product direction. Hence Phase 0.

## Phase 0 — Decision (maintainer, not executor)

Pick the identity backbone. The plan's later phases are written to work for either choice:

- **Option A — Device-key auth (fits current offline-first direction).** Each install already has a device identity (`electronAPI.collab.ensureDeviceIdentity()` — keypair-backed; see `electron/services/CollabEncryptionService.ts`). Stand up a token mint: the existing Fastify gateway (`server/`, already depends on `jose`) verifies a device-key signature and issues a short-lived JWT (`sub = device:<deviceId>`). Convex validates it via a Custom JWT auth provider (`convex/auth.config.ts`). No third-party IdP required; collaboration invites bind device identities to projects.
- **Option B — WorkOS SSO as documented.** Convex consumes WorkOS-issued JWTs (Custom JWT provider config), `ctx.auth.getUserIdentity()` carries `workosId`, and the device profile becomes a cached offline shadow of a real account. Bigger lift (login UI, token refresh in `AuthContext`, offline behavior) but matches `AGENTS.md` and the dormant organizations model.

If neither is decidable now, a **stopgap Phase 1-only deployment still pays for itself** (see below) — it shrinks the blast radius without choosing an IdP.

## Phase 1 — Server-side authorization helpers + stop trusting `userId` (works under either option, and partially even before Phase 0)

1. Add `convex/lib/identity.ts` with a single helper, e.g. `requireUser(ctx): Promise<Doc<"users">>` that reads `ctx.auth.getUserIdentity()`, looks up the user by `workosId` (index `by_workos_id` exists — `convex/users.ts` uses it), and throws on absence. Every mutation/query then derives the acting user from this helper instead of a `userId` arg.
2. Migrate functions in dependency order, keeping the old `userId` arg temporarily as a **cross-check** (log + reject mismatches) before deleting it. The affected surface in `convex/projects.ts` alone (verified at plan time): mutations `create` (:315), `update` (~:674), `updateStatus` (~:833), `archive` (~:861), `restore` (~:881), `deleteProject` (~:901); queries `listForCurrentUser` (~:529), `listSummariesForCurrentUser` (~:543), `listPageForCurrentUser` (~:566), `getAccessibleById` (~:597), `getAccessibleBySlug` (~:612). Then sweep the remaining modules: `rg "userId: v\.id\(\"users\"\)" convex/` and `rg "ctx\.auth" convex/` (the second should go from 0 hits to everywhere).
3. Client side: `src/contexts/ConvexProvider.tsx` switches to the auth-aware provider (`ConvexProviderWithAuth` with a token fetcher fed by whichever Phase 0 option), and `AuthContext` stops passing `convexUserId` into mutations as identity (it remains fine as a display value).

## Phase 2 — Lock down the bootstrap and table reads

- `ensureLocalDeviceProfile` must require a verified identity (Option A: signed device assertion; Option B: WorkOS JWT) instead of raw strings.
- Audit every public query for object-capability leaks (project access must check `projectMembers` membership of the *authenticated* user — some queries already join members but key off the client-sent userId).
- Consider Convex function-level `internal.` migration for anything only the server gateway should call.

## Test plan

There are currently **zero tests for `convex/`** (verified: no `tests/**/convex*` files). Set up [`convex-test`](https://docs.convex.dev/testing) with vitest as part of Phase 1 — it runs functions against an in-memory backend and supports `withIdentity()`, which is exactly what this migration needs:

- `tests/convex/projects.auth.test.ts`: unauthenticated call to each migrated mutation → throws; authenticated call succeeds and writes the *authenticated* user's id; mismatched legacy `userId` arg → rejected.
- Add the suite to the default vitest include (it already globs `tests/**/*.test.ts` — `vitest.config.ts:22-28`), so CI picks it up automatically.
- Follow `tests/workspace/workspaceCatalog.test.ts` for tone/structure of contract-style tests in this repo.

## Verification gates

- `bunx vitest run tests/convex/` green.
- `bun run lint` green (`convex/` is in the lint paths — `package.json:27`).
- `bunx convex deploy` typechecks Convex functions at deploy time — but **NEVER run `convex dev`** (repo rule, `AGENTS.md`), and do not deploy without the maintainer's go-ahead: this is the production database. Staged rollout: deploy helpers + dual-accept (auth OR legacy arg with logging), watch logs, then enforce.

## Hard boundaries

- In scope: `convex/**` (except `_generated/`), `src/contexts/ConvexProvider.tsx`, `src/contexts/AuthContext.tsx`, token-mint endpoint in `server/src/` (Option A), new tests under `tests/convex/`.
- Out of scope: the Electron main process, the assistant runtime, Yjs encryption internals, any schema *data* migration beyond what auth requires. `convex/schema.ts` changes need explicit maintainer sign-off per `AGENTS.md` ("Ask First: Modifying database schema").
- Never commit secrets; JWT signing keys live in env/deployment config, referenced only by name.

## Escape hatches

- If Phase 0 is undecided, implement **only** the `requireUser` helper + dual-accept logging (no enforcement) and report observed call patterns.
- If `ctx.auth` cannot be made to work with the chosen provider inside a week of effort, STOP and write up the blockers — do not invent a homegrown session table without review.
- If any production data shows third-party access already occurred (unexpected users/devices), stop and escalate immediately.

## Maintenance note

Every future Convex function must start from `requireUser`/`requireProjectMember` helpers; reviewers should reject any new function with a `userId: v.id("users")` arg. Once enforced, rotate any tokens that were distributed during the dual-accept window.
