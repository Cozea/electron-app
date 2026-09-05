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
import { readShadowReadyT3Enabled } from "./useSubstrateOrchestrationSync";
import { superviseSubscription } from "./subscriptionSupervisor";
import {
  registerT3PreviewAutomationHost,
  T3_PREVIEW_AUTOMATION_HOST_REVISION,
} from "./t3PreviewAutomationHost";

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

    return startT3Cutover(input.shadowBaseUrl, owner, setState);
  }, [
    input.substrateActive,
    input.shadowBaseUrl,
    owner,
    T3_PREVIEW_AUTOMATION_HOST_REVISION,
  ]);

  return state;
}


const inactiveCutover: T3CutoverState = {
  active: false, loading: false, error: null, nativeApi: null, orchestration: null, refreshProviders: null,
};

/** Reacquire session ownership only; submitted commands are never replayed. */
export function startT3Cutover(
  baseUrl: string,
  owner: symbol,
  update: (state: T3CutoverState) => void,
): () => void {
  let legacy = false;
  const clearOverlay = () => {
    disconnectT3ServerConfigBridge(owner);
    registerT3NativeApiOverlay(owner, null);
    setT3CutoverActive(owner, false);
  };
  const stop = superviseSubscription({
    status: status => {
      if (status.phase === "connected") return;
      clearOverlay();
      update({ ...inactiveCutover, loading: !legacy && status.phase !== "error", error: legacy ? null : status.error });
    },
    connect: async attempt => {
      // Legacy fallback is valid only for a successful probe in this attempt.
      legacy = false;
      const abort = new AbortController();
      attempt.own(() => abort.abort());
      const enabled = await readShadowReadyT3Enabled(baseUrl, abort.signal);
      if (!attempt.isCurrent()) return;
      legacy = !enabled;
      if (!enabled) {
        clearOverlay();
        update(inactiveCutover);
        attempt.ready();
        // A restarted shadow can enable native transport at the same URL.
        const timer = setTimeout(() => attempt.disconnected(), 3_000);
        attempt.own(() => clearTimeout(timer));
        return;
      }
      const payload = await fetchT3RpcSession(baseUrl, abort.signal);
      if (!attempt.isCurrent()) return;
      const session = createT3RpcSession({ baseUrl: payload.baseUrl, wsTicket: payload.wsTicket });
      attempt.own(() => session.close());
      attempt.own(session.client.onDisconnect(attempt.disconnected));
      // Establish readiness with a read, not successful ticket acquisition alone.
      await session.serverConfig.getConfig();
      if (!attempt.isCurrent()) return;
      attempt.own(registerT3PreviewAutomationHost(owner, { session, baseUrl: payload.baseUrl }));
      const localHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);
      const localProviderSetup = [baseUrl, payload.baseUrl].every(value => {
        const url = new URL(value);
        return url.protocol === "http:" && localHostnames.has(url.hostname);
      });
      const nativeApi = createT3NativeApi(session, { localProviderSetup });
      const orchestrationHandle = createT3OrchestrationApiFromClient(session.orchestration);
      attempt.own(clearOverlay);
      connectT3ServerConfigBridge(owner, {
        getConfig: () => session.serverConfig.getConfig(),
        subscribe: listener => {
          let active = true;
          let unsubscribe: (() => void) | null = null;
          void session.serverConfig.subscribeServerConfig(config => {
            if (active && attempt.isCurrent()) listener(config);
          }).then(unsub => {
            if (active && attempt.isCurrent()) unsubscribe = unsub;
            else unsub();
          }).catch(error => { if (active) attempt.disconnected(error); });
          return () => { active = false; unsubscribe?.(); };
        },
        refreshProviders: () => session.serverConfig.refreshProviders(),
        updateProvider: (provider, instanceId) => session.serverConfig.updateProvider(provider, instanceId),
      });
      registerT3NativeApiOverlay(owner, nativeApi);
      setT3CutoverActive(owner, true);
      update({
        active: true, loading: false, error: null, nativeApi,
        orchestration: orchestrationHandle.orchestration,
        refreshProviders: () => session.serverConfig.refreshProviders(),
      });
      attempt.ready();
    },
  });
  return () => { stop(); clearOverlay(); };
}
