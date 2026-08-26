import type { ServerConfig } from "@cozea/assistant-contracts";
import { WS_METHODS } from "@cozea/contracts";

import {
  applyServerConfigProjection,
  type ServerConfigStreamEvent,
} from "./applyServerConfigProjection";
import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3ServerConfigClientOptions {
  readonly baseUrl: string;
  readonly wsTicket: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

/** Native T3 Effect RPC server-config client (Phase T4). */
export class T3ServerConfigClient {
  private readonly client: T3EffectRpcClient;
  private configUnsubscribe: (() => Promise<void>) | null = null;
  private readonly configListeners = new Set<(config: ServerConfig) => void>();
  private currentConfig: ServerConfig | null = null;

  constructor(options: T3ServerConfigClientOptions) {
    this.client = new T3EffectRpcClient(options);
  }

  async close(): Promise<void> {
    this.configListeners.clear();
    this.currentConfig = null;
    if (this.configUnsubscribe) {
      await this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
    await this.client.close();
  }

  async getConfig(): Promise<ServerConfig> {
    const result = await this.client.callUnary(WS_METHODS.serverGetConfig, {});
    const config = result as ServerConfig;
    this.currentConfig = config;
    return config;
  }

  async refreshProviders(): Promise<void> {
    await this.client.callUnary(WS_METHODS.serverRefreshProviders, {});
  }

  private async ensureConfigSubscription(): Promise<void> {
    if (this.configUnsubscribe) {
      return;
    }
    this.configUnsubscribe = await this.client.openStream(
      WS_METHODS.subscribeServerConfig,
      {},
      (item) => {
        const event = item as ServerConfigStreamEvent;
        const next = applyServerConfigProjection(this.currentConfig, event);
        if (!next) {
          return;
        }
        this.currentConfig = next;
        for (const listener of this.configListeners) {
          listener(next);
        }
      },
    );
  }

  async subscribeServerConfig(listener: (config: ServerConfig) => void): Promise<() => void> {
    this.configListeners.add(listener);
    if (this.currentConfig) {
      listener(this.currentConfig);
    }
    await this.ensureConfigSubscription();
    return () => {
      this.configListeners.delete(listener);
    };
  }
}
