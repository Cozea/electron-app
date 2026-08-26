import { readSubstrateProvidersFlags } from "../flags";
import {
  createOpenCodeSubstrateDriver,
  type OpenCodeDriverHooks,
} from "./drivers/opencodeDriver";
import { LEGACY_ADAPTER_DRIVERS } from "./drivers/legacyAdapters";
import { SubstrateProviderDriverRegistry } from "./registry";
import type { SubstrateProviderDriver } from "./types";

export interface BootstrapSubstrateProvidersOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override OpenCode hooks (tests / future live probe wiring). */
  readonly openCodeHooks?: OpenCodeDriverHooks;
  /** Extra drivers beyond the built-in OpenCode + legacy adapters. */
  readonly extraDrivers?: ReadonlyArray<SubstrateProviderDriver>;
  /**
   * When true, bootstrap even if the env flag is off (tests).
   * Production callers must leave this unset so the flag gates the path.
   */
  readonly forceEnable?: boolean;
}

/**
 * Build the Phase 3 substrate provider registry.
 *
 * Returns a disabled empty registry when `cozea.substrate.providers` is off,
 * so callers can always ask for status without flipping the live provider path.
 */
export function bootstrapSubstrateProviderRegistry(
  options: BootstrapSubstrateProvidersOptions = {},
): SubstrateProviderDriverRegistry {
  const flags = readSubstrateProvidersFlags(options.env);
  const enabled = options.forceEnable === true || flags.enabled;
  const registry = new SubstrateProviderDriverRegistry(enabled);

  if (!enabled) {
    return registry;
  }

  registry.register(createOpenCodeSubstrateDriver(options.openCodeHooks));
  for (const driver of LEGACY_ADAPTER_DRIVERS) {
    registry.register(driver);
  }
  for (const driver of options.extraDrivers ?? []) {
    registry.register(driver);
  }

  return registry;
}
