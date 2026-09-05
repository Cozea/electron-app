import assert from "node:assert/strict";
import { fork, execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exercise the installed native overlay in its own dependency graph and process.
// Controlled host decisions over inherited IPC; this does not test Convex authentication.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), "cozea-native-boundary-")));
const session = path.join(temporary, "session");
const ordinary = path.join(temporary, "ordinary");
for (const directory of [session, ordinary]) execFileSync("git", ["init", "-q", directory]);
let role = "observer";
const child = fork(path.join(root, "scripts/fixtures/native-workspace-boundary.mjs"), [session, ordinary], {
  env: { ...process.env, COZEA_NATIVE_WORKSPACE_AUTHORITY: "1" },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
let childExited = false;
const exited = new Promise(resolve => child.once("exit", (code, signal) => {
  childExited = true;
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`Native fixture exited: ${code ?? signal}`)); }
  pending.clear();
  resolve();
}));
child.on("error", error => {
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
  pending.clear();
});
async function waitForExit(milliseconds) {
  if (childExited) return true;
  let timer;
  try { return await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
let serial = 0;
const pending = new Map();
child.on("message", message => {
  if (message.type === "cozea:workspace-authorize") {
    const owned = message.cwd === session || message.cwd.startsWith(session + path.sep);
    child.send({ type: "cozea:workspace-authorize-result", requestId: message.requestId,
      allowed: !owned || (role === "editor" && message.operation !== "git"), sessionRoot: owned ? session : null });
  } else if (message.type === "result") {
    const waiter = pending.get(message.id);
    if (waiter) { pending.delete(message.id); clearTimeout(waiter.timer); waiter.resolve(message); }
  }
});
const request = (operation, cwd = session) => new Promise((resolve, reject) => {
  const id = ++serial;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native boundary timeout: ${operation}`)); }, 15_000);
  if (childExited || !child.connected) { clearTimeout(timer); reject(new Error("Native fixture is unavailable")); return; }
  pending.set(id, { resolve, reject, timer });
  child.send({ type: "test", id, operation, cwd });
});
let failure;
try {
  for (const state of ["observer", "revoked", "closed"]) {
    role = state;
    assert.equal((await request("provider")).ok, false, `${state} installed provider guard denied`);
    assert.equal((await request("rpc")).ok, false, `${state} installed RPC guard denied`);
    assert.equal((await request("rpc", ordinary)).ok, true, "ordinary installed RPC guard remains usable");
  }
  role = "editor";
  assert.equal((await request("provider")).ok, true);
  assert.equal((await request("git")).ok, false, "generic Git mutation cannot bypass publication");
  assert.equal((await request("start")).ok, true);
  assert.equal((await request("start", ordinary)).ok, true);
  role = "observer";
  // The native authority poll must terminate the running owned turn itself.
  assert.equal((await request("await-stop")).ok, true);
  const active = await request("active");
  assert.deepEqual(active.paths, [ordinary], "unrelated running turn survives role removal");
  assert.equal((await request("provider")).ok, false);
  assert.equal((await request("rpc", ordinary)).ok, true);
  assert.equal(await readFile(path.join(ordinary, "boundary.txt"), "utf8"), "accepted");
  console.log("Installed guard/IPC smoke: controlled authority denial, owned-turn polling stop, and ordinary workspace writes passed.");
} catch (error) {
  failure = error;
} finally {
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
  if (!childExited) child.kill("SIGTERM");
  if (!(await waitForExit(3_000))) {
    child.kill("SIGKILL");
    if (!(await waitForExit(3_000))) {
      const error = new Error("Native fixture termination was not confirmed");
      failure = failure ? new AggregateError([failure, error], "Native boundary and cleanup failed") : error;
    }
  }
  await rm(temporary, { recursive: true, force: true });
}

if (failure) throw failure;
