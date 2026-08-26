export const SUBSTRATE_RPC_CHAT_FLAG = "cozea.substrate.rpcChat" as const;

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export interface SubstrateRpcChatFlags {
  readonly flagId: typeof SUBSTRATE_RPC_CHAT_FLAG;
  /** When true (and shadow server is up), chat may use the substrate RPC client. */
  readonly enabled: boolean;
}

/**
 * Phase 2 flag — default **off**.
 * Enable with `COZEA_SUBSTRATE_RPC_CHAT=1`.
 */
export function readSubstrateRpcChatFlags(
  env: Record<string, string | undefined> =
    typeof process !== "undefined" ? process.env : {},
): SubstrateRpcChatFlags {
  return {
    flagId: SUBSTRATE_RPC_CHAT_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_RPC_CHAT, false),
  };
}
