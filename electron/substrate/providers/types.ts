/**
 * Phase 3 substrate provider SPI — T3-shaped ProviderDriver + managed snapshots.
 *
 * Lives under `electron/substrate/providers/` (not the live assistant-runtime
 * provider spine) so the default product path stays unchanged until
 * `cozea.substrate.providers` is enabled and a later phase cuts over.
 */

/** Stable driver kind slug (matches Cozea/T3 built-ins). */
export type SubstrateDriverKind =
  | "opencode"
  | "cursor"
  | "claudeAgent"
  | "codex"
  | (string & {});

/** Routable instance id (often equals the driver kind for the default instance). */
export type SubstrateInstanceId = string;

/**
 * Managed snapshot lifecycle (T3: pending → enrich → capabilities / skills /
 * slash / account models).
 */
export type ManagedSnapshotPhase =
  | "pending"
  | "probing"
  | "enriching_capabilities"
  | "enriching_skills"
  | "enriching_slash"
  | "enriching_account_models"
  | "ready"
  | "error"
  | "unavailable";

export interface SubstrateProviderModel {
  readonly slug: string;
  readonly name: string;
  readonly isCustom?: boolean;
  readonly capabilities?: Readonly<Record<string, unknown>> | null;
}

export interface SubstrateProviderSkill {
  readonly name: string;
  readonly path: string;
  readonly description?: string;
  readonly enabled?: boolean;
}

export interface SubstrateProviderSlashCommand {
  readonly name: string;
  readonly description?: string;
}

export interface SubstrateProviderAuth {
  readonly status: "authenticated" | "unauthenticated" | "unknown";
  readonly type?: string;
}

/**
 * Snapshot payload published through the managed lifecycle.
 * Mirrors fields the picker/status UI needs from T3 ServerProvider.
 */
export interface SubstrateProviderSnapshot {
  readonly driver: SubstrateDriverKind;
  readonly instanceId: SubstrateInstanceId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: "initializing" | "ready" | "warning" | "error" | "disabled";
  readonly auth: SubstrateProviderAuth;
  readonly checkedAt: string;
  readonly message?: string;
  readonly models: ReadonlyArray<SubstrateProviderModel>;
  readonly skills: ReadonlyArray<SubstrateProviderSkill>;
  readonly slashCommands: ReadonlyArray<SubstrateProviderSlashCommand>;
  readonly availability: "available" | "unavailable";
  readonly unavailableReason?: string;
  /** Last completed enrichment step (for diagnostics). */
  readonly phase: ManagedSnapshotPhase;
}

export interface ManagedSnapshotState {
  readonly phase: ManagedSnapshotPhase;
  readonly generation: number;
  readonly snapshot: SubstrateProviderSnapshot;
  readonly errorMessage: string | null;
}

export interface SubstrateDriverMetadata {
  readonly displayName: string;
  readonly supportsMultipleInstances?: boolean;
  /**
   * `full` — implements the substrate managed-snapshot lifecycle itself.
   * `legacy-adapter` — registers through the registry but still delegates to
   * the existing assistant-runtime provider path for real work.
   */
  readonly implementation: "full" | "legacy-adapter";
}

export interface SubstrateDriverCreateInput {
  readonly instanceId: SubstrateInstanceId;
  readonly displayName?: string;
  readonly accentColor?: string;
  readonly enabled: boolean;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface SubstrateManagedSnapshotHandle {
  readonly getState: () => ManagedSnapshotState;
  /** Advance the lifecycle until ready/error (idempotent per generation). */
  readonly run: () => Promise<ManagedSnapshotState>;
  readonly refresh: () => Promise<ManagedSnapshotState>;
}

export interface SubstrateLiveTurnInput {
  readonly text: string;
  readonly threadId?: string;
  readonly cwd?: string;
  readonly model?: string;
}

export interface SubstrateLiveTurnResult {
  readonly turnId: string;
  readonly replyText: string;
  readonly status: "completed" | "failed" | "timeout";
  readonly error?: string;
}

export interface SubstrateLiveTurnHandle {
  readonly sendTurn: (input: SubstrateLiveTurnInput) => Promise<SubstrateLiveTurnResult>;
  readonly dispose: () => Promise<void>;
}

export interface SubstrateProviderInstance {
  readonly instanceId: SubstrateInstanceId;
  readonly driverKind: SubstrateDriverKind;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly implementation: SubstrateDriverMetadata["implementation"];
  readonly snapshot: SubstrateManagedSnapshotHandle;
  /** Optional live turn runtime (Codex app-server, etc.). */
  readonly live?: SubstrateLiveTurnHandle;
  /** Tear down any per-instance resources. */
  readonly dispose: () => Promise<void>;
}

/**
 * T3-shaped ProviderDriver — plain value SPI (not an Effect Context tag).
 */
export interface SubstrateProviderDriver {
  readonly driverKind: SubstrateDriverKind;
  readonly metadata: SubstrateDriverMetadata;
  readonly defaultConfig: () => Readonly<Record<string, unknown>>;
  readonly create: (input: SubstrateDriverCreateInput) => Promise<SubstrateProviderInstance>;
}

export interface SubstrateProviderRegistryStatus {
  readonly flagId: "cozea.substrate.providers";
  readonly enabled: boolean;
  readonly registeredDrivers: ReadonlyArray<{
    readonly driverKind: SubstrateDriverKind;
    readonly displayName: string;
    readonly implementation: SubstrateDriverMetadata["implementation"];
  }>;
  readonly liveInstances: ReadonlyArray<{
    readonly instanceId: SubstrateInstanceId;
    readonly driverKind: SubstrateDriverKind;
    readonly phase: ManagedSnapshotPhase;
  }>;
}
