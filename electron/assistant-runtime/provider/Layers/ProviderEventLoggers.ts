import { Layer, ServiceMap } from "effect";

import type { EventNdjsonLogger } from "./EventNdjsonLogger.ts";

export interface ProviderEventLoggersShape {
  readonly native?: EventNdjsonLogger | undefined;
}

export class ProviderEventLoggers extends ServiceMap.Service<
  ProviderEventLoggers,
  ProviderEventLoggersShape
>()("cozea/assistant-runtime/provider/Layers/ProviderEventLoggers") {}

export const ProviderEventLoggersLive = (loggers: ProviderEventLoggersShape = {}) =>
  Layer.succeed(ProviderEventLoggers, loggers);
