// @ts-nocheck
import {
  ClaudeSettings,
  CodexSettings,
  CursorSettings,
  OpenCodeSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ServerProvider,
} from "@cozea/assistant-contracts";
import { Effect, Layer, Schema, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService, type ServerSettingsShape } from "../serverSettings.ts";
import { ProviderDriverError } from "./Errors.ts";
import type { AnyProviderDriver, ProviderDriver, ProviderInstance } from "./ProviderDriver.ts";
import {
  asBuiltInProviderKind,
  makeProviderInstanceScopedSettings,
} from "./ProviderInstanceScopedSettings.ts";
import { ClaudeAdapter } from "./Services/ClaudeAdapter.ts";
import { ClaudeProvider } from "./Services/ClaudeProvider.ts";
import { CodexAdapter } from "./Services/CodexAdapter.ts";
import { CodexProvider } from "./Services/CodexProvider.ts";
import { CursorAdapter } from "./Services/CursorAdapter.ts";
import { CursorProvider } from "./Services/CursorProvider.ts";
import { OpenCodeAdapter } from "./Services/OpenCodeAdapter.ts";
import { OpenCodeProvider } from "./Services/OpenCodeProvider.ts";
import { makeClaudeAdapterLive } from "./Layers/ClaudeAdapter.ts";
import { ClaudeProviderLive } from "./Layers/ClaudeProvider.ts";
import { makeCodexAdapterLive } from "./Layers/CodexAdapter.ts";
import { CodexProviderLive } from "./Layers/CodexProvider.ts";
import { makeCursorAdapterLive } from "./Layers/CursorAdapter.ts";
import { CursorProviderLive } from "./Layers/CursorProvider.ts";
import { makeOpenCodeAdapterLive } from "./Layers/OpenCodeAdapter.ts";
import { OpenCodeProviderLive } from "./Layers/OpenCodeProvider.ts";
import { ProviderEventLoggers } from "./Layers/ProviderEventLoggers.ts";
import type { ProviderAdapterShape } from "./Services/ProviderAdapter.ts";
import type { ServerProviderShape } from "./Services/ServerProvider.ts";
import { TextGeneration } from "../git/Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "../git/Layers/CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "../git/Layers/ClaudeTextGeneration.ts";
import { CursorTextGenerationLive } from "../git/Layers/CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "../git/Layers/OpenCodeTextGeneration.ts";

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const OPENCODE_DRIVER = ProviderDriverKind.make("opencode");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");

const makeLayerScopedService = (tag, layer, settings: ServerSettingsShape) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      layer.pipe(Layer.provide(Layer.succeed(ServerSettingsService, settings))),
    );
    return yield* Effect.service(tag).pipe(Effect.provide(context));
  });

const stampProviderSnapshot = (input: {
  readonly snapshot: ServerProvider;
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly enabled: boolean;
  readonly fallbackDisplayName: string;
}): ServerProvider => ({
  ...input.snapshot,
  instanceId: input.instanceId,
  driver: input.driverKind,
  displayName: input.displayName ?? input.snapshot.displayName ?? input.fallbackDisplayName,
  ...(input.accentColor ? { accentColor: input.accentColor } : {}),
  enabled: input.enabled,
  availability: "available",
});

const stampSnapshotShape = (input: {
  readonly shape: ServerProviderShape;
  readonly driverKind: ProviderDriverKind;
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly enabled: boolean;
  readonly fallbackDisplayName: string;
}): ServerProviderShape => ({
  getSnapshot: input.shape.getSnapshot.pipe(
    Effect.map((snapshot) => stampProviderSnapshot({ ...input, snapshot })),
  ),
  refresh: input.shape.refresh.pipe(
    Effect.map((snapshot) => stampProviderSnapshot({ ...input, snapshot })),
  ),
  get streamChanges() {
    return input.shape.streamChanges.pipe(
      Stream.map((snapshot) => stampProviderSnapshot({ ...input, snapshot })),
    );
  },
});

const stampSession = (
  session: ProviderSession,
  instanceId: ProviderInstanceId,
): ProviderSession => ({
  ...session,
  providerInstanceId: session.providerInstanceId ?? instanceId,
});

const stampEvent = (
  event: ProviderRuntimeEvent,
  instanceId: ProviderInstanceId,
): ProviderRuntimeEvent => ({
  ...event,
  providerInstanceId: event.providerInstanceId ?? instanceId,
});

const stampAdapterShape = (
  adapter: ProviderAdapterShape<unknown>,
  instanceId: ProviderInstanceId,
): ProviderAdapterShape<unknown> => ({
  ...adapter,
  startSession: (input) =>
    adapter
      .startSession({ ...input, providerInstanceId: instanceId })
      .pipe(Effect.map((session) => stampSession(session, instanceId))),
  listSessions: () =>
    adapter
      .listSessions()
      .pipe(Effect.map((sessions) => sessions.map((session) => stampSession(session, instanceId)))),
  get streamEvents() {
    return adapter.streamEvents.pipe(Stream.map((event) => stampEvent(event, instanceId)));
  },
});

const makeDriver = <Config>(input: {
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly configSchema: typeof CodexSettings;
  readonly defaultConfig: () => Config;
  readonly adapterTag: unknown;
  readonly adapterLayer: (nativeEventLogger?: unknown) => Layer.Layer<unknown, unknown, unknown>;
  readonly providerTag: unknown;
  readonly providerLayer: Layer.Layer<unknown, unknown, unknown>;
  readonly textGenerationLayer: Layer.Layer<unknown, unknown, unknown>;
}): ProviderDriver<Config, BuiltInDriversEnv> => ({
  driverKind: input.driverKind,
  metadata: {
    displayName: input.displayName,
    supportsMultipleInstances: true,
  },
  configSchema: input.configSchema,
  defaultConfig: input.defaultConfig,
  create: ({ instanceId, displayName, accentColor, environment, enabled, config, rawConfig }) =>
    Effect.gen(function* () {
      const provider = asBuiltInProviderKind(input.driverKind);
      if (!provider) {
        return yield* new ProviderDriverError({
          driver: input.driverKind,
          instanceId,
          detail: "Only built-in Cozea providers can be materialized by this driver.",
        });
      }

      const upstreamSettings = yield* ServerSettingsService;
      const scopedSettings = makeProviderInstanceScopedSettings({
        upstream: upstreamSettings,
        driverKind: input.driverKind,
        provider,
        instanceId,
        environment,
        config: config as Record<string, unknown>,
        enabled,
      });
      const eventLoggers = yield* ProviderEventLoggers;
      const adapter = yield* makeLayerScopedService(
        input.adapterTag,
        input.adapterLayer(eventLoggers.native),
        scopedSettings,
      );
      const snapshot = yield* makeLayerScopedService(
        input.providerTag,
        input.providerLayer,
        scopedSettings,
      );
      const textGeneration = yield* makeLayerScopedService(
        TextGeneration,
        input.textGenerationLayer,
        scopedSettings,
      );

      return {
        instanceId,
        driverKind: input.driverKind,
        displayName,
        ...(accentColor ? { accentColor } : {}),
        enabled,
        config: rawConfig,
        adapter: stampAdapterShape(adapter, instanceId),
        textGeneration,
        snapshot: stampSnapshotShape({
          shape: snapshot,
          driverKind: input.driverKind,
          instanceId,
          displayName,
          accentColor,
          enabled,
          fallbackDisplayName: input.displayName,
        }),
      } satisfies ProviderInstance;
    }),
});

export type BuiltInDriversEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | ServerConfig
  | ServerSettingsService
  | ProviderEventLoggers;

export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  makeDriver({
    driverKind: CODEX_DRIVER,
    displayName: "Codex",
    configSchema: CodexSettings,
    defaultConfig: () => Schema.decodeSync(CodexSettings)({}),
    adapterTag: CodexAdapter,
    adapterLayer: (nativeEventLogger) =>
      makeCodexAdapterLive(nativeEventLogger ? { nativeEventLogger } : undefined),
    providerTag: CodexProvider,
    providerLayer: CodexProviderLive,
    textGenerationLayer: CodexTextGenerationLive,
  }),
  makeDriver({
    driverKind: CLAUDE_DRIVER,
    displayName: "Claude",
    configSchema: ClaudeSettings,
    defaultConfig: () => Schema.decodeSync(ClaudeSettings)({}),
    adapterTag: ClaudeAdapter,
    adapterLayer: (nativeEventLogger) =>
      makeClaudeAdapterLive(nativeEventLogger ? { nativeEventLogger } : undefined),
    providerTag: ClaudeProvider,
    providerLayer: ClaudeProviderLive,
    textGenerationLayer: ClaudeTextGenerationLive,
  }),
  makeDriver({
    driverKind: OPENCODE_DRIVER,
    displayName: "OpenCode",
    configSchema: OpenCodeSettings,
    defaultConfig: () => Schema.decodeSync(OpenCodeSettings)({}),
    adapterTag: OpenCodeAdapter,
    adapterLayer: (nativeEventLogger) =>
      makeOpenCodeAdapterLive(nativeEventLogger ? { nativeEventLogger } : undefined),
    providerTag: OpenCodeProvider,
    providerLayer: OpenCodeProviderLive,
    textGenerationLayer: OpenCodeTextGenerationLive,
  }),
  makeDriver({
    driverKind: CURSOR_DRIVER,
    displayName: "Cursor",
    configSchema: CursorSettings,
    defaultConfig: () => Schema.decodeSync(CursorSettings)({}),
    adapterTag: CursorAdapter,
    adapterLayer: (nativeEventLogger) =>
      makeCursorAdapterLive(nativeEventLogger ? { nativeEventLogger } : undefined),
    providerTag: CursorProvider,
    providerLayer: CursorProviderLive,
    textGenerationLayer: CursorTextGenerationLive,
  }),
];
