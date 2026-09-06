#!/usr/bin/env node
/** Synchronize reviewed T3 wire contracts without suppressing type checking. */
import fs from "node:fs";
import { adaptT3Contract } from "./t3-contract-compat.mjs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vendorRoot = path.join(root, "vendor/t3code");
const vendorSrc = path.join(vendorRoot, "packages/contracts/src");
const destRoot = path.join(root, "packages/contracts/src/t3");
const check = process.argv.includes("--check");
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const pin = git(vendorRoot, "rev-parse", "HEAD");
const documented = fs.readFileSync(path.join(root, "docs/substrate-t3-pin.md"), "utf8").match(/`([0-9a-f]{40})`/)?.[1];
const constant = fs.readFileSync(path.join(root, "apps/desktop/electron/substrate/constants.ts"), "utf8").match(/SUBSTRATE_T3_PIN_SHA = "([0-9a-f]{40})"/)?.[1];
const gitlink = git(root, "ls-files", "--stage", "vendor/t3code").split(/\s+/)[1];
if (pin !== documented || pin !== constant || pin !== gitlink) {
  throw new Error("T3 HEAD, staged gitlink, documented pin, and runtime constant must agree before contract sync.");
}
if (git(vendorRoot, "status", "--porcelain", "--", "packages/contracts/src")) {
  throw new Error("Commit reviewed vendor contracts before synchronizing them.");
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

/**
 * Compares two arrays for shallow equality.
 *
 * @param {unknown} left - First array
 * @param {unknown} right - Second array
 * @returns {boolean} True if arrays are equal, false otherwise
 */
function arraysEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Compares two records (objects) for shallow equality of their keys and values.
 *
 * @param {unknown} left - First record
 * @param {unknown} right - Second record
 * @returns {boolean} True if records have the same keys and values, false otherwise
 */
function recordsEqual(left, right) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return arraysEqual(leftKeys, rightKeys) && leftKeys.every((key) => left[key] === right[key]);
}

// Cozea owns device authentication and talks to T3 over RPC. Server-side T3
// HTTP/relay middleware is not a client contract and cannot use our older
// Effect HTTP security implementation (in particular its DPoP scheme).
const excluded = new Set(["index.ts", "environmentHttp.ts", "relay.ts"]);
const copied = fs.readdirSync(vendorSrc).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !excluded.has(name)).sort();
const adaptation = "cozea-effect-8881a9b-v1";
const sourceHashes = {};
const generatedBodies = new Map();
for (const name of copied) {
  const source = fs.readFileSync(path.join(vendorSrc, name), "utf8");
  if (source.includes("@ts-nocheck")) throw new Error(`Unreviewed type suppression in ${name}`);
  sourceHashes[name] = createHash("sha256").update(source).digest("hex");
  generatedBodies.set(name, adaptT3Contract(name, source));
}
const index = fs.readFileSync(path.join(vendorSrc, "index.ts"), "utf8").split("\n").filter((line) => !line.includes('"./environmentHttp.ts"')).join("\n");
generatedBodies.set("index.ts", index);
generatedBodies.set(
  "methodTags.ts",
  extractConstBlock(generatedBodies.get("orchestration.ts"), "ORCHESTRATION_WS_METHODS") +
    "\n\n" +
    extractConstBlock(generatedBodies.get("rpc.ts"), "WS_METHODS") +
    "\n",
);

let existingManifest = null;
const manifestPath = path.join(destRoot, "SYNC_MANIFEST.json");
if (fs.existsSync(manifestPath)) {
  try {
    existingManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    existingManifest = null;
  }
}
const previousContractPin =
  typeof existingManifest?.pin === "string" && /^[0-9a-f]{40}$/.test(existingManifest.pin)
    ? existingManifest.pin
    : null;
const previousBanner = previousContractPin
  ? `/** @generated from vendor/t3code/packages/contracts @ ${previousContractPin}; run scripts/vendor/sync-t3-contracts.mjs */\n`
  : null;
const bodiesStillMatch = previousBanner !== null && [...generatedBodies].every(([name, body]) => {
  const target = path.join(destRoot, name);
  return fs.existsSync(target) && fs.readFileSync(target, "utf8") === previousBanner + body;
});
const metadataStillMatches =
  existingManifest?.adaptation === adaptation &&
  arraysEqual(existingManifest?.copied, copied) &&
  arraysEqual(existingManifest?.excluded, [...excluded].sort()) &&
  recordsEqual(existingManifest?.sourceHashes, sourceHashes);

// A server-only T3 repin should not churn every generated contract file. If the
// reviewed contract sources and their generated bodies are byte-identical, keep
// the revision that actually produced those files. The runtime/documented pin
// still advances independently and is validated above. Any contract source change
// makes this false and regenerates the complete set against the new T3 revision.
const generatedPin = bodiesStillMatch && metadataStillMatches ? previousContractPin : pin;
const banner = `/** @generated from vendor/t3code/packages/contracts @ ${generatedPin}; run scripts/vendor/sync-t3-contracts.mjs */\n`;
const files = new Map(
  [...generatedBodies].map(([name, body]) => [name, banner + body]),
);
files.set(
  "SYNC_MANIFEST.json",
  JSON.stringify(
    {
      pin: generatedPin,
      copied,
      excluded: [...excluded].sort(),
      adaptation,
      sourceHashes,
    },
    null,
    2,
  ) + "\n",
);

const existing = fs.existsSync(destRoot) ? fs.readdirSync(destRoot) : [];
const changed = [...files].filter(([name, body]) => !fs.existsSync(path.join(destRoot, name)) || fs.readFileSync(path.join(destRoot, name), "utf8") !== body).map(([name]) => name);
const removed = existing.filter((name) => !files.has(name));
if (check) {
  if (changed.length || removed.length) throw new Error(`T3 contracts differ: ${[...changed, ...removed.map((name) => "removed:" + name)].join(", ")}. Run bun scripts/vendor/sync-t3-contracts.mjs and review the diff.`);
} else {
  fs.mkdirSync(destRoot, { recursive: true });
  for (const name of changed) fs.writeFileSync(path.join(destRoot, name), files.get(name));
  for (const name of removed) fs.unlinkSync(path.join(destRoot, name));
}
console.log(`[sync-t3-contracts] ${check ? "verified" : "synced"} ${copied.length} files; runtime=${pin.slice(0, 8)} contracts=${generatedPin.slice(0, 8)}; ${changed.length} changed, ${removed.length} removed`);
