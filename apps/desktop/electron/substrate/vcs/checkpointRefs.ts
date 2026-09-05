/**
 * Unified checkpoint ref namespace (Phase 4b exit).
 *
 * Orchestration turn refs and Changes group refs share `refs/cozea/checkpoints`.
 * Legacy `refs/t3/checkpoints` group refs are migrated lazily on read; turn refs
 * are left where the embedded server put them (see `isGroupCheckpointRef`).
 */

import { Encoding } from "effect";

import { CheckpointRef, type ThreadId } from "@cozea/assistant-contracts";

export const CHECKPOINT_REFS_PREFIX = "refs/cozea/checkpoints";

/** Pre-unification orchestration prefix — migrate on encounter. */
export const LEGACY_T3_CHECKPOINT_REFS_PREFIX = "refs/t3/checkpoints";

export function checkpointRefForGroupId(checkpointId: string): string {
  return `${CHECKPOINT_REFS_PREFIX}/${checkpointId}`;
}

export function checkpointRefForThreadTurn(threadId: ThreadId, turnCount: number): CheckpointRef {
  return CheckpointRef.makeUnsafe(
    `${CHECKPOINT_REFS_PREFIX}/${Encoding.encodeBase64Url(threadId)}/turn/${turnCount}`,
  );
}

export function normalizeCheckpointRef(ref: string): string {
  if (ref.startsWith(LEGACY_T3_CHECKPOINT_REFS_PREFIX)) {
    return `${CHECKPOINT_REFS_PREFIX}${ref.slice(LEGACY_T3_CHECKPOINT_REFS_PREFIX.length)}`;
  }
  return ref;
}

export function isLegacyT3CheckpointRef(ref: string): boolean {
  return ref.startsWith(LEGACY_T3_CHECKPOINT_REFS_PREFIX);
}

/**
 * True for the flat Changes group refs this process owns, `<prefix>/<id>`.
 *
 * Turn refs (`<prefix>/<threadId>/turn/<n>`) are written *and read back* by the
 * embedded orchestration server, which still resolves them under the legacy
 * prefix. Renaming those out from under it makes every later turn diff fail
 * with "unknown revision", so they are not ours to migrate. Unrecognised
 * shapes are treated as not ours for the same reason.
 */
export function isGroupCheckpointRef(ref: string): boolean {
  const prefix = isLegacyT3CheckpointRef(ref)
    ? LEGACY_T3_CHECKPOINT_REFS_PREFIX
    : CHECKPOINT_REFS_PREFIX;
  if (!ref.startsWith(`${prefix}/`)) {
    return false;
  }
  const suffix = ref.slice(prefix.length + 1);
  return suffix.length > 0 && !suffix.includes("/");
}

/**
 * Best-effort rename of legacy Changes group refs in a repo.
 * Safe to call multiple times; no-ops when nothing to migrate.
 */
export async function migrateLegacyT3CheckpointRefs(cwd: string): Promise<number> {
  const { spawnSync } = await import("node:child_process");
  const list = spawnSync(
    "git",
    ["for-each-ref", "--format=%(refname)", LEGACY_T3_CHECKPOINT_REFS_PREFIX],
    { cwd, encoding: "utf8" },
  );
  if (list.status !== 0) {
    return 0;
  }
  const refs = list.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isGroupCheckpointRef);
  let migrated = 0;
  for (const legacyRef of refs) {
    const target = normalizeCheckpointRef(legacyRef);
    const result = spawnSync("git", ["update-ref", target, legacyRef], { cwd, encoding: "utf8" });
    if (result.status === 0) {
      spawnSync("git", ["update-ref", "-d", legacyRef], { cwd, encoding: "utf8" });
      migrated += 1;
    }
  }
  return migrated;
}
