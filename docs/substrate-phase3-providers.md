# Substrate providers (Phase 3)

Phase 3 of the T3 substrate rebase: introduce a **flagged** T3-shaped
`ProviderDriver` registry and managed snapshot lifecycle
(`pending → probing → enriching_capabilities → enriching_skills →
enriching_slash → enriching_account_models → ready`).

The default in-process assistant-runtime provider path is **unchanged**.

## Flag

| Flag | Env | Default |
| --- | --- | --- |
| `cozea.substrate.providers` | `COZEA_SUBSTRATE_PROVIDERS=1` | **off** |

When the flag is off, `bootstrapSubstrateProviderRegistry()` returns a disabled
empty registry (status queries are safe; `register` / `materialize` throw).

## Layout

```
electron/substrate/providers/
  types.ts                 # ProviderDriver / Instance / Snapshot SPI
  managedSnapshot.ts       # state machine + enrichment pipeline
  registry.ts              # in-memory driver registry
  bootstrap.ts             # flag-gated registration
  index.ts
  drivers/
    opencodeDriver.ts      # FULL substrate driver (first cutover)
    legacyAdapters.ts      # Claude / Codex / Cursor thin adapters
docs/substrate-phase3-providers.md
tests/electron/substrateProviders.test.ts
```

Upstream pin: `docs/substrate-t3-pin.md` (`a3a8cbd6…`).

## What ships in this slice

1. **ProviderDriver registry** — plain-value SPI (not Effect Context tags),
   matching T3’s `ProviderDriver` / `ProviderInstance` shape at the substrate
   boundary.
2. **Managed snapshot lifecycle** — explicit phase transitions with generation
   bumps on refresh so stale enrichment cannot clobber newer runs.
3. **OpenCode full driver** — first provider on the substrate interface; runs
   probe → capabilities → skills → slash → account models.
4. **Legacy adapters** — Cursor / Claude / Codex register through the same
   registry but keep `implementation: "legacy-adapter"` and still rely on the
   existing assistant-runtime path for real sessions.
5. **Default path untouched** — product chat continues to use the in-process
   runtime until a later cutover phase.

## Usage (flagged)

```ts
import { bootstrapSubstrateProviderRegistry } from "../apps/desktop/electron/substrate/providers";

const registry = bootstrapSubstrateProviderRegistry({
  env: process.env, // requires COZEA_SUBSTRATE_PROVIDERS=1
});

const instance = await registry.materialize({ driverKind: "opencode" });
const snapshot = await instance.snapshot.run();
// snapshot.phase === "ready" after enrichment
```

When both `COZEA_SUBSTRATE_RPC_CHAT=1` and `COZEA_SUBSTRATE_PROVIDERS=1` are set,
the shadow `/rpc` `chat.send` path materializes through this registry (default
driver `opencode`) and returns `mode: "provider"`. Echo/bridge remains the
fallback when the flag is off or materialize fails.

## Codex deep-parity gaps

Codex remains a **legacy adapter** on this flagged path. Closing parity with
upstream T3 is the deepest Phase 3 follow-on. Current gaps:

| Area | T3 (`CodexDriver` / session runtime) | Cozea today | Gap |
| --- | --- | --- | --- |
| Driver SPI | Full `ProviderDriver` with typed config + instance scope | Thin `legacy-adapter` registration only | Need a full substrate Codex driver |
| Session runtime | Large dedicated Codex app-server / session runtime | Historical Cozea Codex adapter (thinner) | Port or wrap T3 session runtime behind the driver |
| Home / layout | Instance-scoped Codex home layout | Shared / less instance-aware home paths | Instance-scoped home + shadow home |
| Snapshots | Managed pending → enrich (models, skills, slash, account) | Adapter skips deep enrichment | Wire Codex probes into managed snapshot enrichers |
| App-server | First-class app-server lifecycle | Partial / older integration | Align process supervision with T3 |
| Text generation | Driver-owned closure per instance | Routed via existing runtime | Bind to substrate instance closures |
| Multi-instance | First-class same-driver instances | Legacy single default instance | Registry supports it; Codex adapter does not specialize |
| Continuity | Continuation identity per instance | Not on substrate path yet | Carry continuation keys through substrate instances |

**Non-goals for this slice:** full Codex rewrite, Grok, UI chrome rewrite.

## Exit criteria (Phase 3 slice)

- [x] Flag `cozea.substrate.providers` / `COZEA_SUBSTRATE_PROVIDERS` default **off**
- [x] T3-shaped ProviderDriver registry + managed snapshot state machine
- [x] ≥1 full driver (OpenCode) resolves through the flagged registry
- [x] Claude / Codex / Cursor register as legacy adapters
- [x] Tests for registry + snapshot state machine
- [x] Docs for Codex deep-parity gaps
- [x] Flagged RPC chat routes through registry when providers on
- [ ] Default product provider path flipped (later phase)
- [ ] Codex full substrate driver + session-runtime parity (follow-on)

## Related

- Phase 1 shadow server: `docs/substrate-shadow-server.md`
- T3 pin: `docs/substrate-t3-pin.md`
- Older instance-port checklist: `docs/t3-provider-instance-port-todo.md`
