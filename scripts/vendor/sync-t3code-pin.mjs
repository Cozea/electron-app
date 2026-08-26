#!/usr/bin/env node
/**
 * Checkout vendor/t3code at the pin recorded in docs/substrate-t3-pin.md
 * and electron/substrate/constants.ts (SUBSTRATE_T3_PIN_SHA).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vendorRoot = path.join(root, "vendor/t3code");
const pinFile = path.join(root, "docs/substrate-t3-pin.md");

function readPinSha() {
  const fromDoc = fs.readFileSync(pinFile, "utf8").match(/`([0-9a-f]{40})`/);
  if (fromDoc?.[1]) return fromDoc[1];
  throw new Error(`Could not read pin SHA from ${pinFile}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? vendorRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return (result.stdout ?? "").trim();
}

function main() {
  if (!fs.existsSync(path.join(vendorRoot, ".git"))) {
    throw new Error(`Missing submodule at ${vendorRoot}. Run: git submodule update --init vendor/t3code`);
  }

  const pin = readPinSha();
  run("git", ["fetch", "origin", "--depth", "1", pin], { cwd: vendorRoot });
  run("git", ["checkout", "--detach", pin], { cwd: vendorRoot });

  const current = run("git", ["rev-parse", "HEAD"], { cwd: vendorRoot });
  if (current !== pin) {
    throw new Error(`vendor/t3code checkout mismatch: expected ${pin}, got ${current}`);
  }

  console.log(`[sync-t3code-pin] vendor/t3code @ ${current.slice(0, 8)}`);
}

main();
