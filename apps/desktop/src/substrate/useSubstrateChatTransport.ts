import { useEffect, useState } from "react";

import {
  readSubstrateShadowBridgeStatus,
  type SubstrateShadowBridgeStatus,
} from "@/lib/desktopBridgeClient";

import { isSubstrateRpcChatEnabled } from "./rpcChatFlags";

const SHADOW_STATUS_POLL_MS = 3_000;

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
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const refresh = async (): Promise<void> => {
      try {
        const status = await readSubstrateShadowBridgeStatus();
        if (cancelled) {
          return;
        }
        setShadowStatus(status);
        setError(status?.lastError ?? null);
        const stillStarting =
          status?.enabled === true &&
          status.phase !== "ready" &&
          status.phase !== "error";
        setLoading(stillStarting);
        if (!stillStarting && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      } catch (readError) {
        if (!cancelled) {
          setError(readError instanceof Error ? readError.message : String(readError));
          setLoading(false);
        }
      }
    };

    void refresh();
    pollTimer = setInterval(() => {
      void refresh();
    }, SHADOW_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
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
