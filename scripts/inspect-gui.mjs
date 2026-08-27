#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const artifactsDir = path.join(repoRoot, ".artifacts", "screenshots");

const CDP_HOST = process.env.CDP_HOST || "127.0.0.1";
const CDP_PORT = process.env.CDP_PORT || "9222";
const CDP_URL = `http://${CDP_HOST}:${CDP_PORT}`;

async function fetchTargets() {
  try {
    const res = await fetch(`${CDP_URL}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(`Could not connect to CDP at ${CDP_URL}: ${err.message}`);
  }
}

function findPrimaryRendererTarget(targets) {
  return (
    targets.find((t) => t.type === "page" && !t.url.startsWith("devtools://")) ||
    targets.find((t) => t.type === "page") ||
    targets[0]
  );
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      const timer = setTimeout(() => reject(new Error("CDP WS timeout")), 5000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = (err) => { clearTimeout(timer); reject(err); };
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        } else if (msg.method) {
          const listeners = this.eventListeners.get(msg.method) || [];
          for (const cb of listeners) cb(msg.params);
        }
      };
    });
  }

  async send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.ws?.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "targets";

  if (command === "targets") {
    const targets = await fetchTargets();
    console.log(`Found ${targets.length} CDP target(s) on ${CDP_URL}:`);
    for (const t of targets) console.log(`- [${t.type}] ${t.title || "(no title)"} (${t.url})`);
    return;
  }

  const targets = await fetchTargets();
  const target = findPrimaryRendererTarget(targets);
  if (!target || !target.webSocketDebuggerUrl) throw new Error("No inspectable renderer target found");

  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.connect();

  try {
    if (command === "screenshot") {
      fs.mkdirSync(artifactsDir, { recursive: true });
      const filename = args[1] || `screenshot-${Date.now()}.png`;
      const outPath = path.isAbsolute(filename) ? filename : path.join(artifactsDir, filename);

      await session.send("Page.enable");
      const result = await session.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      fs.writeFileSync(outPath, Buffer.from(result.data, "base64"));
      console.log(`Screenshot saved to: ${outPath}`);
    } else if (command === "eval") {
      const expression = args.slice(1).join(" ") || "document.location.href";
      const result = await session.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) console.error("Evaluation error:", result.exceptionDetails);
      else console.log(JSON.stringify(result.result?.value, null, 2));
    }
  } finally {
    session.close();
  }
}

main().catch((err) => {
  console.error("inspect-gui error:", err.message);
  process.exit(1);
});
