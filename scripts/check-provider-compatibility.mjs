#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "shared/provider-compatibility.json"), "utf8"),
);
const pin = git("ls-files", "--stage", "vendor/t3code").split(/\s+/)[1];
if (manifest.schemaVersion !== 1 || manifest.adapterRevision !== pin)
  throw new Error("Provider compatibility manifest must match the reviewed T3 gitlink.");
for (const driver of ["codex", "claudeAgent", "cursor", "opencode", "antigravity"]) {
  const entries = manifest.providers.filter((entry) => entry.driver === driver);
  if (
    entries.length !== 1 ||
    entries[0].adapterRevision !== pin ||
    !Array.isArray(entries[0].testedRuntimeVersions)
  )
    throw new Error(`Invalid compatibility record for ${driver}`);
}
execFileSync(process.execPath, ["scripts/vendor/sync-t3-contracts.mjs", "--check"], {
  cwd: root,
  stdio: "inherit",
});
// Use the frozen pre-integration parent rather than a moving main branch. New
// files are included so uncommitted suppressions also fail local checks.
const baseline = "4aa413be";
const files = git("ls-files", "--cached", "--others", "--exclude-standard")
  .split("\n")
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file));
for (const file of files) {
  if (!fs.existsSync(path.join(root, file))) continue;
  const current = fs.readFileSync(path.join(root, file), "utf8");
  const count = (text) => (text.match(/^\s*\/\/\s*@ts-nocheck\b/gm) ?? []).length;
  if (!count(current)) continue;
  let original = "";
  try {
    original = git("show", `${baseline}:${file}`);
  } catch {
    /* new file */
  }
  if (count(current) > count(original)) throw new Error(`New type-check suppression: ${file}`);
}
console.log(
  `[provider-compatibility] Manifest, contracts, pin and type-check suppression inventory agree at ${pin.slice(0, 9)}.`,
);
