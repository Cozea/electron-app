import { readSubstrateProvidersFlags } from "../flags";
import { createCodexSubstrateDriver, type CodexDriverHooks } from "./drivers/codexDriver";
import { createClaudeSubstrateDriver } from "./drivers/claudeDriver";
import { createCursorSubstrateDriver } from "./drivers/cursorDriver";
import {
  createOpenCodeSubstrateDriver,
  type OpenCodeDriverHooks,
} from "./drivers/opencodeDriver";
import { codexLegacyAdapterDriver } from "./drivers/legacyAdapters";
import { SubstrateProviderDriverRegistry } from "./registry";
import type { SubstrateProviderDriver } from "./types";

export interface BootstrapSubstrateProvidersOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Override OpenCode hooks (tests / future live probe wiring). */
  readonly openCodeHooks?: OpenCodeDriverHooks;
  /** Override Codex hooks (tests / future live app-server probe wiring). */
  readonly codexHooks?: CodexDriverHooks;
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
  registry.register(createCodexSubstrateDriver(options.codexHooks));
  registry.register(createClaudeSubstrateDriver());
  registry.register(createCursorSubstrateDriver());
  // Codex legacy adapter retained only for opt-out / tests — primary path uses full driver.
  if (options.env?.COZEA_SUBSTRATE_CODEX_LEGACY_ADAPTER === "1") {
    registry.register(codexLegacyAdapterDriver);
  }
  for (const driver of options.extraDrivers ?? []) {
    registry.register(driver);
  }

  return registry;
}
