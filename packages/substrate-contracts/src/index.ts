/**
 * Phase 2 / 7 — minimal substrate contracts surface.
 * Full Effect RPC schemas land as T3 packages/contracts are vendored.
 */

export interface SubstrateHealthRequest {
  readonly ping?: string;
}

export interface SubstrateHealthResponse {
  readonly ok: true;
  readonly role: "shadow" | "primary";
  readonly phase: number;
  readonly pin: string;
}

export interface SubstrateChatSendRequest {
  readonly threadId: string;
  readonly text: string;
  readonly providerId?: string;
}

export interface SubstrateChatSendResponse {
  readonly accepted: boolean;
  readonly turnId: string;
}

export interface SubstrateChatEvent {
  readonly type: "message.delta" | "message.completed" | "error" | "snapshot";
  readonly turnId: string;
  readonly payload: unknown;
}

/** Method names for the Phase 2 flagged RPC path. */
export const SUBSTRATE_RPC_METHODS = {
  health: "substrate.health",
  chatSend: "substrate.chat.send",
  chatSubscribe: "substrate.chat.subscribe",
  vcsStatusSubscribe: "substrate.vcs.status.subscribe",
  providerList: "substrate.provider.list",
} as const;

export type SubstrateRpcMethod =
  (typeof SUBSTRATE_RPC_METHODS)[keyof typeof SUBSTRATE_RPC_METHODS];
