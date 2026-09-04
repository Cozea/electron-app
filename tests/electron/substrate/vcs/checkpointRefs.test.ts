import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ThreadId } from "@cozea/assistant-contracts";

import {
  CHECKPOINT_REFS_PREFIX,
  LEGACY_T3_CHECKPOINT_REFS_PREFIX,
  checkpointRefForGroupId,
  checkpointRefForThreadTurn,
  isGroupCheckpointRef,
  migrateLegacyT3CheckpointRefs,
  normalizeCheckpointRef,
} from "../../../../apps/desktop/electron/substrate/vcs/checkpointRefs";

describe("checkpointRefs (unified namespace)", () => {
  it("uses refs/cozea/checkpoints for group and turn refs", () => {
    expect(checkpointRefForGroupId("group-1")).toBe(`${CHECKPOINT_REFS_PREFIX}/group-1`);
    const turnRef = checkpointRefForThreadTurn(ThreadId.makeUnsafe("thread-1"), 2);
    expect(String(turnRef)).toMatch(new RegExp(`^${CHECKPOINT_REFS_PREFIX}/.+/turn/2$`));
  });

  it("normalizes legacy refs/t3/checkpoints refs", () => {
    const legacy = `${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/abc/turn/1`;
    expect(normalizeCheckpointRef(legacy)).toBe(`${CHECKPOINT_REFS_PREFIX}/abc/turn/1`);
    expect(normalizeCheckpointRef(`${CHECKPOINT_REFS_PREFIX}/abc/turn/1`)).toBe(
      `${CHECKPOINT_REFS_PREFIX}/abc/turn/1`,
    );
  });

  it("claims flat group refs and disclaims orchestration turn refs", () => {
    expect(isGroupCheckpointRef(`${CHECKPOINT_REFS_PREFIX}/group-1`)).toBe(true);
    expect(isGroupCheckpointRef(`${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/group-1`)).toBe(true);
    expect(isGroupCheckpointRef(`${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/abc/turn/1`)).toBe(false);
    expect(isGroupCheckpointRef(`${CHECKPOINT_REFS_PREFIX}/abc/turn/1`)).toBe(false);
    expect(isGroupCheckpointRef("refs/heads/main")).toBe(false);
    expect(isGroupCheckpointRef(CHECKPOINT_REFS_PREFIX)).toBe(false);
  });
});

/**
 * The embedded orchestration server writes turn checkpoints under the legacy
 * prefix and resolves them there on the next turn. Migrating those refs away
 * used to leave its diff asking for a ref that no longer existed, which
 * surfaced as a "Checkpoint capture failed" row on every later turn.
 */
describe("migrateLegacyT3CheckpointRefs", () => {
  const repos: string[] = [];

  const git = (cwd: string, args: string[]): string => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  };

  const createRepo = (): { cwd: string; commit: string } => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-checkpoint-refs-"));
    repos.push(cwd);
    git(cwd, ["init", "-q"]);
    git(cwd, [
      "-c",
      "user.name=Cozea Test",
      "-c",
      "user.email=test@cozea.local",
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "base",
    ]);
    return { cwd, commit: git(cwd, ["rev-parse", "HEAD"]) };
  };

  const listRefs = (cwd: string): string[] =>
    git(cwd, [
      "for-each-ref",
      "--format=%(refname)",
      CHECKPOINT_REFS_PREFIX,
      LEGACY_T3_CHECKPOINT_REFS_PREFIX,
    ])
      .split("\n")
      .filter(Boolean);

  afterEach(() => {
    while (repos.length > 0) {
      const cwd = repos.pop();
      if (cwd) fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("migrates group refs and leaves the server's turn refs alone", async () => {
    const { cwd, commit } = createRepo();
    const legacyGroupRef = `${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/group-1`;
    const legacyTurnRef = `${LEGACY_T3_CHECKPOINT_REFS_PREFIX}/dGhyZWFkLTE/turn/1`;
    git(cwd, ["update-ref", legacyGroupRef, commit]);
    git(cwd, ["update-ref", legacyTurnRef, commit]);

    expect(await migrateLegacyT3CheckpointRefs(cwd)).toBe(1);

    const refs = listRefs(cwd);
    expect(refs).toContain(`${CHECKPOINT_REFS_PREFIX}/group-1`);
    expect(refs).not.toContain(legacyGroupRef);
    expect(refs).toContain(legacyTurnRef);
  });

  it("is a no-op on a repo with nothing to migrate", async () => {
    const { cwd, commit } = createRepo();
    git(cwd, ["update-ref", `${CHECKPOINT_REFS_PREFIX}/group-1`, commit]);

    expect(await migrateLegacyT3CheckpointRefs(cwd)).toBe(0);
    expect(listRefs(cwd)).toEqual([`${CHECKPOINT_REFS_PREFIX}/group-1`]);
  });
});
