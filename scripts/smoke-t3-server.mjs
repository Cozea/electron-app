#!/usr/bin/env bun
/**
 * Phase T1 smoke: shadow child with COZEA_T3_SERVER=1 serves orchestration.getSnapshot via T3.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import { ORCHESTRATION_RPC_METHODS } from "@cozea/contracts";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickEphemeralPort(base, envKey, fallbackOffset = 0) {
  const raw = process.env[envKey]?.trim();
  if (raw) {
    return Number.parseInt(raw, 10);
  }
  return base + fallbackOffset + (process.pid % 200);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || "127.0.0.1";
const port = pickEphemeralPort(4783, "COZEA_SUBSTRATE_SHADOW_PORT");
const readyPath = "/.well-known/cozea/substrate/ready";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t3-server-smoke-"));
const t3Port = pickEphemeralPort(13_773, "COZEA_T3_SERVER_PORT");

// Prefer TS source so T1 smoke exercises live bootstrap/T3 wiring (built bundle may lag).
const builtEntry = path.join(root, "out/main/substrate-shadow-server.js");
const sourceEntry = path.join(root, "electron/substrate-shadow-server/child.ts");
const entry =
  process.env.COZEA_T3_SMOKE_USE_BUILT === "1" && fs.existsSync(builtEntry)
    ? builtEntry
    : sourceEntry;
const runner = entry.endsWith(".ts") ? "bun" : process.execPath;
const args = entry.endsWith(".ts") ? [entry] : [entry];

console.log(`[smoke-t3-server] starting shadow child (${runner}) on ${host}:${port}, T3 on ${t3Port}`);

const child = spawn(runner, args, {
  env: {
    ...process.env,
    COZEA_T3_SERVER: "1",
    COZEA_T3_SPIKE_SKIP_BUILD: process.env.COZEA_T3_SPIKE_SKIP_BUILD ?? "1",
    COZEA_SUBSTRATE_SHADOW_HOST: host,
    COZEA_SUBSTRATE_SHADOW_PORT: String(port),
    COZEA_T3_SERVER_PORT: String(t3Port),
    COZEA_SUBSTRATE_SHADOW_LOG_DIR: logDir,
    COZEA_SUBSTRATE_RPC_CHAT: "1",
    COZEA_SUBSTRATE_PRIMARY: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const readyUrl = `http://${host}:${port}${readyPath}`;
const deadline = Date.now() + 120_000;

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
    await sleep(250);
  }
}

function rpcRequest(ws, id, method, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 30_000);
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.type === "res" && msg.id === id) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error?.message ?? "rpc error"));
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "req", id, method, payload }));
  });
}

try {
  const payload = await waitReady();
  console.log("[smoke-t3-server] ready payload:", payload);
  if (payload.t3Server !== true) {
    throw new Error("expected ready payload t3Server=true (T3 dual-run did not activate)");
  }

  const ws = new WebSocket(`ws://${host}:${port}/rpc`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const snapshot = await rpcRequest(ws, "1", ORCHESTRATION_RPC_METHODS.getSnapshot, {});
  console.log("[smoke-t3-server] orchestration.getSnapshot keys:", Object.keys(snapshot ?? {}));
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("expected object snapshot from T3 orchestration backend");
  }
  ws.close();
  console.log("[smoke-t3-server] ok");
} finally {
  child.kill("SIGTERM");
  await sleep(500);
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGKILL");
  }
}
