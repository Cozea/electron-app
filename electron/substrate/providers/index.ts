export { SUBSTRATE_PROVIDERS_FLAG } from "../constants";
export { readSubstrateProvidersFlags, type SubstrateProvidersFlags } from "../flags";

export {
  MANAGED_SNAPSHOT_TRANSITIONS,
  assertManagedSnapshotTransition,
  beginManagedSnapshotRefresh,
  canTransitionManagedSnapshot,
  createManagedSnapshotState,
  createPendingSnapshot,
  isTerminalManagedSnapshotPhase,
  runManagedSnapshotPipeline,
  transitionManagedSnapshot,
  type ManagedSnapshotEnrichers,
  type SnapshotEnrichmentPatch,
} from "./managedSnapshot";

export {
  SubstrateProviderDriverRegistry,
  SubstrateProviderRegistryError,
} from "./registry";

export {
  bootstrapSubstrateProviderRegistry,
  type BootstrapSubstrateProvidersOptions,
} from "./bootstrap";

export {
  createOpenCodeSubstrateDriver,
  defaultOpenCodeDriverHooks,
  type OpenCodeDriverHooks,
  type OpenCodeInventoryResult,
  type OpenCodeProbeResult,
} from "./drivers/opencodeDriver";

export {
  LEGACY_ADAPTER_DRIVERS,
  claudeLegacyAdapterDriver,
  codexLegacyAdapterDriver,
  cursorLegacyAdapterDriver,
} from "./drivers/legacyAdapters";

export type {
  ManagedSnapshotPhase,
  ManagedSnapshotState,
  SubstrateDriverCreateInput,
  SubstrateDriverKind,
  SubstrateDriverMetadata,
  SubstrateInstanceId,
  SubstrateManagedSnapshotHandle,
  SubstrateProviderAuth,
  SubstrateProviderDriver,
  SubstrateProviderInstance,
  SubstrateProviderModel,
  SubstrateProviderRegistryStatus,
  SubstrateProviderSkill,
  SubstrateProviderSlashCommand,
  SubstrateProviderSnapshot,
} from "./types";
