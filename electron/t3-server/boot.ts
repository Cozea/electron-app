// @ts-nocheck
import { Effect, Option } from "effect";
import { makeServerRuntimeProgram } from "./main";

export function startT3Server() {
  const input = {
    mode: Option.some("desktop"),
    port: Option.none(),
    host: Option.none(),
    t3Home: Option.none(),
    devUrl: Option.none(),
    noBrowser: Option.some(true),
    authToken: Option.none(),
    bootstrapFd: Option.none(),
    autoBootstrapProjectFromCwd: Option.none(),
    logWebSocketEvents: Option.none(),
  };

  Effect.runFork(makeServerRuntimeProgram(input));
}
