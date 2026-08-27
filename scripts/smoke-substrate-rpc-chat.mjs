#!/usr/bin/env bun
/**
 * Phase 2 smoke: start shadow server with rpcChat, connect SubstrateChatClient,
 * health + chat.send + chat.subscribe roundtrip, stop.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.COZEA_SUBSTRATE_SHADOW_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.COZEA_SUBSTRATE_SHADOW_PORT || "4783", 10);
const readyPath = "/.well-known/cozea/substrate/ready";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-substrate-rpc-smoke-"));

const builtEntry = path.join(root, "apps/desktop/out/main/substrate-shadow-server.js");
const sourceEntry = path.join(root, "apps/desktop/electron/substrate-shadow-server/child.ts");
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
    COZEA_SUBSTRATE_RPC_CHAT: "1",
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
    await sleep(100);
  }
}

function rpcRequest(ws, id, method, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 10_000);
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

function rpcSubscribe(ws, id, turnId) {
  return new Promise((resolve, reject) => {
    const events = [];
    const timer = setTimeout(() => reject(new Error("subscribe timeout")), 10_000);
    const onMessage = (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg?.id !== id) return;
      if (msg.type === "event") events.push(msg.event);
      if (msg.type === "done") {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(events);
      }
      if (msg.type === "res" && msg.ok === false) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        reject(new Error(msg.error?.message ?? "subscribe failed"));
      }
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ type: "req", id, method: "chat.subscribe", payload: { turnId } }));
  });
}

try {
  const payload = await waitReady();
  console.log("[smoke] ready payload:", payload);
  if (payload.rpcChat !== true || (payload.phase !== 2 && payload.phase !== 3)) {
    throw new Error("expected phase 2 or 3 ready payload with rpcChat=true");
  }

  const ws = new WebSocket(`ws://${host}:${port}/rpc`);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const health = await rpcRequest(ws, "1", "health", {});
  console.log("[smoke] health:", health);
  const send = await rpcRequest(ws, "2", "chat.send", { text: "phase2-smoke" });
  console.log("[smoke] chat.send:", send);
  const events = await rpcSubscribe(ws, "3", send.turnId);
  console.log("[smoke] chat.subscribe events:", events.length);
  ws.close();
  console.log("[smoke] ok");
} finally {
  child.kill("SIGTERM");
  await sleep(500);
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGKILL");
  }
}
