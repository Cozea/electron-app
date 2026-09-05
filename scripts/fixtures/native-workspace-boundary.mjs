import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const native = path.join(root, "vendor/t3code/apps/server");
const requireNative = createRequire(path.join(native, "package.json"));
const Effect = await import(pathToFileURL(requireNative.resolve("effect/Effect")));
const { guardNativeProviderEffect, guardNativeRpcEffect, bindNativeProviderStopper } = await import(pathToFileURL(path.join(native, "src/cozeaWorkspaceEffects.ts")));
const { bindNativeWorkspaceStopper } = await import(pathToFileURL(path.join(native, "src/cozeaWorkspaceControl.ts")));
const running = new Map();
const stopped = new Map();
bindNativeWorkspaceStopper("terminals", async () => {});
bindNativeProviderStopper({
  list: async () => [...running].map(([cwd]) => ({ threadId: cwd, cwd, status: "running" })),
  lookup: async id => id,
  stop: async id => { running.get(id)?.(); running.delete(id); stopped.get(id)?.(); },
});
process.on("message", async message => {
  if (message.type !== "test") return;
  const { id, cwd, operation } = message;
  try {
    const write = Effect.promise(() => writeFile(path.join(cwd, "boundary.txt"), "accepted"));
    const provider = effect => guardNativeProviderEffect([{ threadId: cwd, cwd }], async () => cwd, cwd, effect);
    const lookup = { thread: async () => cwd, project: async () => cwd };
    if (operation === "provider") await Effect.runPromise(provider(write));
    else if (operation === "rpc" || operation === "git") {
      await Effect.runPromise(guardNativeRpcEffect(operation === "git" ? "git.runStackedAction" : "projects.writeFile", { cwd }, lookup, "write", write));
    } else if (operation === "start") {
      let started;
      const ready = new Promise(resolve => { started = resolve; });
      const turn = Effect.runPromise(provider(Effect.promise(() => new Promise(resolve => {
        running.set(cwd, resolve); started();
      }))));
      await Promise.race([ready, turn]);
      void turn.catch(() => {});
    } else if (operation === "await-stop") {
      if (running.has(cwd)) await new Promise(resolve => stopped.set(cwd, resolve));
    } else if (operation === "active") {
      process.send({ type: "result", id, ok: true, paths: [...running.keys()] });
      return;
    } else throw new Error("Unknown operation");
    process.send({ type: "result", id, ok: true });
  } catch {
    process.send({ type: "result", id, ok: false });
  }
});
