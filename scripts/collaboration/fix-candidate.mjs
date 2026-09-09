import { readFileSync, writeFileSync } from "node:fs";
function change(path, from, to) {
  const source = readFileSync(path, "utf8");
  if (source.split(from).length !== 2) throw new Error("Expected exact continuation anchor: " + path + ": " + from.slice(0, 100));
  writeFileSync(path, source.replace(from, to));
}
const host = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
change(host, '  async retry(sessionId: string): Promise<void> {\n    const hosted', `  async retry(sessionId: string): Promise<void> {
    if (this.shuttingDown || this.departing.has(sessionId)) throw new Error("Session exit is in progress")
    const restarting = this.restarting.get(sessionId)
    if (restarting) { await restarting; return }
    await this.suspending.get(sessionId)
    if (this.shuttingDown || this.departing.has(sessionId)) throw new Error("Session exit is in progress")
    const hosted`);
const tests = "tests/collaboration/lifecycleAdmission.test.ts";
change(tests, 'mockImplementation(async operation => { f.events.push(operation); return null })', 'mockImplementation(async <T>(operation: string) => { f.events.push(operation); return null as T })');
change(tests, '  it("single-flights repeated Leave requests",', `  it("rejects retry while Leave or Quit is draining accepted work", async () => {
    const f = fixture(), saved = deferred()
    const accepted = f.host.withRuntime("session", () => saved.promise)
    const leaving = f.host.leave("session", false)
    await expect(f.surface.runtime.retry("session")).rejects.toThrow("exit")
    saved.resolve(); await accepted; await leaving
    const other = fixture(), second = deferred()
    const edit = other.host.withRuntime("session", () => second.promise)
    const quit = other.host.shutdown()
    await expect(other.surface.runtime.retry("session")).rejects.toThrow("exit")
    second.resolve(); await edit; await quit
  })

  it("host adoption derives protection from its canonical runtime", async () => {
    const f = fixture()
    Reflect.set(f.host, "gateway", {
      post: async () => ({ session: { publishedThroughSequence: 12 } }),
      accessToken: async () => "trusted-main-token",
    })
    await f.surface.legacy.adoptPublished({ sessionId: "session", accessToken: "renderer-token", sharedPaths: ["forged.ts"] })
    expect(f.runtime.waitForSequence).toHaveBeenCalledWith(12)
    expect(f.coordinator.adoptPublished).toHaveBeenCalledWith("session", "trusted-main-token", ["live.ts", "old.ts"])
    expect(f.runtime.checkpointPublished).toHaveBeenCalledWith(12)
  })

  it("single-flights repeated Leave requests",`);
const ledger = "docs/collaboration/refactor-progress.md";
change(ledger, '| P2 | In progress: immutable publication baselines, retained prepared captures, repeated Git cycles; safe compaction still to implement |', '| P2 | Publication manifests and checkpoint-covered compaction committed and regression-tested; full release matrix remains open |');
change(ledger, '| P3 | Not implemented: off-main owner and complete lifecycle surface |', '| P3 | In progress: admitted mutation surface and drainable lifecycle; utility-process owner and packaged epoch/crash tests remain |');
console.log("Applied checked retry/adoption continuations and updated phase ledger.");
