import { useEffect, useRef, useState } from "react";

import { T3ServerConfigClient } from "@cozea/client-runtime";
import type { ServerConfig } from "@cozea/assistant-contracts";

import {
  connectT3ServerConfigBridge,
  disconnectT3ServerConfigBridge,
} from "@/features/projects/components/workbench/assistant/assistantRuntimeMetadataStore";
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

export interface T3ServerConfigCutoverState {
  readonly active: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly refreshProviders: (() => Promise<void>) | null;
}

/**
 * Phase T4 — when shadow reports `t3Server: true`, load provider/model config from
 * native T3 Effect RPC instead of legacy WS :3773.
 */
export function useT3ServerConfigCutover(input: {
  readonly substrateActive: boolean;
  readonly shadowBaseUrl: string | null;
}): T3ServerConfigCutoverState {
  const ownerRef = useRef(Symbol("t3-server-config-cutover-owner"));
  const owner = ownerRef.current;
  const [state, setState] = useState<T3ServerConfigCutoverState>({
    active: false,
    loading: false,
    error: null,
    refreshProviders: null,
  });

  useEffect(() => {
    if (!input.substrateActive || !input.shadowBaseUrl) {
      disconnectT3ServerConfigBridge(owner);
      setState({ active: false, loading: false, error: null, refreshProviders: null });
      return;
    }

    let cancelled = false;
    let client: T3ServerConfigClient | null = null;
    let unsubscribeConfig: (() => void) | null = null;

    setState((current) => ({ ...current, loading: true, error: null }));

    void (async () => {
      try {
        const t3Enabled = await readShadowReadyT3Enabled(input.shadowBaseUrl!);
        if (cancelled || !t3Enabled) {
          if (!cancelled) {
            disconnectT3ServerConfigBridge(owner);
            setState({ active: false, loading: false, error: null, refreshProviders: null });
          }
          return;
        }

        const session = await fetchT3RpcSession(input.shadowBaseUrl!);
        if (cancelled) return;

        client = new T3ServerConfigClient({
          baseUrl: session.baseUrl,
          wsTicket: session.wsTicket,
        });

        connectT3ServerConfigBridge(owner, {
          getConfig: () => client!.getConfig(),
          subscribe: (listener: (config: ServerConfig) => void) => {
            let active = true;
            void client!.subscribeServerConfig((config) => {
              if (active) {
                listener(config);
              }
            }).then((unsub) => {
              if (!active) {
                unsub();
                return;
              }
              unsubscribeConfig = unsub;
            });
            return () => {
              active = false;
              unsubscribeConfig?.();
              unsubscribeConfig = null;
            };
          },
          refreshProviders: () => client!.refreshProviders(),
          updateProvider: (provider, instanceId) => client!.updateProvider(provider, instanceId),
        });

        if (cancelled) {
          disconnectT3ServerConfigBridge(owner);
          await client.close();
          return;
        }

        setState({
          active: true,
          loading: false,
          error: null,
          refreshProviders: () => client!.refreshProviders(),
        });
      } catch (error) {
        disconnectT3ServerConfigBridge(owner);
        if (!cancelled) {
          setState({
            active: false,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            refreshProviders: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribeConfig?.();
      unsubscribeConfig = null;
      disconnectT3ServerConfigBridge(owner);
      void client?.close();
    };
  }, [input.substrateActive, input.shadowBaseUrl, owner]);

  return state;
}
