/** Shadow child endpoint for renderer-native T3 Effect RPC sessions. */
export const SUBSTRATE_T3_RPC_SESSION_PATH = "/.well-known/cozea/substrate/t3-rpc-session";

export interface T3RpcSessionPayload {
  readonly ok: true;
  readonly baseUrl: string;
  readonly wsTicket: string;
}

export async function fetchT3RpcSession(shadowBaseUrl: string): Promise<T3RpcSessionPayload> {
  const url = new URL(SUBSTRATE_T3_RPC_SESSION_PATH, shadowBaseUrl);
  const response = await fetch(url);
  const json = (await response.json()) as T3RpcSessionPayload | { ok: false; error?: string };
  if (!response.ok || !json.ok) {
    throw new Error(
      "error" in json && json.error ? json.error : `T3 RPC session unavailable (${response.status})`,
    );
  }
  return json;
}
