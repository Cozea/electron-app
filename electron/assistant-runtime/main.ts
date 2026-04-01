// @ts-nocheck
/**
 * CliConfig - CLI/runtime bootstrap service definitions.
 *
 * Defines startup-only service contracts used while resolving process config
 * and constructing server runtime layers.
 *
 * @module CliConfig
 */
import { Data, Effect, FileSystem, Layer, Option, Path, Schema, ServiceMap } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { NetService } from "@cozea/assistant-shared/Net";
import {
  DEFAULT_PORT,
  deriveServerPaths,
  resolveStaticDir,
  ServerConfig,
  type RuntimeMode,
  type ServerConfigShape,
} from "./config";
import { fixPath, resolveBaseDir } from "./os-jank";
import { Open } from "./open";
import * as SqlitePersistence from "./persistence/Layers/Sqlite";
import { makeServerProviderLayer, makeServerRuntimeServicesLayer } from "./serverLayers";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery";
import { ProviderRegistryLive } from "./provider/Layers/ProviderRegistry";
import { Server } from "./wsServer";
import { ServerLoggerLive } from "./serverLogger";
import { AnalyticsServiceLayerLive } from "./telemetry/Layers/AnalyticsService";
import { AnalyticsService } from "./telemetry/Services/AnalyticsService";
import { readBootstrapEnvelope } from "./bootstrap";
import { ServerSettingsLive } from "./serverSettings";

export class StartupError extends Data.TaggedError("StartupError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const PortSchema = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 }));

const BootstrapEnvelopeSchema = Schema.Struct({
  mode: Schema.optional(Schema.String),
  port: Schema.optional(PortSchema),
  host: Schema.optional(Schema.String),
  assistantHome: Schema.optional(Schema.String),
  devUrl: Schema.optional(Schema.URLFromString),
  noBrowser: Schema.optional(Schema.Boolean),
  authToken: Schema.optional(Schema.String),
  autoBootstrapProjectFromCwd: Schema.optional(Schema.Boolean),
  logWebSocketEvents: Schema.optional(Schema.Boolean),
});

interface CliInput {
  readonly mode: Option.Option<RuntimeMode>;
  readonly port: Option.Option<number>;
  readonly host: Option.Option<string>;
  readonly assistantHome: Option.Option<string>;
  readonly devUrl: Option.Option<URL>;
  readonly noBrowser: Option.Option<boolean>;
  readonly authToken: Option.Option<string>;
  readonly bootstrapFd: Option.Option<number>;
  readonly autoBootstrapProjectFromCwd: Option.Option<boolean>;
  readonly logWebSocketEvents: Option.Option<boolean>;
}

/**
 * CliConfigShape - Startup helpers required while building server layers.
 */
export interface CliConfigShape {
  /**
   * Current process working directory.
   */
  readonly cwd: string;

  /**
   * Apply OS-specific PATH normalization.
   */
  readonly fixPath: Effect.Effect<void>;

  /**
   * Resolve static web asset directory for server mode.
   */
  readonly resolveStaticDir: Effect.Effect<string | undefined>;
}

/**
 * CliConfig - Service tag for startup CLI/runtime helpers.
 */
export class CliConfig extends ServiceMap.Service<CliConfig, CliConfigShape>()(
  "cozea/assistant-runtime/main/CliConfig",
) {
  static readonly layer = Layer.effect(
    CliConfig,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      return {
        cwd: process.cwd(),
        fixPath: Effect.sync(fixPath),
        resolveStaticDir: resolveStaticDir().pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
        ),
      } satisfies CliConfigShape;
    }),
  );
}

interface ResolvedCliEnvConfig {
  readonly mode: RuntimeMode | undefined
  readonly port: number | undefined
  readonly host: string | undefined
  readonly assistantHome: string | undefined
  readonly devUrl: URL | undefined
  readonly noBrowser: boolean | undefined
  readonly authToken: string | undefined
  readonly bootstrapFd: number | undefined
  readonly autoBootstrapProjectFromCwd: boolean | undefined
  readonly logWebSocketEvents: boolean | undefined
}

const firstDefinedEnv = (...names: ReadonlyArray<string>): string | undefined => {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }
  return undefined
}

const parseBooleanEnv = (...names: ReadonlyArray<string>): boolean | undefined => {
  const raw = firstDefinedEnv(...names)
  if (raw === undefined) return undefined
  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true
    case "0":
    case "false":
    case "no":
    case "off":
      return false
    default:
      return undefined
  }
}

const parseIntegerEnv = (...names: ReadonlyArray<string>): number | undefined => {
  const raw = firstDefinedEnv(...names)
  if (raw === undefined) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parsePortEnv = (...names: ReadonlyArray<string>): number | undefined => {
  const parsed = parseIntegerEnv(...names)
  return parsed !== undefined && isValidPort(parsed) ? parsed : undefined
}

const parseUrlEnv = (...names: ReadonlyArray<string>): URL | undefined => {
  const raw = firstDefinedEnv(...names)
  if (raw === undefined) return undefined
  try {
    return new URL(raw)
  } catch {
    return undefined
  }
}

const readCliEnvConfig = (): ResolvedCliEnvConfig => {
  const mode = firstDefinedEnv("COZEA_ASSISTANT_MODE")
  return {
    mode: mode === "desktop" ? "desktop" : mode === "web" ? "web" : undefined,
    port: parsePortEnv("COZEA_ASSISTANT_PORT"),
    host: firstDefinedEnv("COZEA_ASSISTANT_HOST"),
    assistantHome: firstDefinedEnv("COZEA_ASSISTANT_HOME"),
    devUrl: parseUrlEnv("VITE_DEV_SERVER_URL"),
    noBrowser: parseBooleanEnv("COZEA_ASSISTANT_NO_BROWSER"),
    authToken: firstDefinedEnv("COZEA_ASSISTANT_AUTH_TOKEN"),
    bootstrapFd: parseIntegerEnv("COZEA_ASSISTANT_BOOTSTRAP_FD"),
    autoBootstrapProjectFromCwd: parseBooleanEnv("COZEA_ASSISTANT_AUTO_BOOTSTRAP_PROJECT_FROM_CWD"),
    logWebSocketEvents: parseBooleanEnv("COZEA_ASSISTANT_LOG_WS_EVENTS"),
  }
}

const resolveBooleanFlag = (flag: Option.Option<boolean>, envValue: boolean) =>
  Option.getOrElse(Option.filter(flag, Boolean), () => envValue);

const resolveOptionPrecedence = <Value>(
  ...values: ReadonlyArray<Option.Option<Value>>
): Option.Option<Value> => Option.firstSomeOf(values);

const isValidPort = (value: number): boolean => value >= 1 && value <= 65_535;
const isRuntimeMode = (value: string): value is RuntimeMode =>
  value === "web" || value === "desktop";

const ServerConfigLive = (input: CliInput) =>
  Layer.effect(
    ServerConfig,
    Effect.gen(function* () {
      const cliConfig = yield* CliConfig;
      const { findAvailablePort } = yield* NetService;
      const env = readCliEnvConfig()

      const bootstrapFd = Option.getOrUndefined(input.bootstrapFd) ?? env.bootstrapFd;
      const bootstrapEnvelope =
        bootstrapFd !== undefined
          ? yield* readBootstrapEnvelope(BootstrapEnvelopeSchema, bootstrapFd)
          : Option.none();

      const mode: RuntimeMode = Option.getOrElse(
        resolveOptionPrecedence(
          input.mode,
          Option.fromUndefinedOr(env.mode),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.filter(Option.fromUndefinedOr(bootstrap.mode), isRuntimeMode),
          ),
        ),
        () => "web",
      );
      const port = yield* Option.match(
        resolveOptionPrecedence(
          input.port,
          Option.fromUndefinedOr(env.port),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.filter(Option.fromUndefinedOr(bootstrap.port), isValidPort),
          ),
        ),
        {
          onSome: (value) => Effect.succeed(value),
          onNone: () => {
            if (mode === "desktop") {
              return Effect.succeed(DEFAULT_PORT);
            }
            return findAvailablePort(DEFAULT_PORT);
          },
        },
      );

      const devUrl = Option.getOrElse(
        resolveOptionPrecedence(
          input.devUrl,
          Option.fromUndefinedOr(env.devUrl),
          Option.flatMap(bootstrapEnvelope, (bootstrap) =>
            Option.fromUndefinedOr(bootstrap.devUrl),
          ),
        ),
        () => undefined,
      );
      const baseDir = yield* resolveBaseDir(
        Option.getOrUndefined(
          resolveOptionPrecedence(
            input.assistantHome,
            Option.fromUndefinedOr(env.assistantHome),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.assistantHome),
            ),
          ),
        ),
      );
      const derivedPaths = yield* deriveServerPaths(baseDir, devUrl);
      const noBrowser = resolveBooleanFlag(
        input.noBrowser,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.noBrowser),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.noBrowser),
            ),
          ),
          () => mode === "desktop",
        ),
      );
      const authToken = resolveOptionPrecedence(
        input.authToken,
        Option.fromUndefinedOr(env.authToken),
        Option.flatMap(bootstrapEnvelope, (bootstrap) =>
          Option.fromUndefinedOr(bootstrap.authToken),
        ),
      );
      const autoBootstrapProjectFromCwd = resolveBooleanFlag(
        input.autoBootstrapProjectFromCwd,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.autoBootstrapProjectFromCwd),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.autoBootstrapProjectFromCwd),
            ),
          ),
          () => mode === "web",
        ),
      );
      const logWebSocketEvents = resolveBooleanFlag(
        input.logWebSocketEvents,
        Option.getOrElse(
          resolveOptionPrecedence(
            Option.fromUndefinedOr(env.logWebSocketEvents),
            Option.flatMap(bootstrapEnvelope, (bootstrap) =>
              Option.fromUndefinedOr(bootstrap.logWebSocketEvents),
            ),
          ),
          () => Boolean(devUrl),
        ),
      );
      const staticDir = devUrl ? undefined : yield* cliConfig.resolveStaticDir;
      const host = Option.getOrElse(
        resolveOptionPrecedence(
          input.host,
          Option.fromUndefinedOr(env.host),
          Option.flatMap(bootstrapEnvelope, (bootstrap) => Option.fromUndefinedOr(bootstrap.host)),
        ),
        () => (mode === "desktop" ? "127.0.0.1" : undefined),
      );

      const config: ServerConfigShape = {
        mode,
        port,
        cwd: cliConfig.cwd,
        host,
        baseDir,
        ...derivedPaths,
        staticDir,
        devUrl,
        noBrowser,
        authToken: Option.getOrUndefined(authToken),
        autoBootstrapProjectFromCwd,
        logWebSocketEvents,
      } satisfies ServerConfigShape;

      return config;
    }),
  );

const LayerLive = (input: CliInput) =>
  Layer.empty.pipe(
    Layer.provideMerge(makeServerRuntimeServicesLayer()),
    Layer.provideMerge(makeServerProviderLayer()),
    Layer.provideMerge(ProviderRegistryLive),
    Layer.provideMerge(SqlitePersistence.layerConfig),
    Layer.provideMerge(ServerLoggerLive),
    Layer.provideMerge(AnalyticsServiceLayerLive),
    Layer.provideMerge(ServerSettingsLive),
    Layer.provideMerge(ServerConfigLive(input)),
  );

const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

export const recordStartupHeartbeat = Effect.gen(function* () {
  const analytics = yield* AnalyticsService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const { threadCount, projectCount } = yield* projectionSnapshotQuery.getSnapshot().pipe(
    Effect.map((snapshot) => ({
      threadCount: snapshot.threads.length,
      projectCount: snapshot.projects.length,
    })),
    Effect.catch((cause) =>
      Effect.logWarning("failed to gather startup snapshot for telemetry", { cause }).pipe(
        Effect.as({
          threadCount: 0,
          projectCount: 0,
        }),
      ),
    ),
  );

  yield* analytics.record("server.boot.heartbeat", {
    threadCount,
    projectCount,
  });
});

export const makeServerRuntimeProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const { start, stopSignal } = yield* Server;
    const openDeps = yield* Open;

    const config = yield* ServerConfig;

    if (!config.devUrl && !config.staticDir) {
      yield* Effect.logWarning(
        "web bundle missing and no VITE_DEV_SERVER_URL; web UI unavailable",
        {
          hint: "Run `bun run --cwd apps/web build` or set VITE_DEV_SERVER_URL for dev mode.",
        },
      );
    }

    yield* start;
    yield* Effect.forkChild(recordStartupHeartbeat);

    const localUrl = `http://localhost:${config.port}`;
    const bindUrl =
      config.host && !isWildcardHost(config.host)
        ? `http://${formatHostForUrl(config.host)}:${config.port}`
        : localUrl;
    const { authToken, devUrl, ...safeConfig } = config;
    yield* Effect.logInfo("Cozea assistant runtime running", {
      ...safeConfig,
      devUrl: devUrl?.toString(),
      authEnabled: Boolean(authToken),
    });

    if (!config.noBrowser) {
      const target = config.devUrl?.toString() ?? bindUrl;
      yield* openDeps.openBrowser(target).pipe(
        Effect.catch(() =>
          Effect.logInfo("browser auto-open unavailable", {
            hint: `Open ${target} in your browser.`,
          }),
        ),
      );
    }

    return yield* stopSignal;
  }).pipe(Effect.provide(LayerLive(input)));

const makeServerProgram = (input: CliInput) =>
  Effect.gen(function* () {
    const cliConfig = yield* CliConfig;
    yield* cliConfig.fixPath;
    return yield* makeServerRuntimeProgram(input);
  });

/**
 * These flags mirrors the environment variables and the config shape.
 */

const modeFlag = Flag.choice("mode", ["web", "desktop"]).pipe(
  Flag.withDescription("Runtime mode. `desktop` keeps loopback defaults unless overridden."),
  Flag.optional,
);
const portFlag = Flag.integer("port").pipe(
  Flag.withSchema(PortSchema),
  Flag.withDescription("Port for the HTTP/WebSocket server."),
  Flag.optional,
);
const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host/interface to bind (for example 127.0.0.1, 0.0.0.0, or a Tailnet IP)."),
  Flag.optional,
);
const assistantHomeFlag = Flag.string("home-dir").pipe(
  Flag.withDescription("Base directory for Cozea assistant runtime data."),
  Flag.optional,
);
const devUrlFlag = Flag.string("dev-url").pipe(
  Flag.withSchema(Schema.URLFromString),
  Flag.withDescription("Dev web URL to proxy/redirect to (equivalent to VITE_DEV_SERVER_URL)."),
  Flag.optional,
);
const noBrowserFlag = Flag.boolean("no-browser").pipe(
  Flag.withDescription("Disable automatic browser opening."),
  Flag.optional,
);
const authTokenFlag = Flag.string("auth-token").pipe(
  Flag.withDescription("Auth token required for WebSocket connections."),
  Flag.withAlias("token"),
  Flag.optional,
);
const bootstrapFdFlag = Flag.integer("bootstrap-fd").pipe(
  Flag.withSchema(Schema.Int),
  Flag.withDescription("Read one-time bootstrap secrets from the given file descriptor."),
  Flag.optional,
);
const autoBootstrapProjectFromCwdFlag = Flag.boolean("auto-bootstrap-project-from-cwd").pipe(
  Flag.withDescription(
    "Create a project for the current working directory on startup when missing.",
  ),
  Flag.optional,
);
const logWebSocketEventsFlag = Flag.boolean("log-websocket-events").pipe(
  Flag.withDescription(
    "Emit server-side logs for outbound WebSocket push traffic (equivalent to COZEA_ASSISTANT_LOG_WS_EVENTS).",
  ),
  Flag.withAlias("log-ws-events"),
  Flag.optional,
);

export const assistantRuntimeCli = Command.make("assistant-runtime", {
  mode: modeFlag,
  port: portFlag,
  host: hostFlag,
  assistantHome: assistantHomeFlag,
  devUrl: devUrlFlag,
  noBrowser: noBrowserFlag,
  authToken: authTokenFlag,
  bootstrapFd: bootstrapFdFlag,
  autoBootstrapProjectFromCwd: autoBootstrapProjectFromCwdFlag,
  logWebSocketEvents: logWebSocketEventsFlag,
}).pipe(
  Command.withDescription("Run the Cozea assistant runtime."),
  Command.withHandler((input) => Effect.scoped(makeServerProgram(input))),
);
