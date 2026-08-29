import type { ServerConfig, ServerProviderUpdatedPayload } from "@cozea/assistant-contracts";
import { WS_METHODS } from "@cozea/contracts";

import {
  applyServerConfigProjection,
  type ServerConfigStreamEvent,
} from "./applyServerConfigProjection";
import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3ServerConfigClientOptions {
  readonly baseUrl: string;
  readonly wsTicket: string;
  readonly client?: T3EffectRpcClient;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

/** Native T3 Effect RPC server-config client (Phase T4). */
export class T3ServerConfigClient {
  private readonly client: T3EffectRpcClient;
  private readonly ownsClient: boolean;
  private configUnsubscribe: (() => Promise<void>) | null = null;
  private readonly configListeners = new Set<(config: ServerConfig) => void>();
  private currentConfig: ServerConfig | null = null;

  constructor(options: T3ServerConfigClientOptions) {
    if (options.client) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = new T3EffectRpcClient({
        baseUrl: options.baseUrl,
        wsTicket: options.wsTicket,
        WebSocketImpl: options.WebSocketImpl,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      this.ownsClient = true;
    }
  }

  async close(): Promise<void> {
    this.configListeners.clear();
    this.currentConfig = null;
    if (this.configUnsubscribe) {
      await this.configUnsubscribe();
      this.configUnsubscribe = null;
    }
    if (this.ownsClient) {
      await this.client.close();
    }
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

  async updateProvider(
    provider: string,
    instanceId?: string,
  ): Promise<ServerProviderUpdatedPayload> {
    return (await this.client.callUnary(WS_METHODS.serverUpdateProvider, {
      provider,
      ...(instanceId ? { instanceId } : {}),
    })) as ServerProviderUpdatedPayload;
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
