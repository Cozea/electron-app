/** Phase 1 shadow substrate — dedicated port (not assistant runtime :3773). */
export const DEFAULT_SUBSTRATE_SHADOW_HOST = "127.0.0.1";
export const DEFAULT_SUBSTRATE_SHADOW_PORT = 4783;

/** Canonical readiness path (T3 uses `/.well-known/t3/environment`). */
export const SUBSTRATE_SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";

/** Feature flag id from the implementation plan. */
export const SUBSTRATE_SHADOW_SERVER_FLAG = "cozea.substrate.shadowServer" as const;

/** Phase 3 — T3-shaped provider driver registry path (default off). */
export const SUBSTRATE_PROVIDERS_FLAG = "cozea.substrate.providers" as const;

/** Upstream pin recorded by Track Inv (Phase 0). */
export const SUBSTRATE_T3_PIN_SHA = "a3a8cbd60539b4af4de8f96c892dbd07a2b6c041";
