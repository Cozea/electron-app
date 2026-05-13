// @ts-nocheck
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { NetService } from "@cozea/assistant-shared/Net";

import { CliConfig, makeServerProgram, type CliInput } from "./main";
import { OpenLive } from "./open";
import { ServerLive } from "./wsServer";

const RuntimeLayer = Layer.empty.pipe(
  Layer.provideMerge(CliConfig.layer),
  Layer.provideMerge(ServerLive),
  Layer.provideMerge(OpenLive),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(FetchHttpClient.layer),
);

export function startAssistantRuntime() {
  const input: CliInput = {
    mode: Option.some("desktop"),
    port: Option.none(),
    host: Option.none(),
    assistantHome: Option.none(),
    devUrl: Option.none(),
    noBrowser: Option.some(true),
    authToken: Option.none(),
    bootstrapFd: Option.none(),
    autoBootstrapProjectFromCwd: Option.none(),
    logWebSocketEvents: Option.none(),
  };

  const program = Effect.scoped(makeServerProgram(input)).pipe(
    Effect.provide(RuntimeLayer),
  ) as any;

  return Effect.runFork(program);
}
