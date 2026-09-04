import type { DevAppPreviewStatus } from "@shared/devAppPreviewTypes";

export interface DevAppPreviewRuntimeSnapshot {
  readonly tileId: string;
  readonly relativePath: string;
  readonly status: DevAppPreviewStatus | null;
  readonly hotReload: boolean;
  readonly openError: string | null;
}

interface OwnedDevAppPreviewRuntimeSnapshot {
  readonly owner: symbol;
  readonly snapshot: DevAppPreviewRuntimeSnapshot;
}

interface DevAppPreviewRuntime {
  readonly byTileId: Map<string, OwnedDevAppPreviewRuntimeSnapshot>;
}

const RUNTIME_KEY = Symbol.for("cozea.devAppPreviewRuntime");
const runtimeHost = globalThis as { [RUNTIME_KEY]?: DevAppPreviewRuntime };
const runtime: DevAppPreviewRuntime = (runtimeHost[RUNTIME_KEY] ??= {
  byTileId: new Map(),
});

export function publishDevAppPreviewRuntime(
  owner: symbol,
  snapshot: DevAppPreviewRuntimeSnapshot,
): void {
  runtime.byTileId.set(snapshot.tileId, { owner, snapshot });
}

export function releaseDevAppPreviewRuntime(owner: symbol, tileId: string): void {
  if (runtime.byTileId.get(tileId)?.owner === owner) {
    runtime.byTileId.delete(tileId);
  }
}

export function readDevAppPreviewRuntime(tileId: string): DevAppPreviewRuntimeSnapshot | null {
  return runtime.byTileId.get(tileId)?.snapshot ?? null;
}

export function clearDevAppPreviewRuntimeForTests(): void {
  runtime.byTileId.clear();
}
