import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

// Exact, locally exercised P2 patch. This is a temporary CI execution adapter;
// only the separately tested Git tree is promoted by the connector.
const before = {
  "apps/desktop/electron/collaboration/CollaborationSessionRuntime.ts": "d11b9fec853f2db509cbccb720346a0a8fc52cfc",
  "apps/desktop/electron/collaboration/SessionCheckpointClient.ts": "22e200c2d22c8346b245e395c5aa3aa61dcd6229",
  "apps/desktop/electron/collaboration/SessionRuntimeHost.ts": "c13da5509be9203f9a5cb62e8aebfe943f541d63",
  "cloudflare/worker/src/durableObjects/CollabRoom.ts": "c4e995afc9895ff3f47e37ebda8731a8a322fe01",
  "cloudflare/worker/src/durableObjects/RoomCheckpointStore.ts": "23155a29390a3bed043a235d759f68c4c070910d",
  "cloudflare/worker/src/durableObjects/RoomUpdateChunks.ts": "895bb00358100f52e69b912a5d88af159f79760a",
  "cloudflare/worker/src/lib/collaborationLimits.ts": "dfa5815cd4607d1ae928bcc60d2f5c4e3c69de2c",
  "docs/collaboration/refactor-progress.md": "8a48faaa754b7f8b5c55165a6b24bd8e5e82f561",
  "shared/AcknowledgedCollaborationState.ts": "5c437833e39d2262115e1940e47bad708ca66b08",
  "shared/CollaborationTransport.ts": "e0da3a9c232b012a9a3e5932fcdd14cfb2418d9d",
  "shared/collaborationProtocol.ts": "0dcd3690c16c6fcc39f76892f952054d1a075e8e",
  "tests/collaboration/transportIntegration.test.ts": "8385b49b73c0384411ebf7656c0af6e0e1bb8615",
  "tests/collaboration/acknowledgedCapture.test.ts": null
};
const after = {
  "apps/desktop/electron/collaboration/CollaborationSessionRuntime.ts": "37685000e94d0658c2bb3cd42dd4e24880dde3b6",
  "apps/desktop/electron/collaboration/SessionCheckpointClient.ts": "f2e5e20755447453816c357925e962c8d3d62ecb",
  "apps/desktop/electron/collaboration/SessionRuntimeHost.ts": "e1b2429ce4fca49867f57520e5c66cf50d66af30",
  "cloudflare/worker/src/durableObjects/CollabRoom.ts": "4c4f05d04a73502c37272e115ab4f7022d1df750",
  "cloudflare/worker/src/durableObjects/RoomCheckpointStore.ts": "65a675bb13e78ccbca9d65a0429a52d44f74f55e",
  "cloudflare/worker/src/durableObjects/RoomUpdateChunks.ts": "4ae9976dab3a13fb5c4a4723324367954b9dd8bb",
  "cloudflare/worker/src/lib/collaborationLimits.ts": "c7bc0f9349b55d0a410b9c883182c1884f7e60d2",
  "docs/collaboration/refactor-progress.md": "b2cd29908e00879ffe771f147b117d3aac92b612",
  "shared/AcknowledgedCollaborationState.ts": "3191da617af0098ac6e24ca0eb1008ccc884cf40",
  "shared/CollaborationTransport.ts": "54155cb0faa0854c79641c0cf7bbf9a63020e9c4",
  "shared/collaborationProtocol.ts": "296927c1f927f8d3f9a8868d1bf76ca10dda02e9",
  "tests/collaboration/transportIntegration.test.ts": "2591e58a55b57badb466b76793768c08ac8fca46",
  "tests/collaboration/acknowledgedCapture.test.ts": "1b85db5c4ccdf13a1ac73311ec04a85732021a3b"
};
const compressed = Array.from({ length: 5 }, (_, index) => readFileSync(new URL(`./compaction.part${index}.b64`, import.meta.url), "utf8")).join("");
const patch = gunzipSync(Buffer.from(compressed, "base64"));
if (createHash("sha256").update(patch).digest("hex") !== "5705d674acd28c3bab5ce3110acc55a3b525228c915ce3626c4f6cc504543065") throw new Error("Candidate patch digest differs");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
for (const [path, sha] of Object.entries(before)) {
  if (sha === null ? existsSync(path) : !existsSync(path) || git("hash-object", path) !== sha) throw new Error(`Candidate preimage changed: ${path}`);
}
execFileSync("git", ["apply", "--check", "-"], { input: patch });
execFileSync("git", ["apply", "-"], { input: patch });
for (const [path, sha] of Object.entries(after)) if (git("hash-object", path) !== sha) throw new Error(`Candidate output differs: ${path}`);
mkdirSync(".agent", { recursive: true });
writeFileSync(".agent/collaboration-candidate.json", JSON.stringify({ paths: Object.keys(after), message: "refactor: compact canonical replay behind durable checkpoints" }));
console.log(`Prepared ${Object.keys(after).length} exact compaction changes.`);
