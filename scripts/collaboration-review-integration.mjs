#!/usr/bin/env node
// Temporary isolated-checkout integration driver; remove after verified source is committed.
import fs from "node:fs";
const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one commit-review anchor in ${file}: ${before.slice(0, 60)}`);
  edits.set(file, source.replace(before, after));
}
const desktop = "shared/collaborationDesktop.ts";
replace(desktop, 'import type { LocalWorkspaceDTO } from "./workspaceTypes"', 'import type { LocalWorkspaceDTO } from "./workspaceTypes"\nimport type { CollaborationBinarySelection } from "./collaborationCommitReview"');
replace(desktop, "  binaryPaths: string[]", "  binaryPaths: string[]\n  binaryReviews?: CollaborationBinarySelection[]");
const runtime = "shared/collaborationRuntime.ts";
replace(runtime, 'import type { PreparedCollaborationCommit } from "./collaborationDesktop"', 'import type { PreparedCollaborationCommit } from "./collaborationDesktop"\nimport type { CollaborationBinaryCandidate, CollaborationBinarySelection, CollaborationPreparedReview } from "./collaborationCommitReview"');
replace(runtime, "  commit(input: { sessionId: string; binaryPaths: string[]; message:", "  binaryCandidates(sessionId: string): Promise<CollaborationBinaryCandidate[]>\n  reviewPrepared(input: { sessionId: string; commitSha: string }): Promise<CollaborationPreparedReview>\n  commit(input: { sessionId: string; binaryPaths: string[]; binaryReviews?: CollaborationBinarySelection[]; message:");
replace(runtime, "  push(sessionId: string): Promise<PreparedCollaborationCommit>", "  push(input: { sessionId: string; commitSha: string }): Promise<PreparedCollaborationCommit>");
const coordinator = "apps/desktop/electron/collaboration/SessionWorkspaceCoordinator.ts";
replace(coordinator, 'import { createHash } from "node:crypto"', 'import { createHash } from "node:crypto"\nimport { binaryReviewHash, isSharedTextBytes } from "./binaryReview"\nimport { parsePreparedNumstat, type CollaborationBinaryCandidate, type CollaborationPreparedReview } from "../../../../shared/collaborationCommitReview"');
replace(coordinator, "  private async saveBinding(binding: SessionWorkspaceBinding): Promise<void> {", `  async inspectBinaryCandidates(sessionId: string): Promise<CollaborationBinaryCandidate[]> {
    const binding = await this.getBinding(sessionId)
    if (!binding) throw new Error("Session workspace is unavailable")
    const workspace = await this.workspace(binding)
    const result: CollaborationBinaryCandidate[] = []
    for (const relative of await this.changedPaths(sessionId)) {
      assertCollaborationPath(relative)
      const buffer = await this.readRegularFile(workspace.projectRootPath, relative)
      const entry = await this.git(workspace.projectRootPath, ["ls-tree", "-z", binding.baseCommitSha, "--", relative])
      let baseBinary = false
      if (entry) {
        const match = /^(100644|100755) blob ([a-f0-9]{40})\\t/.exec(entry)
        if (!match) continue // Submodules and symlinks are never publisher binaries.
        const size = Number((await this.git(workspace.projectRootPath, ["cat-file", "-s", match[2]!])).trim())
        if (!Number.isSafeInteger(size) || size < 0) throw new Error("Git file size is invalid")
        baseBinary = size > MAX_TEXT_BYTES
        if (!baseBinary) {
          const base = await this.deps.git(["-c", "core.hooksPath=/dev/null", "cat-file", "blob", match[2]!], { cwd: workspace.projectRootPath, captureStdoutBytes: true, maxOutputBytes: MAX_TEXT_BYTES })
          if (!base.success || !base.stdoutBytes) throw new Error("Git binary review could not be read")
          baseBinary = !isSharedTextBytes(base.stdoutBytes)
        }
      }
      if (!baseBinary && (buffer === null || isSharedTextBytes(buffer))) continue
      const executable = buffer !== null && Boolean((await fs.stat(path.join(workspace.projectRootPath, relative))).mode & 0o111)
      result.push({ path: relative, bytes: buffer?.byteLength ?? 0, executable, reviewHash: binaryReviewHash(buffer, executable), change: buffer === null ? "deleted" : entry ? "modified" : "added" })
    }
    return result
  }

  /** Read immutable Git objects, never the evolving working tree or index. */
  async reviewPrepared(sessionId: string, commitSha: string): Promise<CollaborationPreparedReview> {
    assertGitCommitSha(commitSha)
    const prepared = await this.getPrepared(sessionId)
    if (!prepared || prepared.commitSha !== commitSha || prepared.state === "discarded") throw new Error("The prepared commit changed; review it again")
    const binding = await this.getBinding(sessionId)
    if (!binding) throw new Error("Session recovery is unavailable")
    const workspace = await this.workspace(binding)
    const parents = (await this.git(workspace.projectRootPath, ["rev-list", "--parents", "-n", "1", commitSha])).trim().split(/\\s+/)
    if (parents.length !== 2 || parents[0] !== commitSha || parents[1] !== prepared.parentCommitSha) throw new Error("Prepared commit ancestry is invalid")
    const diff = async (format: string[]) => {
      const output = await this.deps.git(["-c", "core.hooksPath=/dev/null", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", ...format, prepared.parentCommitSha, commitSha, "--"], { cwd: workspace.projectRootPath, maxOutputBytes: 8 * 1024 * 1024 })
      if (!output.success || Buffer.byteLength(output.stdout) > 8 * 1024 * 1024) throw new Error("Complete prepared review exceeds its safe display limit or could not be read; the commit remains retained")
      return output.stdout
    }
    const [summary, patch, message] = await Promise.all([
      diff(["--numstat", "-z"]), diff(["--patch", "--unified=3", "--src-prefix=a/", "--dst-prefix=b/"]),
      this.git(workspace.projectRootPath, ["show", "-s", "--format=%B", commitSha]),
    ])
    return { sessionId, commitSha, parentCommitSha: prepared.parentCommitSha, throughSequence: prepared.throughSequence, message: message.trimEnd(), files: parsePreparedNumstat(summary), patch }
  }

  private async saveBinding(binding: SessionWorkspaceBinding): Promise<void> {`);
replace(coordinator, `      await fs.mkdir(this.deps.scratchRoot, { recursive: true, mode: 0o700 })
      const scratch = await fs.mkdtemp(path.join(this.deps.scratchRoot, "commit-"))`, `      const binaryReviews = new Map((input.binaryReviews ?? []).map(item => [item.path, item.reviewHash]))
      if (binaryReviews.size !== input.binaryPaths.length || input.binaryPaths.some(relative => !/^[a-f0-9]{64}$/.test(binaryReviews.get(relative) ?? ""))) throw new Error("Review every selected binary before preparing the commit")
      const binaryCandidates = input.binaryPaths.length ? await this.inspectBinaryCandidates(input.sessionId) : []
      if (input.binaryPaths.some(relative => !binaryCandidates.some(candidate => candidate.path === relative && candidate.reviewHash === binaryReviews.get(relative)))) throw new Error("A selected binary changed or is not a Git-only candidate; review local binaries again")
      await fs.mkdir(this.deps.scratchRoot, { recursive: true, mode: 0o700 })
      const scratch = await fs.mkdtemp(path.join(this.deps.scratchRoot, "commit-"))`);
replace(coordinator, `        for (const relative of input.binaryPaths) {
          const buffer = await this.readRegularFile(workspace.projectRootPath, relative)
          if (!buffer) {`, `        for (const relative of input.binaryPaths) {
          const buffer = await this.readRegularFile(workspace.projectRootPath, relative)
          const executable = buffer !== null && Boolean((await fs.stat(path.join(workspace.projectRootPath, relative))).mode & 0o111)
          if (binaryReviewHash(buffer, executable) !== binaryReviews.get(relative)) throw new Error("A selected binary changed after review; review local binaries again")
          if (!buffer) {`);
replace(coordinator, '["update-index", "--add", "--cacheinfo", "100644", oid, relative]', '["update-index", "--add", "--cacheinfo", executable ? "100755" : "100644", oid, relative]');
const host = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
replace(host, 'import path from "node:path"', 'import path from "node:path"\nimport type { CollaborationBinarySelection } from "../../../../shared/collaborationCommitReview"');
replace(host, "async prepareCommit(input: { sessionId: string; binaryPaths: string[]; message:", "async prepareCommit(input: { sessionId: string; binaryPaths: string[]; binaryReviews?: CollaborationBinarySelection[]; message:");
replace(host, `  async push(sessionId: string): Promise<PreparedCollaborationCommit> {
    this.runtime(sessionId)
    const prepared = await this.coordinator.getPrepared(sessionId)
    if (!prepared) throw new Error("Prepare and review a commit first")`, `  async push(input: { sessionId: string; commitSha: string }): Promise<PreparedCollaborationCommit> {
    const { sessionId, commitSha } = input
    this.runtime(sessionId)
    const prepared = await this.coordinator.getPrepared(sessionId)
    if (!prepared || prepared.commitSha !== commitSha) throw new Error("The prepared commit changed; review the exact commit before pushing")`);
const handlers = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts";
replace(handlers, "      commit: input => host.prepareCommit(input),", "      binaryCandidates: id => coordinator.inspectBinaryCandidates(id),\n      reviewPrepared: input => coordinator.reviewPrepared(input.sessionId, input.commitSha),\n      commit: input => host.prepareCommit(input),");
replace(handlers, "    prepareCommit: input => coordinator.prepareCommit(input),", '    prepareCommit: async () => { throw new Error("Use the main-owned acknowledged shared snapshot commit action") },');
replace(handlers, "    pushPrepared: input => coordinator.pushPrepared(input.sessionId, input.accessToken),", '    pushPrepared: async () => { throw new Error("Review and push the exact prepared commit through the session runtime") },');
replace(handlers, '  ipcMain.handle("collaboration:runtimeCommit", authorized(api.runtime.commit))', '  ipcMain.handle("collaboration:runtimeBinaryCandidates", authorized(api.runtime.binaryCandidates))\n  ipcMain.handle("collaboration:runtimeReviewPrepared", authorized(api.runtime.reviewPrepared))\n  ipcMain.handle("collaboration:runtimeCommit", authorized(api.runtime.commit))');
const preload = "apps/desktop/electron/preload.ts";
replace(preload, '      commit: input => ipcRenderer.invoke("collaboration:runtimeCommit", input),', '      binaryCandidates: id => ipcRenderer.invoke("collaboration:runtimeBinaryCandidates", id),\n      reviewPrepared: input => ipcRenderer.invoke("collaboration:runtimeReviewPrepared", input),\n      commit: input => ipcRenderer.invoke("collaboration:runtimeCommit", input),');
const ui = "apps/desktop/src/features/collaboration/ProjectCollaborationControl.tsx";
replace(ui, 'import { SharedSessionEditor } from "./SharedSessionEditor"', 'import { SharedSessionEditor } from "./SharedSessionEditor"\nimport { CollaborationBinaryPicker } from "./CollaborationBinaryPicker"\nimport { CollaborationCommitReview } from "./CollaborationCommitReview"\nimport type { CollaborationBinarySelection } from "@shared/collaborationCommitReview"');
replace(ui, '  const [binaryPaths, setBinaryPaths] = useState("")', '  const [binarySelection, setBinarySelection] = useState<{ sessionId: string | null; files: CollaborationBinarySelection[] }>({ sessionId: null, files: [] })\n  const selectedBinaries = binarySelection.sessionId === sessionId ? binarySelection.files : []');
replace(ui, '            <Input aria-label="Binary files to include" placeholder="Optional local binary paths, separated by commas" value={binaryPaths} onChange={event => setBinaryPaths(event.target.value)} />', '            <CollaborationBinaryPicker key={sessionId} sessionId={sessionId} disabled={busy} value={selectedBinaries} onChange={files => setBinarySelection({ sessionId, files })} />');
replace(ui, 'binaryPaths: binaryPaths.split(",").map(value => value.trim()).filter(Boolean)', 'binaryPaths: selectedBinaries.map(file => file.path), binaryReviews: selectedBinaries');
replace(ui, '              {prepared && !["published", "discarded"].includes(prepared.state) && <><Button disabled={busy} onClick={() => void run(async () => { setPrepared(await api.push(sessionId)) })}>Push {prepared.commitSha.slice(0, 8)}</Button><Button variant="outline" disabled={busy} onClick={() => void run(() => api.discard(sessionId))}>Discard prepared commit</Button></>}', '              {prepared && !["published", "discarded"].includes(prepared.state) && <CollaborationCommitReview key={prepared.commitSha} sessionId={sessionId} prepared={prepared} disabled={busy} onPush={commitSha => void run(async () => { setPrepared(await api.push({ sessionId, commitSha })) })} onDiscard={() => void run(() => api.discard(sessionId))} />}');
replace(ui, '            <div className="flex gap-2"><Button disabled={busy || !message', '            <div className="space-y-3"><Button disabled={busy || !message');
const tests = "tests/collaboration/sessionWorkspaceCoordinator.test.ts";
replace(tests, 'import type { CollaborationWorkspaceAuthority } from "../../shared/collaborationDesktop"', 'import type { CollaborationWorkspaceAuthority, PrepareCollaborationCommitInput } from "../../shared/collaborationDesktop"');
replace(tests, 'function commitInput() {', 'function commitInput(): PrepareCollaborationCommitInput {');
replace(tests, 'new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {\n          let stdout = "", stderr = ""\n          child.stdout?.on("data", chunk => { stdout += chunk })', 'new Promise<{ stdout: string; stdoutBytes: Uint8Array; stderr: string }>((resolve, reject) => {\n          const chunks: Buffer[] = []\n          let stderr = ""\n          child.stdout?.on("data", chunk => { chunks.push(Buffer.from(chunk)) })');
replace(tests, 'resolve({ stdout, stderr })', 'resolve({ stdout: Buffer.concat(chunks).toString("utf8"), stdoutBytes: Buffer.concat(chunks), stderr })');
replace(tests, '    input.binaryPaths = ["selected.bin"]', '    input.binaryPaths = ["selected.bin"]\n    input.binaryReviews = (await coordinator.inspectBinaryCandidates("test-session")).filter(file => file.path === "selected.bin")');
replace(tests, 'import { assertCollaborationWorkspaceOperation } from "../../apps/desktop/electron/collaboration/workspacePolicy"', 'import { assertCollaborationWorkspaceOperation } from "../../apps/desktop/electron/collaboration/workspacePolicy"\nimport { binaryReviewHash } from "../../apps/desktop/electron/collaboration/binaryReview"');
const reviewCases = `

describe("immutable collaboration commit review", () => {
  it("reviews the prepared object after working files and the real index change", async () => {
    await prepare(); lease()
    const name = "image, final.bin"
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    const candidates = await coordinator.inspectBinaryCandidates("test-session")
    expect(candidates.map(file => file.path)).toEqual([name])
    const input = { ...commitInput(), binaryPaths: [name], binaryReviews: candidates }
    const prepared = await coordinator.prepareCommit(input)
    await fs.writeFile(path.join(target, "shared.txt"), "newer working text\\n")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 2]))
    await git(target, "add", "shared.txt")
    const indexBefore = await git(target, "write-tree")
    const review = await coordinator.reviewPrepared("test-session", prepared.commitSha)
    expect(review.commitSha).toBe(prepared.commitSha)
    expect(review.parentCommitSha).toBe(prepared.parentCommitSha)
    expect(review.throughSequence).toBe(5)
    expect(review.patch).toContain("+barrier")
    expect(review.patch).not.toContain("newer working text")
    expect(review.files.find(file => file.path === name)?.binary).toBe(true)
    expect(await git(target, "write-tree")).toBe(indexBefore)
    expect(await fs.readFile(path.join(target, name))).toEqual(Buffer.from([0, 255, 2]))
  })

  it("rejects bytes or executable bits changed since binary selection", async () => {
    await prepare(); lease()
    const name = "selected.bin"
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    await fs.chmod(path.join(target, name), 0o644)
    const reviewed = await coordinator.inspectBinaryCandidates("test-session")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 2]))
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: [name], binaryReviews: reviewed })).rejects.toThrow("review")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    await fs.chmod(path.join(target, name), 0o755)
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: [name], binaryReviews: reviewed })).rejects.toThrow("review")
    expect(await coordinator.getPrepared("test-session")).toBeNull()
    expect((await fs.stat(path.join(target, name))).mode & 0o111).not.toBe(0)
  })

  it("does not let a binary selection bypass the acknowledged text barrier", async () => {
    await prepare(); lease()
    const buffer = Buffer.from("unacknowledged publisher-only text\\n")
    await fs.writeFile(path.join(target, "unshared.txt"), buffer)
    const input = { ...commitInput(), binaryPaths: ["unshared.txt"], binaryReviews: [{ path: "unshared.txt", reviewHash: binaryReviewHash(buffer, false) }] }
    await expect(coordinator.prepareCommit(input)).rejects.toThrow("Git-only")
    expect(await coordinator.getPrepared("test-session")).toBeNull()
  })

  it("requires the exact prepared identity and never reviews discarded state", async () => {
    await prepare(); lease()
    const prepared = await coordinator.prepareCommit(commitInput())
    await expect(coordinator.reviewPrepared("test-session", "f".repeat(40))).rejects.toThrow("changed")
    await coordinator.discardPrepared("test-session", "token")
    await expect(coordinator.reviewPrepared("test-session", prepared.commitSha)).rejects.toThrow("changed")
  })
})
`;
const currentTests = edits.get(tests) ?? fs.readFileSync(tests, "utf8");
if (!currentTests.includes('describe("immutable collaboration commit review"')) edits.set(tests, currentTests + reviewCases);
for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}
