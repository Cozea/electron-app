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

/** Phase T1 — upstream T3 apps/server dual-run (default off). */
export const SUBSTRATE_T3_SERVER_FLAG = "cozea.t3.server" as const;

/** Default port for vendored T3 server child (separate from shadow :4783). */
export const DEFAULT_T3_SERVER_PORT = 13_773;

/** Reviewed Cozea T3 fork pin including active-turn Computer Use terminal forwarding. */
export const SUBSTRATE_T3_PIN_SHA: string = "50977ab641d9b43547275421530dba0383de7941";

export const DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN = "http://127.0.0.1:3773";
export const ASSISTANT_RUNTIME_READINESS_PATH = "/__cozea/ready";

export type SubstrateFlagId =
  | typeof SUBSTRATE_SHADOW_SERVER_FLAG
  | typeof SUBSTRATE_RPC_CHAT_FLAG
  | typeof SUBSTRATE_PROVIDERS_FLAG
  | typeof SUBSTRATE_VCS_FLAG
  | typeof SUBSTRATE_PRIMARY_FLAG
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
  "computerUse:",
] as const;
