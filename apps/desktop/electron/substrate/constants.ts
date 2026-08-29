/** Substrate flags + readiness constants (Phases 1–6). */

export const DEFAULT_SUBSTRATE_SHADOW_HOST = "127.0.0.1";
export const DEFAULT_SUBSTRATE_SHADOW_PORT = 4783;
/** Shadow child must bootstrap T3 before listening; allow time for provider health checks. */
export const DEFAULT_SUBSTRATE_SHADOW_READINESS_TIMEOUT_MS = 90_000;
export const SUBSTRATE_SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";
/** Phase T2 — renderer obtains T3 WS ticket via shadow child (never exposes pairing token). */
export const SUBSTRATE_T3_RPC_SESSION_PATH = "/.well-known/cozea/substrate/t3-rpc-session";
export const SUBSTRATE_SHADOW_SERVER_FLAG = "cozea.substrate.shadowServer" as const;

/** Phase 2 — Effect RPC / contracts chat path (default on). */
export const SUBSTRATE_RPC_CHAT_FLAG = "cozea.substrate.rpcChat" as const;

/** Phase 3 — T3-shaped provider driver registry path (default on). */
export const SUBSTRATE_PROVIDERS_FLAG = "cozea.substrate.providers" as const;

/** Phase 4 — VcsDriver path (default on). */
export const SUBSTRATE_VCS_FLAG = "cozea.substrate.vcs" as const;

/** Phase 5 — primary out-of-process substrate (default on). */
export const SUBSTRATE_PRIMARY_FLAG = "cozea.substrate.primary" as const;

/** Phase 6 / Track E — NDJSON spans (default on). */
export const SUBSTRATE_OBS_NDJSON_FLAG = "cozea.obs.ndjson" as const;

/** Default OTLP HTTP logs endpoint when observability is enabled. */
export const DEFAULT_OTLP_LOGS_ENDPOINT = "http://127.0.0.1:4318/v1/logs" as const;

/** Phase T1 — upstream T3 apps/server dual-run (default off). */
export const SUBSTRATE_T3_SERVER_FLAG = "cozea.t3.server" as const;

/** Default port for vendored T3 server child (separate from shadow :4783). */
export const DEFAULT_T3_SERVER_PORT = 13_773;

/** Upstream pin recorded by Track Inv (Phase 0). */
export const SUBSTRATE_T3_PIN_SHA = "d830df40b5aa7c72a75c9a43632bb5383530638f";

export const DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN = "http://127.0.0.1:3773";
export const ASSISTANT_RUNTIME_READINESS_PATH = "/__cozea/ready";

export type SubstrateFlagId =
  | typeof SUBSTRATE_SHADOW_SERVER_FLAG
  | typeof SUBSTRATE_RPC_CHAT_FLAG
  | typeof SUBSTRATE_PROVIDERS_FLAG
  | typeof SUBSTRATE_VCS_FLAG
  | typeof SUBSTRATE_PRIMARY_FLAG
  | typeof SUBSTRATE_OBS_NDJSON_FLAG
  | typeof SUBSTRATE_T3_SERVER_FLAG;

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
