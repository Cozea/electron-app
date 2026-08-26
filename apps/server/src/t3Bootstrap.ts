import {
  exchangeBootstrapAccessToken,
  issueWebSocketTicket,
  T3EffectRpcClient,
} from "@cozea/client-runtime";
import type { OrchestrationBackendProxy } from "./t3/orchestrationProxy.ts";
import { T3OrchestrationRpcProxy } from "./t3/orchestrationProxy.ts";
import { startT3ServerProcess, type T3ServerProcessHandle } from "./t3/process.ts";

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
  const processHandle = await startT3ServerProcess(options);
  const accessToken = await exchangeBootstrapAccessToken(
    processHandle.baseUrl,
    processHandle.pairingToken,
  );
  const wsTicket = await issueWebSocketTicket(processHandle.baseUrl, accessToken);
  const proxy = new T3OrchestrationRpcProxy(
    new T3EffectRpcClient({ baseUrl: processHandle.baseUrl, wsTicket }),
  );

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
