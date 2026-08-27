#!/usr/bin/env node
/**
 * Sync upstream T3 contract groups from vendor/t3code into @cozea/contracts/src/t3/.
 * Run after vendor pin updates: node scripts/vendor/sync-t3-contracts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vendorSrc = path.join(root, "vendor/t3code/packages/contracts/src");
const destRoot = path.join(root, "packages/contracts/src/t3");
const pinFile = path.join(root, "docs/substrate-t3-pin.md");
const SKIP_COPY = new Set(["index.ts"]);

function readPinSha() {
  const doc = fs.readFileSync(pinFile, "utf8");
  const match = doc.match(/`([0-9a-f]{40})`/);
  if (!match) {
    throw new Error(`Pin SHA not found in ${pinFile}`);
  }
  return match[1];
}

function extractConstBlock(source, exportName) {
  const start = source.indexOf(`export const ${exportName} = {`);
  if (start < 0) {
    throw new Error(`Could not find export const ${exportName}`);
  }
  let depth = 0;
  let end = start;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const tail = source.slice(end).trimStart();
  const asConst = tail.startsWith("as const") ? " as const;" : ";";
  return `${source.slice(start, end)}${asConst}`;
}

function writeMethodTags(pin) {
  const orchestration = fs.readFileSync(path.join(vendorSrc, "orchestration.ts"), "utf8");
  const rpc = fs.readFileSync(path.join(vendorSrc, "rpc.ts"), "utf8");
  const body = `/** @generated from vendor/t3code/packages/contracts @ ${pin} */
${extractConstBlock(orchestration, "ORCHESTRATION_WS_METHODS")}

${extractConstBlock(rpc, "WS_METHODS")}
`;
  fs.writeFileSync(path.join(destRoot, "methodTags.ts"), body, "utf8");
}

function writeT3Index() {
  const body = `/** @generated — re-export synced upstream T3 contract groups (see SYNC_MANIFEST.json). */
export * from "./baseSchemas.ts";
export * from "./background.ts";
export * from "./auth.ts";
export * from "./environment.ts";
export * from "./environmentHttp.ts";
export * from "./relayClient.ts";
export * from "./desktopBootstrap.ts";
export * from "./remoteAccess.ts";
export * from "./ipc.ts";
export * from "./terminal.ts";
export * from "./provider.ts";
export * from "./providerInstance.ts";
export * from "./providerRuntime.ts";
export * from "./model.ts";
export * from "./keybindings.ts";
export * from "./server.ts";
export * from "./settings.ts";
export * from "./git.ts";
export * from "./vcs.ts";
export * from "./sourceControl.ts";
export * from "./pullRequest.ts";
export * from "./orchestration.ts";
export * from "./t3ProjectFile.ts";
export * from "./editor.ts";
export * from "./project.ts";
export * from "./filesystem.ts";
export * from "./assets.ts";
export * from "./review.ts";
export * from "./preview.ts";
export * from "./previewAutomation.ts";
export * from "./resourceTelemetry.ts";
export * from "./usage.ts";
export * from "./rpc.ts";
export * from "./methodTags.ts";
`;
  fs.writeFileSync(path.join(destRoot, "index.ts"), `// @ts-nocheck\n${body}`, "utf8");
}

function copyContractSources() {
  if (!fs.existsSync(vendorSrc)) {
    throw new Error(`Missing vendor contracts at ${vendorSrc}`);
  }

  fs.rmSync(destRoot, { recursive: true, force: true });
  fs.mkdirSync(destRoot, { recursive: true });

  const copied = [];
  for (const entry of fs.readdirSync(vendorSrc, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    if (SKIP_COPY.has(entry.name)) continue;
    const src = path.join(vendorSrc, entry.name);
    const dest = path.join(destRoot, entry.name);
    fs.copyFileSync(src, dest);
    copied.push(entry.name);
  }

  const pin = readPinSha();
  const banner = `// @ts-nocheck\n/** @generated from vendor/t3code/packages/contracts @ ${pin} — do not edit; run scripts/vendor/sync-t3-contracts.mjs */\n`;
  for (const name of copied) {
    const filePath = path.join(destRoot, name);
    const body = fs.readFileSync(filePath, "utf8");
    if (!body.includes("@generated from vendor/t3code")) {
      fs.writeFileSync(filePath, banner + body, "utf8");
    }
  }

  writeMethodTags(pin);
  writeT3Index();

  fs.writeFileSync(
    path.join(destRoot, "SYNC_MANIFEST.json"),
    JSON.stringify({ pin, copied: copied.sort(), syncedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );

  console.log(`[sync-t3-contracts] synced ${copied.length} files from pin ${pin.slice(0, 8)}`);
}

copyContractSources();
