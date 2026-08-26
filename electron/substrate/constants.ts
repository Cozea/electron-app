/** Shared substrate flag ids (Phases 1–6). All default OFF until exit criteria pass. */

export const SUBSTRATE_SHADOW_SERVER_FLAG = "cozea.substrate.shadowServer" as const;
export const SUBSTRATE_RPC_CHAT_FLAG = "cozea.substrate.rpcChat" as const;
export const SUBSTRATE_PROVIDERS_FLAG = "cozea.substrate.providers" as const;
export const SUBSTRATE_VCS_FLAG = "cozea.substrate.vcs" as const;
export const SUBSTRATE_PRIMARY_FLAG = "cozea.substrate.primary" as const;
export const SUBSTRATE_OBS_NDJSON_FLAG = "cozea.obs.ndjson" as const;

export type SubstrateFlagId =
  | typeof SUBSTRATE_SHADOW_SERVER_FLAG
  | typeof SUBSTRATE_RPC_CHAT_FLAG
  | typeof SUBSTRATE_PROVIDERS_FLAG
  | typeof SUBSTRATE_VCS_FLAG
  | typeof SUBSTRATE_PRIMARY_FLAG
  | typeof SUBSTRATE_OBS_NDJSON_FLAG;

/** Phase 1 shadow substrate — dedicated port (not assistant runtime :3773). */
export const DEFAULT_SUBSTRATE_SHADOW_HOST = "127.0.0.1";
export const DEFAULT_SUBSTRATE_SHADOW_PORT = 4783;

/** Canonical readiness path (T3 uses `/.well-known/t3/environment`). */
export const SUBSTRATE_SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";

/** Upstream pin recorded by Track Inv (Phase 0). */
export const SUBSTRATE_T3_PIN_SHA = "a3a8cbd60539b4af4de8f96c892dbd07a2b6c041";

/** IPC channels that remain after Phase 5 shrink (allowlist). */
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
  "settings:",
  "storage:",
] as const;
