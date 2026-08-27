import { readSubstrateRpcChatFlags } from "@cozea/client-runtime";

/**
 * Renderer-side flag reader.
 * Prefer Vite-injected env; fall back to process.env in Node test contexts.
 */
export function isSubstrateRpcChatEnabled(): boolean {
  const viteFlag =
    typeof import.meta !== "undefined"
      ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_COZEA_SUBSTRATE_RPC_CHAT
      : undefined;
  const raw =
    viteFlag ??
    (typeof process !== "undefined" ? process.env.COZEA_SUBSTRATE_RPC_CHAT : undefined) ??
    (typeof process !== "undefined" ? process.env.VITE_COZEA_SUBSTRATE_RPC_CHAT : undefined);
  return readSubstrateRpcChatFlags({ COZEA_SUBSTRATE_RPC_CHAT: raw }).enabled;
}
