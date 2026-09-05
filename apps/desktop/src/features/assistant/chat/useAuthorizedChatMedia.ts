import { useEffect, useState } from "react";
import { T3OrchestrationClient } from "@cozea/client-runtime";
import type { AssetResource } from "@cozea/contracts/t3";
import { fetchT3RpcSession } from "@/substrate/fetchT3RpcSession";
import { resolveSignedAssetUrl } from "./chatMediaSource";
import { createChatMediaCache, type ChatMediaState } from "./chatMediaCache";

const subscribe = createChatMediaCache({
  resolve: async (key, signal) => {
    const [baseUrl, resource] = JSON.parse(key) as [string, AssetResource];
    const session = await fetchT3RpcSession(
      baseUrl,
      AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    );
    if (signal.aborted) throw new Error("Media request cancelled");
    const client = new T3OrchestrationClient(session);
    const close = () => {
      void client.close();
    };
    signal.addEventListener("abort", close, { once: true });
    try {
      const result = await client.createAssetUrl(resource);
      return {
        url: resolveSignedAssetUrl(session.baseUrl, result.relativeUrl),
        expiresAt: result.expiresAt,
      };
    } finally {
      signal.removeEventListener("abort", close);
      await client.close();
    }
  },
});

export function useAuthorizedChatMedia(
  baseUrl: string | null,
  resource: AssetResource | null,
): ChatMediaState {
  const key = baseUrl && resource ? JSON.stringify([baseUrl, resource]) : null;
  const [state, setState] = useState<ChatMediaState & { key: string | null }>({
    key: null,
    url: null,
    error: false,
  });
  useEffect(() => {
    if (!key) return;
    return subscribe(key, (next) => setState({ key, ...next }));
  }, [key]);
  return state.key === key ? state : { url: null, error: false };
}
