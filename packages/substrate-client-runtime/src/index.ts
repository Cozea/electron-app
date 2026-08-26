/**
 * `@cozea/substrate-client-runtime` — canonical Phase 7 public name for the
 * substrate chat client / connection supervisor.
 *
 * Implementation lives in `@cozea/client-runtime`. This package re-exports that
 * surface so the monorepo can converge on `substrate-*` names without breaking
 * existing `@cozea/client-runtime` consumers.
 */

export * from "@cozea/client-runtime";
