#!/usr/bin/env bun
/**
 * Phase 1 smoke: start the substrate shadow HTTP scaffold, probe readiness, stop.
 * Does not require Electron — validates the child contract used by ShadowServerManager.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.COZEA_SUBSTRATE_SHADOW_PORT || "4783", 10);
const readyPath = "/.well-known/cozea/substrate/ready";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-substrate-shadow-smoke-"));

const builtEntry = path.join(root, "out/main/substrate-shadow-server.js");
const sourceEntry = path.join(root, "electron/substrate-shadow-server/child.ts");
const entry = fs.existsSync(builtEntry) ? builtEntry : sourceEntry;
const runner = entry.endsWith(".ts") ? "bun" : process.execPath;
const args = entry.endsWith(".ts") ? [entry] : [entry];

console.log(`[smoke] starting ${runner} ${args.join(" ")} on ${host}:${port}`);

const child = spawn(runner, args, {
  env: {
    ...process.env,
    COZEA_SUBSTRATE_SHADOW_HOST: host,
    COZEA_SUBSTRATE_SHADOW_PORT: String(port),
    COZEA_SUBSTRATE_SHADOW_LOG_DIR: logDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const readyUrl = `http://${host}:${port}${readyPath}`;
const deadline = Date.now() + 15_000;

async function waitReady() {
  while (true) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${readyUrl}`);
    }
    try {
      const response = await fetch(readyUrl);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // retry
    }
    await Bun.sleep(100);
  }
}

try {
  const payload = await waitReady();
  console.log("[smoke] ready payload:", payload);
  console.log("[smoke] ok");
} finally {
  child.kill("SIGTERM");
  await Bun.sleep(500);
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGKILL");
  }
}
