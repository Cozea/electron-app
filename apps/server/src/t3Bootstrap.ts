import {
  exchangeBootstrapAccessToken,
  issueWebSocketTicket,
  T3EffectRpcClient,
} from "@cozea/client-runtime";
import path from "node:path";
import type { OrchestrationBackendProxy } from "./t3/orchestrationProxy.ts";
import { T3OrchestrationRpcProxy } from "./t3/orchestrationProxy.ts";
import { resolveDefaultT3BaseDir, startT3ServerProcess, type T3ServerProcessHandle } from "./t3/process.ts";

export interface BootstrapT3ServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly baseDir?: string;
  readonly onLog?: (line: string) => void;
}

export interface T3ServerBootstrapHandle {
  readonly process: T3ServerProcessHandle;
  readonly proxy: OrchestrationBackendProxy;
  readonly issueWsTicket: () => Promise<string>;
  readonly stop: () => Promise<void>;
}

export async function bootstrapT3Server(
  options: BootstrapT3ServerOptions = {},
): Promise<T3ServerBootstrapHandle> {
  const baseDir =
    options.baseDir?.trim() ||
    process.env.COZEA_T3_SERVER_BASE_DIR?.trim() ||
    resolveDefaultT3BaseDir();

  const processHandle = await startT3ServerProcess({ ...options, baseDir });
  let accessToken: string;
  let wsTicket: string;
  try {
    accessToken = await exchangeBootstrapAccessToken(
      processHandle.baseUrl,
      processHandle.pairingToken,
    );
    wsTicket = await issueWebSocketTicket(processHandle.baseUrl, accessToken);
  } catch (error) {
    await processHandle.stop().catch(() => {});
    throw error;
  }
  const proxy = new T3OrchestrationRpcProxy(new T3EffectRpcClient({ baseUrl: processHandle.baseUrl, wsTicket }), {
    userdataSqlitePath: path.join(baseDir, "userdata", "state.sqlite"),
  });

  return {
    process: processHandle,
    proxy,
    issueWsTicket: () => issueWebSocketTicket(processHandle.baseUrl, accessToken),
    stop: async () => {
      // A failed (or slow) transport close must not leave the native process
      // running. Start both cleanups independently, but never acknowledge a
      // successful shutdown if either owner could not complete its cleanup.
      const results = await Promise.allSettled([
        Promise.resolve().then(() => proxy.close()),
        Promise.resolve().then(() => processHandle.stop()),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        throw new Error("Native chat shutdown was not fully acknowledged.");
      }
    },
  };
}
