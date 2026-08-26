import {
  beginManagedSnapshotRefresh,
  createManagedSnapshotState,
  createPendingSnapshot,
  runManagedSnapshotPipeline,
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

const DEFAULT_CURSOR_MODELS: ReadonlyArray<SubstrateProviderModel> = [
  { slug: "cursor/default", name: "Cursor Default" },
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
        message: "Native substrate Cursor driver (orchestration RPC).",
        models: DEFAULT_CURSOR_MODELS,
      }),
      capabilities: async () => ({}),
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

/** Full substrate Cursor driver — live turns via orchestration RPC. */
export function createCursorSubstrateDriver(): SubstrateProviderDriver {
  return {
    driverKind: "cursor",
    metadata: {
      displayName: "Cursor",
      supportsMultipleInstances: true,
      implementation: "full",
    },
    defaultConfig: () => ({}),
    create: async (input: SubstrateDriverCreateInput): Promise<SubstrateProviderInstance> => {
      const displayName = input.displayName ?? "Cursor";
      const pending = createPendingSnapshot({
        driver: "cursor",
        instanceId: input.instanceId,
        displayName,
        enabled: input.enabled,
      });
      const handle = createSnapshotHandle(createManagedSnapshotState(pending));

      return {
        instanceId: input.instanceId,
        driverKind: "cursor",
        displayName,
        enabled: input.enabled,
        implementation: "full",
        snapshot: handle,
        live: {
          sendTurn: async (turn: SubstrateLiveTurnInput): Promise<SubstrateLiveTurnResult> => {
            const result = await executeRpcBridgedChatTurn({
              text: turn.text,
              threadId: turn.threadId,
              providerId: "cursor",
              modelSelection: {
                provider: "cursor",
                model: turn.model ?? "cursor/default",
              },
            });
            return {
              turnId: turn.threadId ?? "cursor-turn",
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
