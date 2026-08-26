# Substrate Phases 5–7 (spine continuation)

Companion to Phase 1 (`docs/substrate-shadow-server.md`) and the Wave 0 plan.

## Phase 5 — Shrink Electron main

**Flag:** `cozea.substrate.primary` → `COZEA_SUBSTRATE_PRIMARY=1` (default **off**; requires shadow server).

When primary + shadow are enabled, `ensureAssistantRuntimeStarted()` **skips** the in-process assistant runtime so the desktop shell is only a supervisor + Cozea bridges.

IPC allowlist helper: `electron/substrate/ipcAllowlist.ts` (`PHASE5_IPC_ALLOWLIST_PREFIXES`). Enforcement stays advisory until primary defaults on.

## Phase 6 — Observability & remote readiness

- NDJSON flag: `cozea.obs.ndjson` (`COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON`) — Track E PR continues the writer.
- Remote env catalog stubs: `electron/substrate/remoteEnvironments.ts` (local ready; SSH/WSL placeholders).
- Exposed on `substrateShadow:getStatus` as `remoteEnvironments` + `features`.

## Phase 7 — Monorepo reshape (scaffolding)

New workspace packages (types-first stubs):

| Package | Role |
| --- | --- |
| `@cozea/substrate-contracts` | RPC method names + request/response types |
| `@cozea/substrate-client-runtime` | Connection supervisor stub for flagged chat |

Target end-state (not fully moved yet):

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
| `cozea.obs.ndjson` | `COZEA_OBS_NDJSON` | 6 |

All default **off**.
