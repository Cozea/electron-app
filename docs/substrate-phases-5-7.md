# Substrate Phases 5–7 (spine continuation)

Companion to Phase 1 (`docs/substrate-shadow-server.md`) and the Wave 0 plan.

## Phase 5 — Shrink Electron main

**Flag:** `cozea.substrate.primary` → `COZEA_SUBSTRATE_PRIMARY=1` (default **off**; requires shadow server).

When primary + shadow are enabled, `ensureAssistantRuntimeStarted()` **skips** the in-process assistant runtime so the desktop shell is only a supervisor + Cozea bridges.

IPC allowlist helper: `electron/substrate/ipcAllowlist.ts` (`PHASE5_IPC_ALLOWLIST_PREFIXES`). Enforcement stays advisory until primary defaults on.

## Phase 6 — Observability & remote readiness

- Remote env catalog stubs: `electron/substrate/remoteEnvironments.ts` (local ready; SSH/WSL placeholders)
- Exposed on `substrateShadow:getStatus` as `remoteEnvironments`.
- Cozea-owned NDJSON/OTLP instrumentation and its status flag were removed on 2026-09-09. T3 observability is unchanged.

## Phase 7 — Monorepo reshape (aligned)

Canonical package names re-export the Phase 2 implementations (least-breaking):

| Canonical | Implementation |
| --- | --- |
| `@cozea/substrate-contracts` | re-exports `@cozea/contracts` |
| `@cozea/substrate-client-runtime` | re-exports `@cozea/client-runtime` |

Existing app imports of `@cozea/contracts` / `@cozea/client-runtime` remain valid.
New code should prefer the `substrate-*` names.

Target end-state layout:

```text
apps/desktop   ← electron shell
apps/server    ← substrate / T3-derived server
packages/substrate-contracts
packages/substrate-client-runtime
convex/        ← stays Cozea-specific
```

Bun vs pnpm/`vp` decision remains deferred (high blast radius).

## Flag matrix

| Flag | Env | Phase |
| --- | --- | --- |
| `cozea.substrate.shadowServer` | `COZEA_SUBSTRATE_SHADOW_SERVER` | 1 |
| `cozea.substrate.rpcChat` | `COZEA_SUBSTRATE_RPC_CHAT` | 2 |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS` | 3 |
| `cozea.substrate.vcs` | `COZEA_SUBSTRATE_VCS` | 4 |
| `cozea.substrate.primary` | `COZEA_SUBSTRATE_PRIMARY` | 5 |

All default **off**. Full-stack enable recipe: `docs/substrate-phases-complete.md`.
