import { useEffect, useState } from "react";

import type { NativeApi } from "@cozea/assistant-contracts";

import { createT3OrchestrationApi, type T3OrchestrationApiHandle } from "./createT3OrchestrationApi";
import { fetchT3RpcSession } from "./fetchT3RpcSession";

const SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";

async function readShadowReadyT3Enabled(shadowBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL(SHADOW_READY_PATH, shadowBaseUrl));
    if (!response.ok) return false;
    const json = (await response.json()) as { t3Server?: boolean };
    return json.t3Server === true;
  } catch {
    return false;
  }
}

export interface T3OrchestrationCutoverState {
  /** T3 server is active and orchestration commands should bypass :3773 WS. */
  readonly active: boolean;
  readonly loading: boolean;
  readonly orchestration: NativeApi["orchestration"] | null;
  readonly error: string | null;
}

/**
 * Phase T3 — when shadow reports `t3Server: true`, expose orchestration commands
 * via native T3 Effect RPC (send, approve, diff) instead of legacy WS :3773.
 */
export function useT3OrchestrationCutover(input: {
  readonly substrateActive: boolean;
  readonly shadowBaseUrl: string | null;
}): T3OrchestrationCutoverState {
  const [state, setState] = useState<T3OrchestrationCutoverState>({
    active: false,
    loading: false,
    orchestration: null,
    error: null,
  });

  useEffect(() => {
    if (!input.substrateActive || !input.shadowBaseUrl) {
      setState({ active: false, loading: false, orchestration: null, error: null });
      return;
    }

    let cancelled = false;
    let handle: T3OrchestrationApiHandle | null = null;

    setState((current) => ({ ...current, loading: true, error: null }));

    void (async () => {
      try {
        const t3Enabled = await readShadowReadyT3Enabled(input.shadowBaseUrl!);
        if (cancelled || !t3Enabled) {
          if (!cancelled) {
            setState({ active: false, loading: false, orchestration: null, error: null });
          }
          return;
        }

        const session = await fetchT3RpcSession(input.shadowBaseUrl!);
        if (cancelled) return;

        handle = createT3OrchestrationApi({
          baseUrl: session.baseUrl,
          wsTicket: session.wsTicket,
        });

        if (cancelled) {
          await handle.close();
          return;
        }

        setState({
          active: true,
          loading: false,
          orchestration: handle.orchestration,
          error: null,
        });
      } catch (error) {
        if (!cancelled) {
          setState({
            active: false,
            loading: false,
            orchestration: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      void handle?.close();
    };
  }, [input.substrateActive, input.shadowBaseUrl]);

  return state;
}
