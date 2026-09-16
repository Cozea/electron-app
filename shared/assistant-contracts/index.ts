/**
 * Cozea's own assistant contracts. Hand-maintained, deliberately.
 *
 * These are *not* the vendored t3code contracts in `packages/contracts/src/t3`,
 * which carry a `@generated from vendor/t3code` banner and are rewritten by
 * `scripts/vendor/sync-t3-contracts.mjs`. Nothing syncs this directory, and it
 * should not be pointed at that script: upstream's schemas are supersets, so
 * generating this set from them would silently widen what Cozea accepts.
 *
 * The two universes share 335 export names across 14 files, and both publish a
 * barrel. Where they disagree, they disagree substantively --
 * `GitStackedAction` is three values here and five upstream. When importing a
 * name that exists on both sides, pick the universe on purpose.
 *
 * `tests/architecture/contractUniverseDrift.test.ts` freezes that overlap so it
 * cannot quietly widen. `docs/git-subsystem-fragmentation.md` §7 records why
 * merging them was deferred rather than done.
 */

export * from "./baseSchemas";
export * from "./ipc";
export * from "./terminal";
export * from "./providerInstance";
export * from "./provider";
export * from "./providerRuntime";
export * from "./model";
export * from "./ws";
export * from "./keybindings";
export * from "./server";
export * from "./settings";
export * from "./git";
export * from "./orchestration";
export * from "./editor";
export * from "./project";
