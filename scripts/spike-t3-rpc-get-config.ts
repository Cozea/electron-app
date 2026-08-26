/**
 * Run from vendor/t3code so workspace packages resolve:
 *   pnpm exec node --experimental-strip-types ../../scripts/spike-t3-rpc-get-config.ts <port> <wsTicket>
 */
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as Socket from "effect/unstable/socket/Socket";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const wsTicket = process.argv[3]?.trim();
if (!Number.isFinite(port) || port <= 0 || !wsTicket) {
  console.error("usage: spike-t3-rpc-get-config.ts <port> <wsTicket>");
  process.exit(2);
}

const wsUrl = `ws://127.0.0.1:${port}/ws?wsTicket=${encodeURIComponent(wsTicket)}&clientSurface=web`;

const webSocketConstructorLayer = Layer.succeed(
  Socket.WebSocketConstructor,
  (url, protocols) =>
    new NodeSocket.NodeWS.WebSocket(url, protocols, { perMessageDeflate: true }) as unknown as globalThis.WebSocket,
);

const protocolLayer = RpcClient.layerProtocolSocket().pipe(
  Layer.provide(Socket.layerWebSocket(wsUrl).pipe(Layer.provide(webSocketConstructorLayer))),
  Layer.provide(RpcSerialization.layerJson),
);

const makeClient = RpcClient.make(WsRpcGroup);

const program = Effect.gen(function* () {
  const client = yield* makeClient;
  const config = yield* client[WS_METHODS.serverGetConfig]({});
  const providers = Array.isArray(config.providers) ? config.providers : [];
  console.log(
    JSON.stringify({
      providerCount: providers.length,
      providers: providers.map((p) => p.label ?? p.kind ?? p.instanceId ?? p.id ?? "unknown"),
    }),
  );
});

program.pipe(Effect.scoped, Effect.provide(protocolLayer), Effect.runPromise).catch((error) => {
  console.error("rpc probe failed:", error);
  process.exit(1);
});
