#!/usr/bin/env node
/**
 * Phase T0 spike: boot upstream T3 apps/server from vendor/t3code in isolation.
 * - Verifies submodule pin
 * - Ensures server bundle exists (pnpm install + build:bundle)
 * - Starts headless `serve`, probes /.well-known/t3/environment
 * - Pairs via one-time token, opens WS, calls server.getConfig, prints provider count
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(root, "vendor/t3code");
const serverPkg = path.join(vendorRoot, "apps/server");
const serverBin = path.join(serverPkg, "dist/bin.mjs");
const pinFile = path.join(root, "docs/substrate-t3-pin.md");
const MIN_NODE = [22, 16];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNodeVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function assertNodeVersion() {
  const version = parseNodeVersion(process.version);
  if (!version) throw new Error(`Unrecognized Node version: ${process.version}`);
  const [major, minor] = MIN_NODE;
  const ok =
    version.major > major ||
    (version.major === major && version.minor >= minor) ||
    version.major >= 23;
  if (!ok) {
    throw new Error(
      `Node ${process.version} is too old for T3 server (need >= ${major}.${minor} or >= 23.11 or >= 24).`,
    );
  }
}

function readPinSha() {
  const doc = fs.readFileSync(pinFile, "utf8");
  const match = doc.match(/`([0-9a-f]{40})`/);
  if (!match) throw new Error(`Pin SHA not found in ${pinFile}`);
  return match[1];
}

function readVendorSha() {
  if (!fs.existsSync(path.join(vendorRoot, ".git"))) {
    throw new Error("vendor/t3code submodule missing — run git submodule update --init --recursive");
  }
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: vendorRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git rev-parse failed in vendor/t3code: ${result.stderr}`);
  }
  return (result.stdout ?? "").trim();
}

async function runCommand(cmd, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd ?? vendorRoot,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!options.inherit) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function ensureBuilt() {
  if (process.env.COZEA_T3_SPIKE_SKIP_BUILD === "1" && fs.existsSync(serverBin)) {
    console.log("[spike-t3] skip build (COZEA_T3_SPIKE_SKIP_BUILD=1)");
    return;
  }
  console.log("[spike-t3] pnpm install (vendor/t3code)…");
  await runCommand("pnpm", ["install", "--frozen-lockfile"], { inherit: true });
  console.log("[spike-t3] build T3 server bundle…");
  await runCommand("pnpm", ["--filter", "t3", "build:bundle"], { inherit: true });
  if (!fs.existsSync(serverBin)) {
    throw new Error(`Expected server binary at ${serverBin}`);
  }
}

async function waitForEnvironment(baseUrl, deadlineMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    try {
      const response = await fetch(`${baseUrl}/.well-known/t3/environment`);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/.well-known/t3/environment`);
}

function extractPairingToken(logText) {
  const match = logText.match(/Token: ([A-Z0-9]+)/);
  if (!match) throw new Error("Pairing token not found in server output (expected `serve` headless output)");
  return match[1];
}

async function exchangeAccessToken(baseUrl, pairingToken) {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: pairingToken,
    subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope:
      "orchestration:read orchestration:operate terminal:operate review:write relay:read access:read access:write relay:write",
  });
  const response = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await response.json();
  if (!response.ok || !json.access_token) {
    throw new Error(`oauth/token failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function websocketTicketWithBearer(baseUrl, accessToken) {
  const response = await fetch(`${baseUrl}/api/auth/websocket-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!response.ok || !body.ticket) {
    throw new Error(`websocket-ticket failed: ${response.status} ${JSON.stringify(body)}`);
  }
  return body.ticket;
}

async function listProvidersViaRpc(port, wsTicket) {
  const probeSource = path.join(root, "scripts/spike-t3-rpc-get-config.ts");
  const probeDest = path.join(vendorRoot, "scripts/cozea-spike-rpc-get-config.ts");
  fs.mkdirSync(path.dirname(probeDest), { recursive: true });
  fs.copyFileSync(probeSource, probeDest);
  try {
    const { stdout } = await runCommand(
      "pnpm",
      ["exec", "node", "--experimental-strip-types", "scripts/cozea-spike-rpc-get-config.ts", String(port), wsTicket],
      { cwd: vendorRoot },
    );
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
    if (!Number.isFinite(parsed.providerCount)) {
      throw new Error(`Unexpected RPC probe output: ${stdout}`);
    }
    return parsed;
  } finally {
    fs.rmSync(probeDest, { force: true });
  }
}

async function main() {
  assertNodeVersion();

  const pin = readPinSha();
  const vendorSha = readVendorSha();
  if (vendorSha !== pin) {
    throw new Error(
      `vendor/t3code pin mismatch: expected ${pin}, got ${vendorSha}. Run: node scripts/vendor/sync-t3code-pin.mjs`,
    );
  }
  console.log(`[spike-t3] pin ok (${pin.slice(0, 8)})`);

  await ensureBuilt();

  const port = Number.parseInt(process.env.COZEA_T3_SPIKE_PORT ?? "0", 10) || 13_773;
  const host = process.env.COZEA_T3_SPIKE_HOST?.trim() || "127.0.0.1";
  const baseUrl = `http://${host}:${port}`;
  const t3Home = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-t3-spike-"));
  let log = "";

  console.log(`[spike-t3] starting T3 server on ${baseUrl} (base-dir ${t3Home})`);
  const child = spawn(
    process.execPath,
    [
      serverBin,
      "serve",
      "--port",
      String(port),
      "--host",
      host,
      "--no-browser",
      "--base-dir",
      t3Home,
    ],
    {
      cwd: serverPkg,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout?.on("data", (chunk) => {
    log += chunk;
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    log += chunk;
    process.stderr.write(chunk);
  });

  try {
    const environment = await waitForEnvironment(baseUrl);
    console.log("[spike-t3] environment:", {
      environmentId: environment.environmentId,
      serverVersion: environment.serverVersion,
      label: environment.label,
    });
    if (!environment.serverVersion || !environment.environmentId) {
      throw new Error("Invalid environment descriptor payload");
    }

    const token = extractPairingToken(log);
    const accessToken = await exchangeAccessToken(baseUrl, token);
    const ticket = await websocketTicketWithBearer(baseUrl, accessToken);
    console.log("[spike-t3] auth ok (oauth token + websocket-ticket)");

    const providerInfo = await listProvidersViaRpc(port, ticket);
    console.log(`[spike-t3] server.getConfig providers: ${providerInfo.providerCount}`);
    for (const label of providerInfo.providers ?? []) {
      console.log(`  - ${label}`);
    }
    console.log("[spike-t3] ok");
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
    if (!child.killed && child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

main().catch((error) => {
  console.error("[spike-t3] failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
