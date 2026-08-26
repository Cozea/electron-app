/** Substrate flags + readiness constants (Phases 1–6). */

export const DEFAULT_SUBSTRATE_SHADOW_HOST = "127.0.0.1";
export const DEFAULT_SUBSTRATE_SHADOW_PORT = 4783;
export const SUBSTRATE_SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";
export const SUBSTRATE_SHADOW_SERVER_FLAG = "cozea.substrate.shadowServer" as const;

/** Phase 2 — Effect RPC / contracts chat path (default off). */
export const SUBSTRATE_RPC_CHAT_FLAG = "cozea.substrate.rpcChat" as const;

/** Phase 3 — T3-shaped provider driver registry path (default off). */
export const SUBSTRATE_PROVIDERS_FLAG = "cozea.substrate.providers" as const;

/** Phase 4 — VcsDriver path (default off). */
export const SUBSTRATE_VCS_FLAG = "cozea.substrate.vcs" as const;

/** Phase 5 — primary out-of-process substrate (default off). */
export const SUBSTRATE_PRIMARY_FLAG = "cozea.substrate.primary" as const;

/** Phase 6 / Track E — NDJSON spans (default off). */
export const SUBSTRATE_OBS_NDJSON_FLAG = "cozea.obs.ndjson" as const;

/** Upstream pin recorded by Track Inv (Phase 0). */
export const SUBSTRATE_T3_PIN_SHA = "a3a8cbd60539b4af4de8f96c892dbd07a2b6c041";

export const DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN = "http://127.0.0.1:3773";
export const ASSISTANT_RUNTIME_READINESS_PATH = "/__cozea/ready";

export type SubstrateFlagId =
  | typeof SUBSTRATE_SHADOW_SERVER_FLAG
  | typeof SUBSTRATE_RPC_CHAT_FLAG
  | typeof SUBSTRATE_PROVIDERS_FLAG
  | typeof SUBSTRATE_VCS_FLAG
  | typeof SUBSTRATE_PRIMARY_FLAG
  | typeof SUBSTRATE_OBS_NDJSON_FLAG;

/** IPC channel prefixes that remain after Phase 5 shrink (allowlist). */
export const PHASE5_IPC_ALLOWLIST_PREFIXES = [
  "window:",
  "app:",
  "menu:",
  "updater:",
  "shell:",
  "dialog:",
  "nativeTheme:",
  "workspaceCatalog:",
  "workspace:",
  "yjs:",
  "devApps:",
  "nativePreview:",
  "preview:",
  "collab:",
  "syncJournal:",
  "conflict:",
  "substrateShadow:",
  "substrate:",
  "substrate:vcs:",
  "settings:",
  "storage:",
] as const;
