import type {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "@cozea/assistant-contracts";
import { WS_METHODS } from "@cozea/contracts";

import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3TerminalClientOptions {
  readonly client: T3EffectRpcClient;
}

/** Native T3 Effect RPC terminal client (Phase T5). */
export class T3TerminalClient {
  private readonly client: T3EffectRpcClient;
  private terminalUnsubscribe: (() => Promise<void>) | null = null;
  private readonly eventListeners = new Set<(event: TerminalEvent) => void>();

  constructor(options: T3TerminalClientOptions) {
    this.client = options.client;
  }

  async open(input: TerminalOpenInput): Promise<TerminalSessionSnapshot> {
    return (await this.client.callUnary(WS_METHODS.terminalOpen, input)) as TerminalSessionSnapshot;
  }

  async write(input: TerminalWriteInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.terminalWrite, input);
  }

  async resize(input: TerminalResizeInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.terminalResize, input);
  }

  async clear(input: TerminalClearInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.terminalClear, input);
  }

  async restart(input: TerminalRestartInput): Promise<TerminalSessionSnapshot> {
    return (await this.client.callUnary(
      WS_METHODS.terminalRestart,
      input,
    )) as TerminalSessionSnapshot;
  }

  async closeSession(input: TerminalCloseInput): Promise<void> {
    await this.client.callUnary(WS_METHODS.terminalClose, input);
  }

  private async ensureTerminalSubscription(): Promise<void> {
    if (this.terminalUnsubscribe) {
      return;
    }
    this.terminalUnsubscribe = await this.client.openStream(
      WS_METHODS.subscribeTerminalEvents,
      {},
      (item) => {
        const event = item as TerminalEvent;
        for (const listener of this.eventListeners) {
          listener(event);
        }
      },
    );
  }

  async onEvent(listener: (event: TerminalEvent) => void): Promise<() => void> {
    this.eventListeners.add(listener);
    await this.ensureTerminalSubscription();
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async close(): Promise<void> {
    this.eventListeners.clear();
    if (this.terminalUnsubscribe) {
      await this.terminalUnsubscribe();
      this.terminalUnsubscribe = null;
    }
  }
}
