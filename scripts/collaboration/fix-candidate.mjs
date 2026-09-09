import { readFileSync, writeFileSync } from "node:fs";
const manifestPath = ".agent/collaboration-candidate.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const patch = (name, before, after) => {
  const source = readFileSync(name, "utf8");
  const at = source.indexOf(before);
  if (at < 0 || source.indexOf(before, at + before.length) >= 0) throw new Error(`Exact compatibility anchor changed: ${name}`);
  writeFileSync(name, source.slice(0, at) + after + source.slice(at + before.length));
  manifest.paths.push(name);
};
// Preserve the repository's erasableSyntaxOnly policy rather than weakening it.
patch("shared/collaborationProtocol.ts",
  '  constructor(readonly code: string, message: string, readonly status = 400, readonly recoverable = false, readonly retryAfterMs?: number) {\n    super(message)',
  '  readonly code: string\n  readonly status: number\n  readonly recoverable: boolean\n  readonly retryAfterMs?: number\n  constructor(code: string, message: string, status = 400, recoverable = false, retryAfterMs?: number) {\n    super(message)\n    this.code = code; this.status = status; this.recoverable = recoverable; this.retryAfterMs = retryAfterMs');
patch("cloudflare/worker/src/durableObjects/RoomCheckpointStore.ts",
  '  constructor(private readonly storage: RoomStorage, private readonly now: () => number = Date.now) {}',
  '  private readonly storage: RoomStorage\n  private readonly now: () => number\n  constructor(storage: RoomStorage, now: () => number = Date.now) { this.storage = storage; this.now = now }');
const room = "cloudflare/worker/src/durableObjects/CollabRoom.ts";
let source = readFileSync(room, "utf8");
const start = source.indexOf("  private async pruneThrough(");
const end = source.indexOf("  private async hydrateLegacyPresence(", start);
if (start < 0 || end < 0) throw new Error("Obsolete unsafe compactor anchor changed");
source = source.slice(0, start) + source.slice(end);
writeFileSync(room, source);
manifest.paths.push(room);
manifest.paths = [...new Set(manifest.paths)];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
