import { T3EffectRpcClient, type T3EffectRpcClientOptions } from "./effectRpcClient";
import { T3OrchestrationClient } from "./t3OrchestrationClient";
import { T3ServerConfigClient } from "./t3ServerConfigClient";
import { T3TerminalClient } from "./t3TerminalClient";
import { T3VcsClient } from "./t3VcsClient";

export interface T3RpcSessionHandle {
  readonly client: T3EffectRpcClient;
  readonly orchestration: T3OrchestrationClient;
  readonly serverConfig: T3ServerConfigClient;
  readonly vcs: T3VcsClient;
  readonly terminal: T3TerminalClient;
  close(): Promise<void>;
}

/** One shared T3 WebSocket session for orchestration, config, VCS, and terminals. */
export function createT3RpcSession(options: T3EffectRpcClientOptions): T3RpcSessionHandle {
  const client = new T3EffectRpcClient(options);
  const orchestration = new T3OrchestrationClient({ ...options, client });
  const serverConfig = new T3ServerConfigClient({ ...options, client });
  const vcs = new T3VcsClient({ client });
  const terminal = new T3TerminalClient({ client });

  return {
    client,
    orchestration,
    serverConfig,
    vcs,
    terminal,
    close: async () => {
      await vcs.close();
      await terminal.close();
      await orchestration.close();
      await serverConfig.close();
      await client.close();
    },
  };
}
