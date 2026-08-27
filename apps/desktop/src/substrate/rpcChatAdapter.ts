import {
  SubstrateChatClient,
  type ConnectionPhase,
} from "@cozea/client-runtime";
import type { ChatEvent, ChatSendResult, HealthResult } from "@cozea/contracts";

import { isSubstrateRpcChatEnabled } from "./rpcChatFlags";

export interface SubstrateRpcChatAdapterOptions {
  readonly shadowBaseUrl?: string;
  readonly WebSocketImpl?: typeof WebSocket;
}

export interface SubstrateRpcChatSmokeResult {
  readonly health: HealthResult;
  readonly send: ChatSendResult;
  readonly events: ChatEvent[];
  readonly phase: ConnectionPhase;
  readonly url: string;
}

function resolveShadowBaseUrl(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim().replace(/\/$/, "");
  }
  const fromEnv =
    (typeof import.meta !== "undefined"
      ? (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
          ?.VITE_COZEA_SUBSTRATE_SHADOW_URL
      : undefined) ??
    (typeof process !== "undefined" ? process.env.VITE_COZEA_SUBSTRATE_SHADOW_URL : undefined) ??
    (typeof process !== "undefined" ? process.env.COZEA_SUBSTRATE_SHADOW_URL : undefined);
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, "");
  }
  const host =
    (typeof process !== "undefined" ? process.env.COZEA_SUBSTRATE_SHADOW_HOST : undefined)?.trim() ||
    "127.0.0.1";
  const port =
    (typeof process !== "undefined" ? process.env.COZEA_SUBSTRATE_SHADOW_PORT : undefined)?.trim() ||
    "4783";
  return `http://${host}:${port}`;
}

/**
 * Minimal workbench adapter: when `cozea.substrate.rpcChat` is on, construct a
 * SubstrateChatClient pointed at the shadow server. Default product chat path
 * remains the in-process assistant runtime unless callers opt into this client.
 */
export function createSubstrateRpcChatAdapter(
  options: SubstrateRpcChatAdapterOptions = {},
): SubstrateChatClient | null {
  if (!isSubstrateRpcChatEnabled()) {
    return null;
  }
  return new SubstrateChatClient({
    baseUrl: resolveShadowBaseUrl(options.shadowBaseUrl),
    WebSocketImpl: options.WebSocketImpl,
  });
}

export async function runSubstrateRpcChatSmoke(
  options: SubstrateRpcChatAdapterOptions & { readonly text?: string } = {},
): Promise<SubstrateRpcChatSmokeResult | null> {
  const client = createSubstrateRpcChatAdapter(options);
  if (!client) {
    return null;
  }
  try {
    const result = await client.smokeRoundtrip(options.text ?? "phase2-smoke");
    return {
      ...result,
      phase: client.getPhase(),
      url: client.getUrl(),
    };
  } finally {
    await client.close();
  }
}
