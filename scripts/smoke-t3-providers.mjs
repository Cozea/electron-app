#!/usr/bin/env bun
/**
 * Phase T4 smoke: shadow child with COZEA_T3_SERVER=1 serves server.getConfig via T3.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { WS_METHODS } from "@cozea/contracts";

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

async function callT3Unary(baseUrl, wsTicket, tag, payload = {}) {
  const { WebSocket } = await import("ws");
  const url = new URL("/ws", baseUrl);
  url.searchParams.set("wsTicket", wsTicket);
  url.searchParams.set("clientSurface", "web");

  const ws = new WebSocket(url.toString());
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const requestId = randomUUID();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${tag}`)), 30_000);
    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?._tag === "Exit" && String(msg.requestId) === requestId) {
        clearTimeout(timer);
        if (msg.exit?._tag === "Success") {
          resolve(msg.exit.value);
        } else {
          reject(new Error(`T3 RPC failed: ${JSON.stringify(msg.exit?.cause).slice(0, 400)}`));
        }
      }
    });
    ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));
  });

  ws.close();
  return result;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || "127.0.0.1";
const port = pickEphemeralPort(4783, "COZEA_SUBSTRATE_SHADOW_PORT");
const readyPath = "/.well-known/cozea/substrate/ready";
const t3SessionPath = "/.well-known/cozea/substrate/t3-rpc-session";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t3-providers-smoke-"));
const t3Port = pickEphemeralPort(13_773, "COZEA_T3_SERVER_PORT");

const builtEntry = path.join(root, "out/main/substrate-shadow-server.js");
const sourceEntry = path.join(root, "electron/substrate-shadow-server/child.ts");
const entry =
  process.env.COZEA_T3_SMOKE_USE_BUILT === "1" && fs.existsSync(builtEntry)
    ? builtEntry
    : sourceEntry;
const runner = entry.endsWith(".ts") ? "bun" : process.execPath;
const args = entry.endsWith(".ts") ? [entry] : [entry];

console.log(`[smoke-t3-providers] starting shadow child (${runner}) on ${host}:${port}, T3 on ${t3Port}`);

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

try {
  const payload = await waitReady();
  console.log("[smoke-t3-providers] ready payload:", payload);
  if (payload.t3Server !== true) {
    throw new Error("expected ready payload t3Server=true");
  }
  if (payload.providers === true) {
    throw new Error("expected substrate provider registry gated when T3 active");
  }

  const sessionUrl = `http://${host}:${port}${t3SessionPath}`;
  const sessionResponse = await fetch(sessionUrl);
  const sessionPayload = await sessionResponse.json();
  if (!sessionResponse.ok || sessionPayload.ok !== true || !sessionPayload.wsTicket) {
    throw new Error("expected t3-rpc-session payload with wsTicket");
  }

  const config = await callT3Unary(
    sessionPayload.baseUrl,
    sessionPayload.wsTicket,
    WS_METHODS.serverGetConfig,
    {},
  );
  console.log("[smoke-t3-providers] server.getConfig keys:", Object.keys(config ?? {}));
  if (!config || typeof config !== "object" || !Array.isArray(config.providers)) {
    throw new Error("expected server.getConfig object with providers array");
  }

  console.log("[smoke-t3-providers] ok");
} finally {
  child.kill("SIGTERM");
  await sleep(500);
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGKILL");
  }
}
