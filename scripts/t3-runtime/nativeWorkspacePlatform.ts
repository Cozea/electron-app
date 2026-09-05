import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/** Native platform services for the shared admission kernel. Use the pinned
 * server's Effect services, independently of the desktop Effect installation. */
export const nativeWorkspacePath = Effect.runSync(Path.Path.pipe(Effect.provide(NodePath.layer)));
const filesystem = Effect.runSync(FileSystem.FileSystem.pipe(Effect.provide(NodeFileSystem.layer)));

export function canonicalizeNativeWorkspacePath(cwd: string): Promise<string> {
  return Effect.runPromise(filesystem.realPath(cwd));
}

export function scheduleNativeWorkspaceDeadline(milliseconds: number, callback: () => void): () => void {
  const fiber = Effect.runFork(Effect.sleep(milliseconds).pipe(Effect.andThen(Effect.sync(callback))));
  return () => { void Effect.runPromise(Fiber.interrupt(fiber)); };
}

export function repeatNativeWorkspaceTask(milliseconds: number, task: () => Promise<void>): () => void {
  const fiber = Effect.runFork(Effect.forever(
    Effect.sleep(milliseconds).pipe(Effect.andThen(Effect.promise(task)), Effect.catchCause(() => Effect.void)),
  ));
  return () => { void Effect.runPromise(Fiber.interrupt(fiber)); };
}
