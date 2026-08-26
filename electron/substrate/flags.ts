import {
  DEFAULT_SUBSTRATE_SHADOW_HOST,
  DEFAULT_SUBSTRATE_SHADOW_PORT,
  SUBSTRATE_PROVIDERS_FLAG,
  SUBSTRATE_SHADOW_SERVER_FLAG,
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
 * Phase 1 flag — default **off**.
 * Enable with `COZEA_SUBSTRATE_SHADOW_SERVER=1`.
 * Optional: `COZEA_SUBSTRATE_SHADOW_HOST`, `COZEA_SUBSTRATE_SHADOW_PORT`.
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
 * Phase 3 flag — default **off**.
 * Enable with `COZEA_SUBSTRATE_PROVIDERS=1`.
 */
export function readSubstrateProvidersFlags(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateProvidersFlags {
  return {
    flagId: SUBSTRATE_PROVIDERS_FLAG,
    enabled: parseBooleanFlag(env.COZEA_SUBSTRATE_PROVIDERS, false),
  };
}
