import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_OBS_NDJSON_FLAG,
  SUBSTRATE_PRIMARY_FLAG,
  SUBSTRATE_PROVIDERS_FLAG,
  SUBSTRATE_RPC_CHAT_FLAG,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_T3_SERVER_FLAG,
  SUBSTRATE_VCS_FLAG,
} from "./constants";

export function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || value <= 0 || value > 65535) {
    return fallback;
  }
  return value;
}

export interface SubstrateShadowServerFlags {
  readonly flagId: typeof SUBSTRATE_SHADOW_SERVER_FLAG;
  /** When true, Electron spawns the shadow server beside the in-process assistant runtime. */
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
}

/**
 * Phase 1 flag — default **on**.
 * Disable with `COZEA_SUBSTRATE_SHADOW_SERVER=0`.
 * Optional: `COZEA_SUBSTRATE_SHADOW_HOST`, `COZEA_SUBSTRATE_SHADOW_PORT`.
 */
export function readSubstrateShadowServerFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateShadowServerFlags {
  return {
    flagId: SUBSTRATE_SHADOW_SERVER_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_SHADOW_SERVER, true),
    host: env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || DEFAULT_SUBSTRATE_SHADOW_HOST,
    port: parsePort(env.COZEA_SUBSTRATE_SHADOW_PORT, DEFAULT_SUBSTRATE_SHADOW_PORT),
  };
}

export interface SubstrateRpcChatFlags {
  readonly flagId: typeof SUBSTRATE_RPC_CHAT_FLAG;
  /** When true (and shadow server enabled), expose `/rpc` chat WS on the shadow server. */
  readonly enabled: boolean;
}

/**
 * Phase 2 flag — default **on**.
 * Disable with `COZEA_SUBSTRATE_RPC_CHAT=0`.
 * Requires shadow server for the workbench path.
 */
export function readSubstrateRpcChatFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateRpcChatFlags {
  return {
    flagId: SUBSTRATE_RPC_CHAT_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_RPC_CHAT, true),
  };
}

export interface SubstrateProvidersFlags {
  readonly flagId: typeof SUBSTRATE_PROVIDERS_FLAG;
  /**
   * When true, the substrate ProviderDriver registry + managed snapshot
   * lifecycle is available. Default product chat still uses the in-process
   * assistant-runtime providers until a later cutover phase.
   */
  readonly enabled: boolean;
}

/**
 * Phase 3 flag — default **on**.
 * Disable with `COZEA_SUBSTRATE_PROVIDERS=0`.
 */
export function readSubstrateProvidersFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateProvidersFlags {
  return {
    flagId: SUBSTRATE_PROVIDERS_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_PROVIDERS, true),
  };
}

export interface SubstrateVcsFlags {
  readonly flagId: typeof SUBSTRATE_VCS_FLAG;
  /**
   * When true, agent/overlay VCS should prefer the `VcsDriver` adapter path
   * (status invalidate, push-safety, checkpoint facade).
   */
  readonly enabled: boolean;
}

/**
 * Phase 4 flag — default **on**.
 * Disable with `COZEA_SUBSTRATE_VCS=0`.
 */
export function readSubstrateVcsFlags(env: NodeJS.ProcessEnv = process.env): SubstrateVcsFlags {
  return {
    flagId: SUBSTRATE_VCS_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_VCS, true),
  };
}

/** Convenience: whether the Phase 4 VcsDriver path is enabled. */
export function isSubstrateVcsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readSubstrateVcsFlags(env).enabled;
}

export interface SubstratePrimaryFlags {
  readonly flagId: typeof SUBSTRATE_PRIMARY_FLAG;
  /**
   * When true with shadow server, prefer out-of-process substrate and skip
   * starting the in-process assistant runtime.
   */
  readonly enabled: boolean;
}

/**
 * Phase 5 flag — default **on**.
 * Disable with `COZEA_SUBSTRATE_PRIMARY=0`.
 */
export function readSubstratePrimaryFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstratePrimaryFlags {
  return {
    flagId: SUBSTRATE_PRIMARY_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_PRIMARY, true),
  };
}

export interface SubstrateObsNdjsonFlags {
  readonly flagId: typeof SUBSTRATE_OBS_NDJSON_FLAG;
  readonly enabled: boolean;
}

export interface SubstrateT3ServerFlags {
  readonly flagId: typeof SUBSTRATE_T3_SERVER_FLAG;
  /** When true, shadow child also boots vendored T3 apps/server for orchestration RPC. */
  readonly enabled: boolean;
}

/**
 * Phase 6 / Track E flag — default **on**.
 * Disable with `COZEA_OBS_NDJSON=0` or `COZEA_SUBSTRATE_OBS_NDJSON=0`.
 */
export function readSubstrateObsNdjsonFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateObsNdjsonFlags {
  return {
    flagId: SUBSTRATE_OBS_NDJSON_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_OBS_NDJSON ?? env.COZEA_OBS_NDJSON, true),
  };
}

/**
 * Phase T1 flag — default **off**.
 * Enable with `COZEA_T3_SERVER=1`.
 */
export function readSubstrateT3ServerFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateT3ServerFlags {
  return {
    flagId: SUBSTRATE_T3_SERVER_FLAG,
    enabled: parseBooleanFlag(env.COZEA_T3_SERVER, false),
  };
}

export interface SubstrateFeatureFlags {
  readonly shadowServer: SubstrateShadowServerFlags;
  readonly rpcChat: boolean;
  readonly providers: boolean;
  readonly vcs: boolean;
  readonly primary: boolean;
  readonly obsNdjson: boolean;
  readonly t3Server: boolean;
}

/**
 * Full substrate flag bundle (Phases 1–6). All default **on**.
 */
export function readSubstrateFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateFeatureFlags {
  const shadowServer = readSubstrateShadowServerFlags(env);
  return {
    shadowServer,
    rpcChat: readSubstrateRpcChatFlags(env).enabled,
    providers: readSubstrateProvidersFlags(env).enabled,
    vcs: readSubstrateVcsFlags(env).enabled,
    primary: readSubstratePrimaryFlags(env).enabled,
    obsNdjson: readSubstrateObsNdjsonFlags(env).enabled,
    t3Server: readSubstrateT3ServerFlags(env).enabled,
  };
}

export function shouldStartInProcessAssistantRuntime(
  flags: SubstrateFeatureFlags = readSubstrateFeatureFlags(),
): boolean {
  // Phase 5: primary mode requires shadow server and skips in-process runtime.
  if (flags.primary && flags.shadowServer.enabled) {
    return false;
  }
  return true;
}

export {
  SUBSTRATE_OBS_NDJSON_FLAG,
  SUBSTRATE_PRIMARY_FLAG,
  SUBSTRATE_PROVIDERS_FLAG,
  SUBSTRATE_RPC_CHAT_FLAG,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_T3_SERVER_FLAG,
  SUBSTRATE_VCS_FLAG,
};
