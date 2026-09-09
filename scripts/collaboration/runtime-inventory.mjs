import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

// Deliberately records versions and immutable input identities, not environment
// variables, absolute workspace paths, credentials or source contents.
const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const db = new DatabaseSync(":memory:");
let sqlite;
try { sqlite = db.prepare("SELECT sqlite_version() AS version").get().version; }
finally { db.close(); }
const inventory = {
  schema: 1,
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  os: process.platform,
  arch: process.arch,
  node: process.versions.node,
  sqlite,
  electronPackage: pkg.devDependencies.electron,
  yjsPackage: pkg.dependencies.yjs,
  lockSha256: createHash("sha256").update(readFileSync(path.join(root, "bun.lock"))).digest("hex"),
  capturedAt: new Date().toISOString(),
};
const output = path.join(root, ".agent", "collaboration-evidence");
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, "runtime.json"), JSON.stringify(inventory, null, 2) + "\n");
console.log(JSON.stringify(inventory, null, 2));
