#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor/t3code");
const manager = JSON.parse(
  fs.readFileSync(path.join(vendor, "package.json"), "utf8"),
).packageManager;
// The vendor workspace owns its dependencies and runner; never resolve it from
// Cozea's different Effect installation. No global package manager is installed.
const result = spawnSync(
  "bun",
  [
    "x",
    manager,
    "--config.verifyDepsBeforeRun=false",
    "exec",
    "vp",
    "test",
    "run",
    "packages/effect-codex-app-server/src/schema.test.ts",
    "apps/server/src/provider",
    "apps/server/src/orchestration",
    "apps/server/src/persistence",
    "apps/server/src/serverRuntimeStartup.test.ts",
    "apps/server/src/cozeaHostUpdateControl.test.ts",
  ],
  { cwd: vendor, stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
// Run separately: enabling authority for the ordinary native suite would change
// its contract. This test supplies controlled trusted-host IPC responses.
const authority = spawnSync("bun", ["x", manager, "--config.verifyDepsBeforeRun=false", "exec", "vp", "test", "run",
  "apps/server/src/provider/Layers/ProviderService.test.ts", "-t", "Cozea native service authority boundary"],
  { cwd: vendor, stdio: "inherit", env: { ...process.env, COZEA_NATIVE_WORKSPACE_AUTHORITY: "1" }, timeout: 90_000 });
if (authority.status !== 0) process.exit(authority.status ?? 1);
const ipc = spawnSync("node", [path.join(root, "scripts/test-native-workspace-boundary.mjs")],
  { cwd: root, stdio: "inherit", timeout: 90_000 });
process.exit(ipc.status ?? 1);
