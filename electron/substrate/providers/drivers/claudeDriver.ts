import {
  beginManagedSnapshotRefresh,
  createManagedSnapshotState,
  createPendingSnapshot,
  runManagedSnapshotPipeline,
  type ManagedSnapshotEnrichers,
  type SnapshotEnrichmentPatch,
} from "../managedSnapshot";
import type {
  ManagedSnapshotState,
  SubstrateDriverCreateInput,
  SubstrateLiveTurnInput,
  SubstrateLiveTurnResult,
  SubstrateManagedSnapshotHandle,
  SubstrateProviderDriver,
  SubstrateProviderInstance,
  SubstrateProviderModel,
} from "../types";
import { executeRpcBridgedChatTurn } from "../../../substrate-shadow-server/rpcOrchestrationChat";

const DEFAULT_CLAUDE_MODELS: ReadonlyArray<SubstrateProviderModel> = [
  { slug: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  { slug: "claude-opus-4-20250514", name: "Claude Opus 4" },
];

function createSnapshotHandle(initial: ManagedSnapshotState): SubstrateManagedSnapshotHandle {
  let state = initial;
  let inFlight: Promise<ManagedSnapshotState> | null = null;

  const runPipeline = async (): Promise<ManagedSnapshotState> => {
    if (inFlight) return inFlight;
    inFlight = runManagedSnapshotPipeline(state, {
      probe: async (): Promise<SnapshotEnrichmentPatch> => ({
        installed: true,
        version: "substrate-native",
        status: "ready",
        auth: { status: "unknown" },
        availability: "available",
        message: "Native substrate Claude driver (orchestration RPC).",
        models: DEFAULT_CLAUDE_MODELS,
      }),
      capabilities: async () => ({ supportsImages: true }),
      skills: async () => ({ skills: [] }),
      slash: async () => ({ slashCommands: [] }),
      accountModels: async () => ({ status: "ready" }),
    }).then((next) => {
      state = next;
      inFlight = null;
      return next;
    });
    return inFlight;
  };

  return {
    getState: () => state,
    run: () => runPipeline(),
    refresh: async () => {
      state = beginManagedSnapshotRefresh(state);
      return runPipeline();
    },
  };
}

/** Full substrate Claude driver — live turns via orchestration RPC. */
export function createClaudeSubstrateDriver(): SubstrateProviderDriver {
  return {
    driverKind: "claudeAgent",
    metadata: {
      displayName: "Claude",
      supportsMultipleInstances: true,
      implementation: "full",
    },
    defaultConfig: () => ({}),
    create: async (input: SubstrateDriverCreateInput): Promise<SubstrateProviderInstance> => {
      const displayName = input.displayName ?? "Claude";
      const pending = createPendingSnapshot({
        driver: "claudeAgent",
        instanceId: input.instanceId,
        displayName,
        enabled: input.enabled,
      });
      const handle = createSnapshotHandle(createManagedSnapshotState(pending));

      return {
        instanceId: input.instanceId,
        driverKind: "claudeAgent",
        displayName,
        enabled: input.enabled,
        implementation: "full",
        snapshot: handle,
        live: {
          sendTurn: async (turn: SubstrateLiveTurnInput): Promise<SubstrateLiveTurnResult> => {
            const result = await executeRpcBridgedChatTurn({
              text: turn.text,
              threadId: turn.threadId,
              providerId: "claudeAgent",
              modelSelection: {
                provider: "claudeAgent",
                model: turn.model ?? "claude-sonnet-4-20250514",
              },
            });
            return {
              turnId: turn.threadId ?? "claude-turn",
              status: "completed",
              replyText: result.replyText,
            };
          },
        },
        dispose: async () => undefined,
      };
    },
  };
}
