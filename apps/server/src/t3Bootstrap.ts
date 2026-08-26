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
  readonly stop: () => Promise<void>;
}

export async function bootstrapT3Server(
  options: BootstrapT3ServerOptions = {},
): Promise<T3ServerBootstrapHandle> {
  const processHandle = await startT3ServerProcess(options);
  const proxy = await T3OrchestrationRpcProxy.connect({
    baseUrl: processHandle.baseUrl,
    pairingToken: processHandle.pairingToken,
  });

  return {
    process: processHandle,
    proxy,
    stop: async () => {
      await proxy.close();
      await processHandle.stop();
    },
  };
}
