import { readFileSync, writeFileSync } from "node:fs";

// The publication transform moves discarded-state validation before manifest
// recovery. Remove the old, now-unreachable guard rather than relaxing TS2367.
const filename = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
const source = readFileSync(filename, "utf8");
const guard = '    if (prepared.state === "discarded") throw new Error("This prepared commit was discarded")\n';
const recovery = '    try { return await this.coordinator.pushPrepared(sessionId, await this.gateway.accessToken()) } catch { /* Reauthorize the exact prepared identity below. */ }\n';
const anchor = recovery + guard;
if (source.split(guard).length !== 3 || source.split(anchor).length !== 2) {
  throw new Error("Publication guard structure changed; inspect before applying this candidate");
}
writeFileSync(filename, source.replace(anchor, recovery));
