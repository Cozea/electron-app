// @ts-nocheck
import type {
  ProviderDriverKind,
  ProviderInstanceConfig,
  ProviderInstanceEnvironment,
  ProviderInstanceId,
} from "@cozea/assistant-contracts";
import type { Effect, Schema, Scope } from "effect";

import type { ProviderAdapterError, ProviderDriverError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";
import type { TextGenerationShape } from "../git/Services/TextGeneration.ts";

export interface ProviderDriverMetadata {
  readonly displayName: string;
  readonly supportsMultipleInstances?: boolean;
}

export interface ProviderInstance {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly enabled: boolean;
  readonly config: ProviderInstanceConfig;
  readonly snapshot: ServerProviderShape;
  readonly adapter: ProviderAdapterShape<ProviderAdapterError>;
  readonly textGeneration: TextGenerationShape;
}

export interface ProviderDriverCreateInput<Config> {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor?: string | undefined;
  readonly environment: ProviderInstanceEnvironment;
  readonly enabled: boolean;
  readonly config: Config;
  readonly rawConfig: ProviderInstanceConfig;
}

export interface ProviderDriver<Config, R = never> {
  readonly driverKind: ProviderDriverKind;
  readonly metadata: ProviderDriverMetadata;
  readonly configSchema: Schema.Codec<Config, unknown>;
  readonly defaultConfig: () => Config;
  readonly create: (
    input: ProviderDriverCreateInput<Config>,
  ) => Effect.Effect<ProviderInstance, ProviderDriverError, R | Scope.Scope>;
}

export type AnyProviderDriver<R = never> = ProviderDriver<any, R>;
