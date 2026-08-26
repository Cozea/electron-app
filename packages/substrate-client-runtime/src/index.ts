/**
 * Phase 2 / 7 — client runtime supervisor stub for the flagged RPC path.
 * Connection retries / atom factories deepen as T3 client-runtime is vendored.
 */

import {
  SUBSTRATE_RPC_METHODS,
  type SubstrateChatSendRequest,
  type SubstrateChatSendResponse,
  type SubstrateHealthResponse,
} from "@cozea/substrate-contracts";

export type SubstrateConnectionPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "degraded"
  | "closed";

export interface SubstrateClientRuntimeOptions {
  readonly baseUrl: string;
  readonly readyPath?: string;
  readonly fetchImpl?: typeof fetch;
}

export interface SubstrateClientRuntime {
  readonly getPhase: () => SubstrateConnectionPhase;
  readonly connect: () => Promise<SubstrateHealthResponse>;
  readonly health: () => Promise<SubstrateHealthResponse>;
  readonly chatSend: (
    request: SubstrateChatSendRequest,
  ) => Promise<SubstrateChatSendResponse>;
  readonly close: () => void;
}

export function createSubstrateClientRuntime(
  options: SubstrateClientRuntimeOptions,
): SubstrateClientRuntime {
  let phase: SubstrateConnectionPhase = "idle";
  const fetchImpl = options.fetchImpl ?? fetch;
  const readyPath = options.readyPath ?? "/.well-known/cozea/substrate/ready";

  async function health(): Promise<SubstrateHealthResponse> {
    const response = await fetchImpl(new URL(readyPath, options.baseUrl));
    if (!response.ok) {
      phase = "degraded";
      throw new Error(`substrate health failed: HTTP ${response.status}`);
    }
    const body = (await response.json()) as SubstrateHealthResponse;
    phase = "ready";
    return body;
  }

  return {
    getPhase: () => phase,
    async connect() {
      phase = "connecting";
      return await health();
    },
    health,
    async chatSend(request) {
      // Phase 2 bridge placeholder — real Effect RPC stream lands with contracts package.
      if (phase !== "ready") {
        await health();
      }
      return {
        accepted: true,
        turnId: `stub-${request.threadId}-${Date.now()}`,
      };
    },
    close() {
      phase = "closed";
    },
  };
}

export { SUBSTRATE_RPC_METHODS };
