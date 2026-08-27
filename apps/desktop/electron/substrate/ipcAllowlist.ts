import { PHASE5_IPC_ALLOWLIST_PREFIXES } from "./constants";

export interface IpcAllowlistDecision {
  readonly channel: string;
  readonly allowed: boolean;
  readonly matchedPrefix: string | null;
}

/**
 * Phase 5 helper — classify whether an ipcMain.handle channel should remain
 * after the in-process assistant runtime is removed.
 *
 * Enforcement is advisory until `cozea.substrate.primary` defaults on; call sites
 * can log violations during dual-run.
 */
export function classifyIpcChannel(channel: string): IpcAllowlistDecision {
  for (const prefix of PHASE5_IPC_ALLOWLIST_PREFIXES) {
    if (channel === prefix.slice(0, -1) || channel.startsWith(prefix)) {
      return { channel, allowed: true, matchedPrefix: prefix };
    }
  }
  // Assistant / agent / terminal channels move to server RPC under primary mode.
  if (
    channel.startsWith("assistant") ||
    channel.startsWith("agent") ||
    channel.startsWith("terminal:") ||
    channel.startsWith("git:") ||
    channel.startsWith("orchestration")
  ) {
    return { channel, allowed: false, matchedPrefix: null };
  }
  return { channel, allowed: false, matchedPrefix: null };
}

export function assertIpcAllowlist(
  channel: string,
  options?: { readonly enforce?: boolean },
): IpcAllowlistDecision {
  const decision = classifyIpcChannel(channel);
  if (options?.enforce && !decision.allowed) {
    throw new Error(
      `IPC channel "${channel}" is not on the Phase 5 allowlist (cozea.substrate.primary).`,
    );
  }
  return decision;
}
