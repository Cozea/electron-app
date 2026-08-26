import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Upstream effect-smol bug: decodeJsonRpcMessage drops zero-valued JSON-RPC ids
// (`decoded.id ? ... : ""`), so an inbound request with `id: 0` is routed as a
// notification and never answered. ACP peers (e.g. Cursor's agent) may number
// requests from 0, which would leave their first request hanging forever.
// Guarded by tests/packages/effect-acp/src/protocol.test.ts
// ("preserves zero-valued ids for inbound core client requests").
const TARGETS = [
  "node_modules/effect/dist/unstable/rpc/RpcSerialization.js",
];

const ORIGINAL_SNIPPET = 'id: decoded.id ? String(decoded.id) : "",';

const PATCHED_SNIPPET =
  'id: decoded.id !== undefined && decoded.id !== null ? String(decoded.id) : "",';

function patchFile(targetPath) {
  if (!existsSync(targetPath)) {
    return;
  }

  const source = readFileSync(targetPath, "utf8");
  if (source.includes(PATCHED_SNIPPET)) {
    return;
  }
  if (!source.includes(ORIGINAL_SNIPPET)) {
    throw new Error(`effect RpcSerialization patch anchor not found in ${targetPath}`);
  }
  writeFileSync(targetPath, source.replace(ORIGINAL_SNIPPET, PATCHED_SNIPPET));
}

for (const relativeTarget of TARGETS) {
  patchFile(path.resolve(process.cwd(), relativeTarget));
}
