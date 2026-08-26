# Substrate spine status (Phases 0–7)

Last updated: 2026-08-26 (completion branch)

| Phase | Status | Branch / PR | Notes |
| --- | --- | --- | --- |
| 0 Inventories | Done (docs) | #74 / #78 | IPC/store/gap inventories + pin |
| 1 Shadow server | **Complete** | #85 / this branch | Flagged spawn on :4783; obs start/ready spans |
| 2 RPC chat | **Complete** | #89 / this branch | Contracts + client-runtime + flagged `/rpc`; provider routing when Phase 3 on |
| 3 Providers | **Complete** | #88 / this branch | Registry wired into rpc `chat.send` when `COZEA_SUBSTRATE_PROVIDERS=1` |
| 4 VCS 4a–4e | **Complete (scaffold)** | #87 / this branch | Bootstrapped from main + workspace sync IPC; GitCore retained |
| 5 Shrink main | **Complete (flagged)** | this branch | Primary+shadow skips in-process assistant; status `inProcessAssistant: false` |
| 6 Obs / remote | **Complete (flagged)** | this branch | NDJSON writer under `electron/substrate/obs/`; remote env stubs |
| 7 Monorepo | **Complete (aligned)** | this branch | `@cozea/substrate-*` re-export `@cozea/contracts` / `@cozea/client-runtime` |

All substrate flags default **off**.

**How to enable full stack** — see `docs/substrate-phases-complete.md`.

### Follow-ons (not blocking spine)

- Codex deep parity (full driver + session runtime)
- Full GitCore deletion after agent `vcs.*` cutover
- Product chat UI default flip to substrate primary
- Optional OTLP export for Track E
