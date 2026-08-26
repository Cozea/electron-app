/**
 * `@cozea/substrate-contracts` — canonical Phase 7 public name for substrate
 * RPC contracts.
 *
 * Implementation lives in `@cozea/contracts` (Effect Schema + RpcGroup). This
 * package re-exports that surface so apps can migrate to the `substrate-*`
 * naming without a dual API. Prefer importing from here in new code; existing
 * `@cozea/contracts` imports remain valid.
 */

export * from "@cozea/contracts";
