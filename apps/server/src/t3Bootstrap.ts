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
  options.onLog?.(`[t3Bootstrap] process ready at ${processHandle.baseUrl}, token ${processHandle.pairingToken.slice(0, 4)}...`);
  let accessToken: string;
  let wsTicket: string;
  try {
    options.onLog?.("[t3Bootstrap] exchangeBootstrapAccessToken starting");
    accessToken = await exchangeBootstrapAccessToken(
      processHandle.baseUrl,
      processHandle.pairingToken,
    );
    options.onLog?.("[t3Bootstrap] exchange done");
    wsTicket = await issueWebSocketTicket(processHandle.baseUrl, accessToken);
    options.onLog?.("[t3Bootstrap] ticket done");
  } catch (error) {
    options.onLog?.(`[t3Bootstrap] auth failed: ${error instanceof Error ? error.message : String(error)}`);
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
      await proxy.close();
      await processHandle.stop();
    },
  };
}
