export interface SubstrateVcsInvalidateResult {
  readonly ok: boolean;
  readonly reason?: "substrate_vcs_disabled" | "invalid_cwd" | "unavailable";
}

export interface SubstrateVcsCapabilities {
  readonly enabled: boolean;
  readonly capabilities: {
    readonly status: boolean;
    readonly refs: boolean;
    readonly worktrees: boolean;
    readonly checkpoints: boolean;
    readonly push: boolean;
    readonly ignore: boolean;
    readonly init: boolean;
  };
}

function readSubstrateVcsBridge():
  | {
      readonly invalidate: (cwd: string) => Promise<SubstrateVcsInvalidateResult>;
      readonly getCapabilities: () => Promise<SubstrateVcsCapabilities>;
    }
  | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.desktopBridge?.substrateVcs ?? null;
}

/**
 * Flagged substrate VCS invalidate — prefer this over legacy git broadcast paths
 * when `COZEA_SUBSTRATE_VCS=1`. Collab overlay handlers already call
 * `invalidateVcsStatus` on cwd-mutating sync ops.
 */
export async function invalidateSubstrateVcsStatus(
  cwd: string,
): Promise<SubstrateVcsInvalidateResult> {
  const bridge = readSubstrateVcsBridge();
  if (!bridge?.invalidate) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    return await bridge.invalidate(cwd);
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export async function getSubstrateVcsCapabilities(): Promise<SubstrateVcsCapabilities | null> {
  const bridge = readSubstrateVcsBridge();
  if (!bridge?.getCapabilities) {
    return null;
  }
  try {
    return await bridge.getCapabilities();
  } catch {
    return null;
  }
}
