/**
 * Keeps test runs out of the real Cozea state.
 *
 * projectd modules default to ~/Library/Application Support/Cozea and to a fixed
 * daemon socket under /tmp. Unless a run already chose its own locations, every
 * override points into one temp directory per test process, so no suite can touch a
 * developer's live workbenches, Git mirrors, binary cache or running daemon.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const root =
  process.env.COZEA_TEST_STATE_ROOT ?? fs.mkdtempSync(path.join(os.tmpdir(), "cozea-test-state-"))
process.env.COZEA_TEST_STATE_ROOT = root

const overrides: Record<string, string> = {
  COZEA_PROJECTD_DB: path.join(root, "projectd.sqlite"),
  COZEA_WORKSPACE_CATALOG_PATH: path.join(root, "workspace-catalog.json"),
  COZEA_GIT_MIRRORS_DIR: path.join(root, "git-mirrors"),
  COZEA_BINARY_CACHE_DIR: path.join(root, "binary-cache"),
  COZEA_COLLAB_REPOS_DIR: path.join(root, "collaboration"),
  COZEA_PROJECTD_SOCKET: path.join(root, "projectd.sock"),
}

for (const [name, value] of Object.entries(overrides)) {
  process.env[name] ??= value
}
