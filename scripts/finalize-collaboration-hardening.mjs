#!/usr/bin/env node
// One-time, exact-anchor finalization in an isolated CI checkout. Removed from
// the final commit together with the task's temporary write-capable workflows.
import fs from "node:fs";
const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one finalization anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}
const overlay = "scripts/patch-t3-workspace-authority.mjs";
replace(overlay, 'import ts from "typescript";', 'import ts from "typescript";\nimport { patchNonresurrectingInterrupt, patchStoppedInterruptRegression } from "./patch-t3-stopped-interrupt.mjs";');
replace(overlay, 'function patchProvider(source) {\n  const { node, expression, file }', 'function patchProvider(source) {\n  source = patchNonresurrectingInterrupt(source);\n  const { node, expression, file }');
replace(overlay, 'const names = ["startSession", "sendTurn", "compactThread", "respondToRequest", "respondToUserInput", "rollbackConversation"];', 'const names = ["startSession", "sendTurn", "compactThread", "respondToRequest", "respondToUserInput", "rollbackConversation", "uploadFeedback"];');
replace(overlay, '  ["apps/server/src/provider/Layers/ProviderService.ts", patchProvider],', '  ["apps/server/src/provider/Layers/ProviderService.ts", patchProvider],\n  ["apps/server/src/provider/Layers/ProviderService.test.ts", patchStoppedInterruptRegression],');

const agents = "AGENTS.md";
replace(agents, 'See `docs/collaboration-v2-completion.md` for the implementation status, remaining release blockers and acceptance gate.', `- Native provider, terminal and mutating RPC authority is installed by the maintained source overlay in \`scripts/patch-t3-workspace-authority.mjs\`. Preserve its digest receipt and fail on independently changed vendor files; do not bypass it or repin the fork to hide overlay drift. Feedback upload is execution-capable because it can recover a provider; interrupt must never recover a stopped provider.
- Collaboration editor updates awaiting durable IPC acceptance veto renderer unload. Application recovery shutdown runs at \`will-quit\`, after renderer unload consent and before catalog/native disposal. Stop must await admitted receive/file/checkpoint work; a sent process signal is not exit confirmation.
- Prepared-commit review reads immutable Git objects. Push carries the reviewed SHA; selected publisher binaries carry hashes of exact bytes, executable mode and deletion state. Do not restore the deprecated renderer-selected commit/push bypasses.
- Recovery-store/projection allocations use bounded aggregate admission rather than eviction. Explicit cleanup authenticates the exact replacement checkpoint and removes only covered receive-log records. Pending sends, editor ingress, sealed keys, prepared objects, unknown temporary files, workspaces and retained backups are not cleanup targets.

See \`docs/collaboration-v2-completion.md\` for status and release blockers, and \`docs/collaboration-v2-pr-handoff.md\` for the continuation's verification and remaining work.`);
const release = "docs/release-process.md";
const releaseNote = `

## Collaboration-safe quit and update verification

Renderer collaboration queues veto window unload while edits are awaiting durable
main-process acceptance. Do not override Electron's \`will-prevent-unload\` event.
Cancelable \`before-quit\` must not dispose the collaboration host, workspace
catalog, or native runtime. Once all windows accept unload, \`will-quit\` first
awaits session recovery and scoped native shutdown, then disposes the remaining
owners. Failed preparation retains recovery and exposes a retry; partial disposal
is retried without preparing an already disposed host again.

Native Stop/Interrupt remains available after role removal, but Interrupt must
not recover or launch an inactive provider. Shutdown acknowledges actual child
exit and drains in-flight encrypted receive callbacks before releasing storage.
Unrelated workspaces are not part of a session-scoped stop. The maintained T3
source overlay is required in fresh and packaged runtime preparation.

The existing controlled-update continuation contract still requires packaged
verification with this quit ordering. A green Linux build is not an installer or
macOS/Windows lifecycle acceptance result. Run cancel-close, failed persistence,
failed native stop, last-window-close, ordinary Quit, update preparation and
failed-update-handoff scenarios on the packaged candidate. Keep both GitHub
collaboration release gates disabled until all code blockers in
\`collaboration-v2-completion.md\` and the deployed two-device matrix are closed.
`;
if (!fs.readFileSync(release, "utf8").includes("## Collaboration-safe quit and update verification")) edits.set(release, fs.readFileSync(release, "utf8") + releaseNote);
const completion = "docs/collaboration-v2-completion.md";
replace(completion,
 'Status: implementation in progress on `codex/collaboration-v2-complete`, with PR #141 integrated in local checkpoint `41b7b17b`. The branch also reconciles committed main `bbf9ceab`, including provider fork `f2df43a98`. This branch is not ready to deploy or expose as a completed collaboration release.\n\nThe user requested stopping implementation and handing off the committed branch. Start with `docs/collaboration-v2-handoff.md`.',
 'Status (2026-09-05): the continuation from `2d861c60` implements native-authority, shutdown, immutable commit-review and bounded local-recovery hardening on `codex/collaboration-v2-complete`. The original PR #141 foundations and provider pin `f2df43a98` are retained. This is not a completed collaboration release; remaining code blockers are listed below, separately from packaged acceptance.\n\nThe user authorized all feasible continuation work and will perform final packaged two-device testing. Read `docs/collaboration-v2-pr-handoff.md` first. Both release gates remain disabled; no deployment, collaboration reset or release has been performed by this continuation.');
const oldGaps = `## Remaining implementation and acceptance gaps

1. Enforce collaboration authority at the native T3 provider/RPC boundary and stop running agents on role removal or exit. The current workspace IPC policy alone does not cover native T3 agent commands; do not enable the release until this is closed.
2. Finish external CLI rename identity reconciliation and the concurrent edit/delete/path-collision matrix. Add whole-window close protection for renderer edits awaiting IPC acceptance. Complete the reviewed prepared-commit diff and binary selection UI.
3. Complete automatic recovery for an unacknowledged lazy file initializer when key rotation replaces its lease. Pending records are currently retained with a recoverable diagnostic. Validate complete host-level rotation with an offline participant and repeated removals.
4. Bound total retained storage across key versions and checkpoint history, and add explicit catalog-owned cleanup. Finish content-free diagnostics and target-branch-advancement UI. Ensure runtime restart failures and authorization failures preserve visible retry/leave controls.
5. Validate GitHub OAuth and configure/activate signed webhooks with the compatible gateway. Produce bounded generation-reset inventories for Convex, rooms and local caches, and execute only collaboration-owned entries.
6. Run the entire behavioral matrix and standard checks, deploy Convex using \`bunx convex deploy\`, then the compatible gateway and desktop. Complete two independently authenticated packaged instances against production, including fresh checkout, offline restart, exact publication and compaction recovery.`;
const newGaps = `## Continuation hardening implemented

- Native provider, terminal and mutating T3 RPC admission derives workspace authority through inherited main-process IPC, canonical catalog paths and fresh server membership. Revocation fences late admissions, drains admitted actions and stops only matching resource owners. Provider feedback upload is guarded; interrupting an inactive provider does not restart it. The native source overlay preserves unrelated fork edits with a digest receipt.
- Child shutdown awaits real exit, escalates when required and reports unconfirmed termination. Editor IPC queues block whole-window unload until durable acceptance. Application recovery preparation happens after renderer unload consent and before catalog/native disposal; partially stopped hosts remain safely retryable.
- Transport shutdown fences socket callbacks, drains recovery/incoming/outgoing work and waits for runtime file/checkpoint/projection producers before the final store flush. A real full-suite observer-recovery teardown race led to this fix; it was not hidden with test retries.
- Prepared review reads immutable Git objects, verifies ancestry, displays text/binary changes and binds Push to the exact reviewed SHA. Explicit binary selection binds bytes, executable mode and deletions, with checks during preparation. Ordinary text cannot bypass the shared barrier through binary selection. Deprecated direct prepare/push IPC paths reject bypasses.
- Recovery-store writes and projection allocations have 1 GiB aggregate admission and 256 MiB per-room store admission across key versions, counting existing temporary files and backups. Independent store handles serialize identity checks and mutation. Metadata-only inventory and catalog-associated cleanup authenticate a replacement checkpoint before removing at most 256 covered receive-log records per key per call. Unpublished records, keys, prepared commits, workspaces and backups are retained.

## Remaining implementation and acceptance gaps

1. Complete automatic replay for an unacknowledged lazy file initializer whose lease is replaced during key rotation. Existing code deliberately retains the source ciphertext and reports a recoverable diagnostic. Complete whole-host offline/lost-reply/repeated-removal rotation coverage.
2. Finish external CLI rename identity reconciliation and the complete concurrent edit/delete/path-collision matrix. Explicit shared rename operations already retain stable identities; arbitrary external rename detection is not complete.
3. Finish target-branch-advancement controls and the full restart/authorization-failure UI matrix. Host retry/shutdown handling is improved, not a substitute for all required user flows.
4. Complete room/checkpoint-history and sealed-key-history retention policy, plus the broader collaboration-only reset inventory. Local store/projection quotas and conservative covered-log cleanup are implemented; they are not a complete cross-service garbage collector or an implemented alpha reset.
5. Validate GitHub OAuth and configure/activate signed webhooks with the compatible gateway using deployment-owner credentials. No OAuth browser acceptance, webhook activation, Convex deployment, gateway deployment or reset was performed here.
6. After code blockers and restricted acceptance setup are ready, run the complete deployed packaged workflow with two independently authenticated devices, including a fresh checkout, offline/restart recovery, exact publication, base adoption, quota handling and compaction. Preserve identities, projects, chats, ordinary folders, Git history and unpublished recovery. Use only \`bunx convex deploy\` for approved Convex production deployment, never a development deployment.`;
replace(completion, oldGaps, newGaps);
replace(completion, '## GitHub App setup state', '## GitHub App setup state (historical credential handoff; not revalidated by this continuation)');
replace(completion, 'Only secrets on the existing gateway, the GitHub callback, and the approved installation permission changed. No application source deployment, Convex deployment, alpha reset, commit or push has occurred.', 'During the original credential setup, only gateway secrets, the GitHub callback and the approved installation permission changed. This continuation has committed and pushed source hardening, but has not deployed the application/Convex/gateway, changed credentials, activated webhooks or performed an alpha reset.');
replace(completion, '## Environment and verification', '## Original implementation environment and baseline verification');
const handoff = "docs/collaboration-v2-handoff.md";
replace(handoff, '# GitHub collaboration implementation handoff\n', '# GitHub collaboration implementation handoff\n\n> Historical handoff at `2d861c60`. The subsequent continuation is documented in\n> `docs/collaboration-v2-pr-handoff.md`; use that and the updated completion document\n> for current code status. Both gates remain off and release-blocking work remains.\n');

const remove = [
  ".github/workflows/collaboration-completion-implementation.yml",
  "scripts/collaboration-completion-patch.mjs",
  "scripts/collaboration-native-integration.mjs",
  "scripts/collaboration-lifecycle-integration.mjs",
  "scripts/collaboration-review-integration.mjs",
  "scripts/collaboration-recovery-integration.mjs",
  "scripts/collaboration-drain-integration.mjs",
  ".github/workflows/collaboration-hardening-finalize.yml",
  "scripts/finalize-collaboration-hardening.mjs",
];
for (const file of edits.keys()) console.log(`update ${file}`);
for (const file of remove) console.log(`remove temporary task file ${file}`);
if (!process.argv.includes("--check")) {
  for (const [file, content] of edits) fs.writeFileSync(file, content);
  for (const file of remove) fs.rmSync(file, { force: true });
}
