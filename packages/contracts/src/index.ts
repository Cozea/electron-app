/** Substrate shadow JSON-RPC contracts (Cozea Phase 2). */
export * from "./base";
export * from "./chat";
export * from "./health";
export * from "./orchestration";
export * from "./protocol";
export * from "./rpc";

/** Cozea-only desktop IPC extensions (not served by T3). */
export * from "./collab";
export * from "./catalog";
export * from "./devapps";

/** Upstream T3 RPC method tags (runtime-safe — no heavy Schema graph). */
export { ORCHESTRATION_WS_METHODS, WS_METHODS } from "./t3/methodTags";
