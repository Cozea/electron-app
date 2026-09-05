import { useEffect, useState } from "react";

import {
  readSubstrateShadowBridgeStatus,
  type SubstrateShadowBridgeStatus,
} from "@/lib/desktopBridgeClient";

import { isSubstrateRpcChatEnabled } from "./rpcChatFlags";

const SHADOW_STATUS_POLL_MS = 3_000;

/** The bridge exposes a status read, not a status subscription. Keep discovery
 * alive after readiness so a restarted child can publish its new endpoint. */
export function watchSubstrateShadowStatus(
  onStatus: (status: SubstrateShadowBridgeStatus | null) => void,
  onError: (error: unknown) => void,
): () => void {
  let cancelled = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    try {
      const status = await readSubstrateShadowBridgeStatus();
      if (cancelled) return;
      // The bridge deliberately reports unavailable/failed reads as null.
      failures = status === null ? failures + 1 : 0;
      onStatus(status);
    } catch (error) {
      if (cancelled) return;
      failures += 1;
      onError(error);
    }
    if (!cancelled) timer = setTimeout(() => void refresh(), Math.min(30_000, SHADOW_STATUS_POLL_MS * 2 ** Math.min(failures, 4)));
  };
  void refresh();
  return () => { cancelled = true; clearTimeout(timer); };
}

interface ShadowStatusSubscriber {
  status: (status: SubstrateShadowBridgeStatus | null) => void;
  error: (error: unknown) => void;
}

type ShadowStatusResult =
  | { kind: "status"; value: SubstrateShadowBridgeStatus | null }
  | { kind: "error"; value: string };

function equalShadowStatus(a: SubstrateShadowBridgeStatus | null, b: SubstrateShadowBridgeStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.phase === b.phase && a.enabled === b.enabled && a.baseUrl === b.baseUrl &&
    a.readyPath === b.readyPath && a.lastError === b.lastError &&
    a.features.rpcChat === b.features.rpcChat && a.features.providers === b.features.providers &&
    a.features.vcs === b.features.vcs && a.features.primary === b.features.primary &&
    a.features.obsNdjson === b.features.obsNdjson &&
    a.features.inProcessAssistant === b.features.inProcessAssistant;
}

const shadowSubscribers = new Set<ShadowStatusSubscriber>();
let stopShadowWatcher: (() => void) | undefined;
let shadowResult: ShadowStatusResult | undefined;
let lastShadowStatus: Extract<ShadowStatusResult, { kind: "status" }> | undefined;
const deliverShadowResult = (subscriber: ShadowStatusSubscriber, result: ShadowStatusResult) => {
  if (result.kind === "status") subscriber.status(result.value);
  else subscriber.error(new Error(result.value));
};

/** One bridge read loop per renderer, irrespective of the number of mounted tiles. */
export function subscribeSubstrateShadowStatus(
  onStatus: ShadowStatusSubscriber["status"],
  onError: ShadowStatusSubscriber["error"],
): () => void {
  const subscriber = { status: onStatus, error: onError };
  shadowSubscribers.add(subscriber);
  if (shadowResult?.kind === "error" && lastShadowStatus) deliverShadowResult(subscriber, lastShadowStatus);
  if (shadowResult) deliverShadowResult(subscriber, shadowResult);
  if (!stopShadowWatcher) {
    const publish = (result: ShadowStatusResult) => {
      if (result.kind === "status" && shadowResult?.kind === "status" && equalShadowStatus(result.value, shadowResult.value)) return;
      if (result.kind === "error" && shadowResult?.kind === "error" && result.value === shadowResult.value) return;
      if (result.kind === "status") {
        if (lastShadowStatus && equalShadowStatus(result.value, lastShadowStatus.value)) result = lastShadowStatus;
        lastShadowStatus = result;
      }
      shadowResult = result;
      for (const listener of shadowSubscribers) deliverShadowResult(listener, result);
    };
    stopShadowWatcher = watchSubstrateShadowStatus(
      value => publish({ kind: "status", value }),
      error => publish({ kind: "error", value: error instanceof Error ? error.message : String(error) }),
    );
  }
  return () => {
    if (!shadowSubscribers.delete(subscriber) || shadowSubscribers.size > 0) return;
    stopShadowWatcher?.();
    stopShadowWatcher = undefined;
    shadowResult = undefined;
    lastShadowStatus = undefined;
  };
}

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

    return subscribeSubstrateShadowStatus(
      status => {
        setShadowStatus(status);
        setError(status?.lastError ?? null);
        const stillStarting =
          status?.enabled === true &&
          status.phase !== "ready" &&
          status.phase !== "error";
        setLoading(stillStarting);
      },
      readError => {
        setError(readError instanceof Error ? readError.message : String(readError));
        setLoading(false);
      },
    );
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
