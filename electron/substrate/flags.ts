import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_OBS_NDJSON_FLAG,
  SUBSTRATE_PRIMARY_FLAG,
  SUBSTRATE_PROVIDERS_FLAG,
  SUBSTRATE_RPC_CHAT_FLAG,
  SUBSTRATE_SHADOW_SERVER_FLAG,
  SUBSTRATE_VCS_FLAG,
} from "./constants";

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
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
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
}

export interface SubstrateFeatureFlags {
  readonly shadowServer: SubstrateShadowServerFlags;
  /** Phase 2 — Effect RPC / contracts chat path. */
  readonly rpcChat: boolean;
  /** Phase 3 — provider driver registry path. */
  readonly providers: boolean;
  /** Phase 4 — VcsDriver path. */
  readonly vcs: boolean;
  /**
   * Phase 5 — when true with shadowServer, prefer out-of-process substrate and
   * skip starting the in-process assistant runtime.
   */
  readonly primary: boolean;
  /** Phase 6 / Track E — NDJSON spans. */
  readonly obsNdjson: boolean;
}

/**
 * Phase 1 flag — default **off**.
 * Enable with `COZEA_SUBSTRATE_SHADOW_SERVER=1`.
 */
export function readSubstrateShadowServerFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateShadowServerFlags {
  return {
    flagId: SUBSTRATE_SHADOW_SERVER_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_SHADOW_SERVER, false),
    host: env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || DEFAULT_SUBSTRATE_SHADOW_HOST,
    port: parsePort(env.COZEA_SUBSTRATE_SHADOW_PORT, DEFAULT_SUBSTRATE_SHADOW_PORT),
  };
}

/**
 * Full substrate flag bundle (Phases 1–6). All default **off**.
 *
 * | Flag | Env |
 * | --- | --- |
 * | shadowServer | `COZEA_SUBSTRATE_SHADOW_SERVER` |
 * | rpcChat | `COZEA_SUBSTRATE_RPC_CHAT` |
 * | providers | `COZEA_SUBSTRATE_PROVIDERS` |
 * | vcs | `COZEA_SUBSTRATE_VCS` |
 * | primary | `COZEA_SUBSTRATE_PRIMARY` |
 * | obsNdjson | `COZEA_OBS_NDJSON` / `COZEA_SUBSTRATE_OBS_NDJSON` |
 */
export function readSubstrateFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateFeatureFlags {
  const shadowServer = readSubstrateShadowServerFlags(env);
  return {
    shadowServer,
    rpcChat: parseBooleanFlag(env.COZEA_SUBSTRATE_RPC_CHAT, false),
    providers: parseBooleanFlag(env.COZEA_SUBSTRATE_PROVIDERS, false),
    vcs: parseBooleanFlag(env.COZEA_SUBSTRATE_VCS, false),
    primary: parseBooleanFlag(env.COZEA_SUBSTRATE_PRIMARY, false),
    obsNdjson: parseBooleanFlag(
      env.COZEA_SUBSTRATE_OBS_NDJSON ?? env.COZEA_OBS_NDJSON,
      false,
    ),
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
  SUBSTRATE_VCS_FLAG,
};
