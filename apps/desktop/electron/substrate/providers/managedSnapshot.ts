import type {
  ManagedSnapshotPhase,
  ManagedSnapshotState,
  SubstrateDriverKind,
  SubstrateInstanceId,
  SubstrateProviderAuth,
  SubstrateProviderModel,
  SubstrateProviderSkill,
  SubstrateProviderSlashCommand,
  SubstrateProviderSnapshot,
} from "./types";

const TERMINAL_PHASES = new Set<ManagedSnapshotPhase>(["ready", "error", "unavailable"]);

/** Legal directed edges for the managed snapshot state machine. */
export const MANAGED_SNAPSHOT_TRANSITIONS: Readonly<
  Record<ManagedSnapshotPhase, ReadonlyArray<ManagedSnapshotPhase>>
> = {
  pending: ["probing", "unavailable", "error"],
  probing: [
    "enriching_capabilities",
    "enriching_skills",
    "enriching_slash",
    "enriching_account_models",
    "ready",
    "unavailable",
    "error",
  ],
  enriching_capabilities: [
    "enriching_skills",
    "enriching_slash",
    "enriching_account_models",
    "ready",
    "error",
  ],
  enriching_skills: ["enriching_slash", "enriching_account_models", "ready", "error"],
  enriching_slash: ["enriching_account_models", "ready", "error"],
  enriching_account_models: ["ready", "error"],
  ready: ["probing", "error"],
  error: ["pending", "probing"],
  unavailable: ["pending", "probing"],
};

export function canTransitionManagedSnapshot(
  from: ManagedSnapshotPhase,
  to: ManagedSnapshotPhase,
): boolean {
  return MANAGED_SNAPSHOT_TRANSITIONS[from].includes(to);
}

export function assertManagedSnapshotTransition(
  from: ManagedSnapshotPhase,
  to: ManagedSnapshotPhase,
): void {
  if (!canTransitionManagedSnapshot(from, to)) {
    throw new Error(`Invalid managed snapshot transition: ${from} → ${to}`);
  }
}

export function isTerminalManagedSnapshotPhase(phase: ManagedSnapshotPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export interface PendingSnapshotSeed {
  readonly driver: SubstrateDriverKind;
  readonly instanceId: SubstrateInstanceId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly checkedAt?: string;
}

export function createPendingSnapshot(seed: PendingSnapshotSeed): SubstrateProviderSnapshot {
  return {
    driver: seed.driver,
    instanceId: seed.instanceId,
    displayName: seed.displayName,
    enabled: seed.enabled,
    installed: false,
    version: null,
    status: seed.enabled ? "initializing" : "disabled",
    auth: { status: "unknown" },
    checkedAt: seed.checkedAt ?? new Date().toISOString(),
    models: [],
    skills: [],
    slashCommands: [],
    availability: seed.enabled ? "available" : "unavailable",
    unavailableReason: seed.enabled ? undefined : "Provider instance is disabled.",
    phase: seed.enabled ? "pending" : "unavailable",
  };
}

export function createManagedSnapshotState(
  snapshot: SubstrateProviderSnapshot,
  generation = 0,
): ManagedSnapshotState {
  return {
    phase: snapshot.phase,
    generation,
    snapshot,
    errorMessage: null,
  };
}

export interface SnapshotEnrichmentPatch {
  readonly installed?: boolean;
  readonly version?: string | null;
  readonly status?: SubstrateProviderSnapshot["status"];
  readonly auth?: SubstrateProviderAuth;
  readonly message?: string;
  readonly models?: ReadonlyArray<SubstrateProviderModel>;
  readonly skills?: ReadonlyArray<SubstrateProviderSkill>;
  readonly slashCommands?: ReadonlyArray<SubstrateProviderSlashCommand>;
  readonly availability?: SubstrateProviderSnapshot["availability"];
  readonly unavailableReason?: string;
  readonly checkedAt?: string;
}

export function transitionManagedSnapshot(
  state: ManagedSnapshotState,
  to: ManagedSnapshotPhase,
  patch: SnapshotEnrichmentPatch = {},
): ManagedSnapshotState {
  assertManagedSnapshotTransition(state.phase, to);

  const nextSnapshot: SubstrateProviderSnapshot = {
    ...state.snapshot,
    ...patch,
    phase: to,
    checkedAt: patch.checkedAt ?? new Date().toISOString(),
  };

  return {
    phase: to,
    generation: state.generation,
    snapshot: nextSnapshot,
    errorMessage:
      to === "error" ? (patch.message ?? state.errorMessage ?? "Provider snapshot failed") : null,
  };
}

export function beginManagedSnapshotRefresh(state: ManagedSnapshotState): ManagedSnapshotState {
  const pending = createPendingSnapshot({
    driver: state.snapshot.driver,
    instanceId: state.snapshot.instanceId,
    displayName: state.snapshot.displayName,
    enabled: state.snapshot.enabled,
  });
  return {
    phase: pending.phase,
    generation: state.generation + 1,
    snapshot: pending,
    errorMessage: null,
  };
}

export interface ManagedSnapshotEnrichers {
  readonly probe: () => Promise<SnapshotEnrichmentPatch>;
  readonly capabilities?: () => Promise<SnapshotEnrichmentPatch>;
  readonly skills?: () => Promise<SnapshotEnrichmentPatch>;
  readonly slash?: () => Promise<SnapshotEnrichmentPatch>;
  readonly accountModels?: () => Promise<SnapshotEnrichmentPatch>;
}

export async function runManagedSnapshotPipeline(
  initial: ManagedSnapshotState,
  enrichers: ManagedSnapshotEnrichers,
): Promise<ManagedSnapshotState> {
  if (!initial.snapshot.enabled) {
    if (initial.phase === "unavailable") {
      return initial;
    }
    return transitionManagedSnapshot(initial, "unavailable", {
      status: "disabled",
      availability: "unavailable",
      unavailableReason: "Provider instance is disabled.",
      message: "Provider instance is disabled.",
    });
  }

  let state = initial.phase === "pending" ? initial : beginManagedSnapshotRefresh(initial);
  const generation = state.generation;

  const stillCurrent = (candidate: ManagedSnapshotState): boolean =>
    candidate.generation === generation;

  try {
    state = transitionManagedSnapshot(state, "probing");
    const probePatch = await enrichers.probe();
    if (!stillCurrent(state)) {
      return state;
    }
    if (probePatch.availability === "unavailable" || probePatch.status === "error") {
      return transitionManagedSnapshot(
        state,
        probePatch.availability === "unavailable" ? "unavailable" : "error",
        probePatch,
      );
    }
    state = transitionManagedSnapshot(state, "enriching_capabilities", probePatch);

    const capPatch = (await enrichers.capabilities?.()) ?? {};
    if (!stillCurrent(state)) {
      return state;
    }
    state = transitionManagedSnapshot(state, "enriching_skills", capPatch);

    const skillsPatch = (await enrichers.skills?.()) ?? {};
    if (!stillCurrent(state)) {
      return state;
    }
    state = transitionManagedSnapshot(state, "enriching_slash", skillsPatch);

    const slashPatch = (await enrichers.slash?.()) ?? {};
    if (!stillCurrent(state)) {
      return state;
    }
    state = transitionManagedSnapshot(state, "enriching_account_models", slashPatch);

    const modelsPatch = (await enrichers.accountModels?.()) ?? {};
    if (!stillCurrent(state)) {
      return state;
    }
    return transitionManagedSnapshot(state, "ready", {
      ...modelsPatch,
      status: modelsPatch.status ?? "ready",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (canTransitionManagedSnapshot(state.phase, "error")) {
      return transitionManagedSnapshot(state, "error", { status: "error", message });
    }
    return {
      ...state,
      phase: "error",
      snapshot: { ...state.snapshot, phase: "error", status: "error", message },
      errorMessage: message,
    };
  }
}
