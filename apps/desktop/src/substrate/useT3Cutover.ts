import { useEffect, useRef, useState } from "react";

import { createT3RpcSession } from "@cozea/client-runtime";
import type { NativeApi } from "@cozea/assistant-contracts";

import {
  connectT3ServerConfigBridge,
  disconnectT3ServerConfigBridge,
} from "@/features/assistant/model/assistantRuntimeMetadataStore";
import { registerT3NativeApiOverlay } from "@/lib/nativeApi";

import { createT3NativeApi } from "./createT3NativeApi";
import { createT3OrchestrationApiFromClient } from "./createT3OrchestrationApi";
import { fetchT3RpcSession } from "./fetchT3RpcSession";
import { setT3CutoverActive } from "./t3CutoverStore";
import {
  registerT3PreviewAutomationHost,
  T3_PREVIEW_AUTOMATION_HOST_REVISION,
} from "./t3PreviewAutomationHost";

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

export interface T3CutoverState {
  readonly active: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly nativeApi: NativeApi | null;
  readonly orchestration: NativeApi["orchestration"] | null;
  readonly refreshProviders: (() => Promise<void>) | null;
}

/**
 * Phase T5 — unified T3 cutover: one RPC session powers orchestration, config,
 * VCS, and terminals when shadow reports `t3Server: true`.
 */
export function useT3Cutover(input: {
  readonly substrateActive: boolean;
  readonly shadowBaseUrl: string | null;
}): T3CutoverState {
  const ownerRef = useRef(Symbol("t3-cutover-owner"));
  const owner = ownerRef.current;
  const [state, setState] = useState<T3CutoverState>({
    active: false,
    loading: false,
    error: null,
    nativeApi: null,
    orchestration: null,
    refreshProviders: null,
  });

  useEffect(() => {
    if (!input.substrateActive || !input.shadowBaseUrl) {
      disconnectT3ServerConfigBridge(owner);
      registerT3NativeApiOverlay(owner, null);
      setT3CutoverActive(owner, false);
      setState({
        active: false,
        loading: false,
        error: null,
        nativeApi: null,
        orchestration: null,
        refreshProviders: null,
      });
      return;
    }

    let cancelled = false;
    let sessionClose: (() => Promise<void>) | null = null;
    let disconnectPreviewHost: (() => void) | null = null;

    setState((current) => ({ ...current, loading: true, error: null }));

    void (async () => {
      try {
        const t3Enabled = await readShadowReadyT3Enabled(input.shadowBaseUrl!);
        if (cancelled || !t3Enabled) {
          if (!cancelled) {
            disconnectT3ServerConfigBridge(owner);
            registerT3NativeApiOverlay(owner, null);
            setT3CutoverActive(owner, false);
            setState({
              active: false,
              loading: false,
              error: null,
              nativeApi: null,
              orchestration: null,
              refreshProviders: null,
            });
          }
          return;
        }

        const rpcSessionPayload = await fetchT3RpcSession(input.shadowBaseUrl!);
        if (cancelled) return;

        const session = createT3RpcSession({
          baseUrl: rpcSessionPayload.baseUrl,
          wsTicket: rpcSessionPayload.wsTicket,
        });
        sessionClose = () => session.close();
        disconnectPreviewHost = registerT3PreviewAutomationHost(owner, {
          session,
          baseUrl: rpcSessionPayload.baseUrl,
        });

        const nativeApi = createT3NativeApi(session);
        const orchestrationHandle = createT3OrchestrationApiFromClient(session.orchestration);

        connectT3ServerConfigBridge(owner, {
          getConfig: () => session.serverConfig.getConfig(),
          subscribe: (listener) => {
            let active = true;
            let unsubscribe: (() => void) | null = null;
            void session.serverConfig.subscribeServerConfig((config) => {
              if (active) {
                listener(config);
              }
            }).then((unsub) => {
              unsubscribe = unsub;
            });
            return () => {
              active = false;
              unsubscribe?.();
            };
          },
          refreshProviders: () => session.serverConfig.refreshProviders(),
          updateProvider: (provider, instanceId) =>
            session.serverConfig.updateProvider(provider, instanceId),
        });

        registerT3NativeApiOverlay(owner, nativeApi);
        setT3CutoverActive(owner, true);

        if (cancelled) {
          disconnectT3ServerConfigBridge(owner);
          registerT3NativeApiOverlay(owner, null);
          setT3CutoverActive(owner, false);
          disconnectPreviewHost?.();
          await session.close();
          return;
        }

        setState({
          active: true,
          loading: false,
          error: null,
          nativeApi,
          orchestration: orchestrationHandle.orchestration,
          refreshProviders: () => session.serverConfig.refreshProviders(),
        });
      } catch (error) {
        disconnectPreviewHost?.();
        disconnectT3ServerConfigBridge(owner);
        registerT3NativeApiOverlay(owner, null);
        setT3CutoverActive(owner, false);
        if (!cancelled) {
          setState({
            active: false,
            loading: false,
            error: error instanceof Error ? error.message : String(error),
            nativeApi: null,
            orchestration: null,
            refreshProviders: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      disconnectT3ServerConfigBridge(owner);
      registerT3NativeApiOverlay(owner, null);
      setT3CutoverActive(owner, false);
      disconnectPreviewHost?.();
      void sessionClose?.();
    };
  }, [
    input.substrateActive,
    input.shadowBaseUrl,
    owner,
    T3_PREVIEW_AUTOMATION_HOST_REVISION,
  ]);

  return state;
}
