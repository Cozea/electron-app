/** Substrate flags + readiness constants (Phase 1 + Phase 2). */

export const DEFAULT_SUBSTRATE_SHADOW_HOST = "127.0.0.1";
export const DEFAULT_SUBSTRATE_SHADOW_PORT = 4783;
export const SUBSTRATE_SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";
export const SUBSTRATE_SHADOW_SERVER_FLAG = "cozea.substrate.shadowServer" as const;
export const SUBSTRATE_T3_PIN_SHA = "a3a8cbd60539b4af4de8f96c892dbd07a2b6c041";
export const SUBSTRATE_RPC_CHAT_FLAG = "cozea.substrate.rpcChat" as const;
export const DEFAULT_ASSISTANT_RUNTIME_HTTP_ORIGIN = "http://127.0.0.1:3773";
export const ASSISTANT_RUNTIME_READINESS_PATH = "/__cozea/ready";
