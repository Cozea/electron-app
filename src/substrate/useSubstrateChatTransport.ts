import { useEffect, useState } from "react";

import {
  readSubstrateShadowBridgeStatus,
  type SubstrateShadowBridgeStatus,
} from "@/lib/desktopBridgeClient";

import { isSubstrateRpcChatEnabled } from "./rpcChatFlags";

export interface SubstrateChatTransportState {
  /** Renderer flag + shadow ready + in-process assistant skipped (primary path). */
  readonly active: boolean;
  readonly loading: boolean;
  readonly shadowStatus: SubstrateShadowBridgeStatus | null;
  readonly shadowBaseUrl: string | null;
  readonly error: string | null;
}

/**
 * When primary substrate mode is on, the workbench must send chat via shadow RPC
 * instead of the in-process assistant WebSocket.
 */
export function useSubstrateChatTransport(): SubstrateChatTransportState {
  const rpcFlag = isSubstrateRpcChatEnabled();
  const [shadowStatus, setShadowStatus] = useState<SubstrateShadowBridgeStatus | null>(null);
  const [loading, setLoading] = useState(rpcFlag);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rpcFlag) {
      setShadowStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const status = await readSubstrateShadowBridgeStatus();
        if (!cancelled) {
          setShadowStatus(status);
          setError(status?.lastError ?? null);
        }
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rpcFlag]);

  const shadowReady = shadowStatus?.phase === "ready";
  const primaryPath =
    shadowStatus?.features.primary === true &&
    shadowStatus.features.inProcessAssistant === false;
  const active = rpcFlag && shadowReady && primaryPath;

  return {
    active,
    loading,
    shadowStatus,
    shadowBaseUrl: shadowStatus?.baseUrl ?? null,
    error,
  };
}
