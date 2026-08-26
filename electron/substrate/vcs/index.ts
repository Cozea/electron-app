/**
 * Phase 4 VCS substrate scaffold (4a–4e).
 *
 * @see docs/substrate-phase4-vcs.md
 */

export type {
  VcsDriver,
  VcsDriverCapabilities,
  VcsStatusDetails,
  VcsPushResult,
  VcsCheckpointOps,
  VcsCaptureCheckpointInput,
  VcsChangesReadInput,
  VcsChangesReadResult,
  VcsHeadDiffStatsInput,
  VcsHeadDiffStatsResult,
  VcsRemoveWorktreeInput,
  VcsChangesScope,
} from "./VcsDriver";

export {
  GitVcsDriver,
  createGitVcsDriver,
  type GitCorePort,
  type GitVcsCheckpointBackend,
  type GitVcsDriverOptions,
} from "./GitVcsDriver";

export {
  invalidateVcsStatus,
  subscribeVcsStatusInvalidation,
  resetVcsStatusInvalidationForTests,
  getVcsStatusInvalidationListenerCountForTests,
  type VcsStatusInvalidationScope,
  type VcsStatusInvalidationListener,
} from "./statusInvalidation";

export {
  evaluatePushSafety,
  isAliasOfUpstreamHead,
  legacyUnsafeUpstreamRefspec,
  type PushSafetyInput,
  type PushSafetyDecision,
} from "./pushSafety";

export {
  getOrphanedWorktreePathForThread,
  formatWorktreePathForDisplay,
  buildOrphanWorktreePromptMessage,
  createDetectionOnlyWorktreeOrphanHooks,
  type ThreadWorktreeRef,
  type WorktreeOrphanCleanupHooks,
  type WorktreeOrphanPromptChoice,
} from "./worktreeOrphanCleanup";

export {
  registerLegacyChangesCheckpointBackend,
  registerDriverCheckpointOps,
  getChangesCheckpointReads,
  createDelegatingCheckpointOps,
  resetCheckpointFacadeForTests,
  type ChangesCheckpointReads,
  type ChangesCheckpointBackend,
} from "./checkpointsFacade";

export {
  bootstrapSubstrateVcs,
  resetSubstrateVcsBootstrapForTests,
} from "./bootstrap";

export {
  registerSubstrateVcsIpcHandlers,
  resetSubstrateVcsIpcHandlersForTests,
  SUBSTRATE_VCS_CAPABILITIES_HANDLE,
  SUBSTRATE_VCS_INVALIDATE_HANDLE,
  type SubstrateVcsCapabilitiesResponse,
} from "./registerIpcHandlers";