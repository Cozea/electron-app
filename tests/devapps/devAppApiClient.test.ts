import { MessageChannel } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import {
  createDevAppClient,
  type DevAppMethodDefinition,
} from "../../packages/devapp-api/src/index";
import type { CozeaDevAppViewBridge } from "../../shared/devAppViewBridge";

describe("@cozea/devapp-api", () => {
  it("correlates typed view requests over the package-private port", async () => {
    interface Methods {
      echo: DevAppMethodDefinition<{ value: string }, { value: string }>;
    }
    const channel = new MessageChannel();
    channel.port2.on("message", (message) => {
      channel.port2.postMessage({
        kind: "response",
        protocolVersion: message.protocolVersion,
        id: message.id,
        result: { value: message.params.value },
      });
    });
    const connection = {
      bootstrap: {
        kind: "cozea-devapp-view-port",
        protocolVersion: 1,
        supportedProtocolVersions: { min: 1, max: 1 },
        connectionId: "connection_a",
      },
      port: channel.port1 as unknown as MessagePort,
    } as const;
    const bridge: CozeaDevAppViewBridge = {
      connectWorker: async () => connection,
      currentWorker: () => connection,
      onWorkerConnection: () => () => undefined,
    };
    const client = createDevAppClient<Methods>({ bridge, requestTimeoutMs: 1_000 });

    await expect(client.request("echo", { value: "ready" })).resolves.toEqual({ value: "ready" });
    client.disconnect();
    channel.port2.close();
  });

  it("moves subsequent requests to a replacement worker connection", async () => {
    interface Methods {
      identify: DevAppMethodDefinition<Record<string, never>, { connection: string }>;
    }
    const first = new MessageChannel();
    const second = new MessageChannel();
    const makeConnection = (id: string, port: MessagePort) => ({
      bootstrap: {
        kind: "cozea-devapp-view-port" as const,
        protocolVersion: 1,
        supportedProtocolVersions: { min: 1, max: 1 },
        connectionId: id,
      },
      port,
    });
    const listeners = new Set<(connection: ReturnType<typeof makeConnection>) => void>();
    let current = makeConnection("first", first.port1 as unknown as MessagePort);
    for (const [port, connection] of [
      [first.port2, "first"],
      [second.port2, "second"],
    ] as const) {
      port.on("message", (message) => {
        port.postMessage({
          kind: "response",
          protocolVersion: message.protocolVersion,
          id: message.id,
          result: { connection },
        });
      });
    }
    const bridge: CozeaDevAppViewBridge = {
      connectWorker: async () => current,
      currentWorker: () => current,
      onWorkerConnection: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const client = createDevAppClient<Methods>({ bridge, requestTimeoutMs: 1_000 });

    await expect(client.request("identify", {})).resolves.toEqual({ connection: "first" });
    current = makeConnection("second", second.port1 as unknown as MessagePort);
    for (const listener of listeners) listener(current);
    await expect(client.request("identify", {})).resolves.toEqual({ connection: "second" });

    client.disconnect();
    first.port2.close();
    second.port2.close();
  });
});
