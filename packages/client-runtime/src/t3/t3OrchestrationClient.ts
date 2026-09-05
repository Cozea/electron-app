import { ORCHESTRATION_WS_METHODS, WS_METHODS } from "@cozea/contracts";
import type {
  AssetCreateUrlResult,
  AssetResource,
  OrchestrationShellSnapshot,
  OrchestrationShellStreamItem,
} from "@cozea/contracts/t3";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3OrchestrationClientOptions {
  readonly baseUrl: string;
  readonly wsTicket: string;
  readonly client?: T3EffectRpcClient;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function shellEventToDomainEvent(value: unknown): OrchestrationEvent | null {
  const record = asRecord(value);
  if (!record || typeof record.sequence !== "number" || typeof record.type !== "string") {
    return null;
  }
  return {
    sequence: record.sequence,
    ...(record as Record<string, unknown>),
  } as OrchestrationEvent;
}

/** Shell updates have sparse global sequences; they are not domain events. */
function applyShellStreamItem(
  current: OrchestrationShellSnapshot | null,
  item: OrchestrationShellStreamItem,
): OrchestrationShellSnapshot | null {
  if (item.kind === "snapshot") return item.snapshot;
  if (item.kind === "synchronized" || !current || item.sequence <= current.snapshotSequence)
    return current;
  switch (item.kind) {
    case "thread-upserted":
      return {
        ...current,
        snapshotSequence: item.sequence,
        updatedAt: item.thread.updatedAt,
        threads: upsertShellRow(current.threads, item.thread),
      };
    case "thread-removed":
      return {
        ...current,
        snapshotSequence: item.sequence,
        threads: current.threads.filter((thread) => thread.id !== item.threadId),
      };
    case "project-upserted":
      return {
        ...current,
        snapshotSequence: item.sequence,
        updatedAt: item.project.updatedAt,
        projects: upsertShellRow(current.projects, item.project),
      };
    case "project-removed":
      return {
        ...current,
        snapshotSequence: item.sequence,
        projects: current.projects.filter((project) => project.id !== item.projectId),
      };
    default:
      return current;
  }
}

function upsertShellRow<T extends { readonly id: string }>(
  rows: readonly T[],
  row: T,
): readonly T[] {
  return rows.some((entry) => entry.id === row.id)
    ? rows.map((entry) => (entry.id === row.id ? row : entry))
    : [...rows, row];
}

/** Native T3 Effect RPC orchestration client (Phase T2). */
export class T3OrchestrationClient {
  private readonly client: T3EffectRpcClient;
  private readonly ownsClient: boolean;
  private readonly requestTimeoutMs: number;
  private shellUnsubscribe: (() => Promise<void>) | null = null;
  private readonly shellListeners = new Set<(event: OrchestrationEvent) => void>();
  private readonly snapshotListeners = new Set<(snapshot: OrchestrationShellSnapshot) => void>();
  private shellSnapshot: OrchestrationShellSnapshot | null = null;
  private shellConnecting: Promise<void> | null = null;

  constructor(options: T3OrchestrationClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
    if (options.client) {
      this.client = options.client;
      this.ownsClient = false;
    } else {
      this.client = new T3EffectRpcClient({
        baseUrl: options.baseUrl,
        wsTicket: options.wsTicket,
        WebSocketImpl: options.WebSocketImpl,
        requestTimeoutMs: options.requestTimeoutMs,
      });
      this.ownsClient = true;
    }
  }

  async close(): Promise<void> {
    this.shellListeners.clear();
    this.snapshotListeners.clear();
    if (this.shellUnsubscribe) {
      await this.shellUnsubscribe();
      this.shellUnsubscribe = null;
    }
    if (this.ownsClient) {
      await this.client.close();
    }
  }

  async getArchivedShellSnapshot(): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, {});
  }

  async dispatchCommand(command: unknown): Promise<{ sequence: number }> {
    const result = await this.client.callUnary(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
    const record = asRecord(result);
    const sequence =
      record && typeof record.sequence === "number"
        ? record.sequence
        : record && typeof record.receiptSequence === "number"
          ? record.receiptSequence
          : 0;
    return { sequence };
  }

  async getTurnDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getTurnDiff, params);
  }

  async getFullThreadDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getFullThreadDiff, params);
  }

  async createAssetUrl(resource: AssetResource): Promise<AssetCreateUrlResult> {
    const result = asRecord(await this.client.callUnary(WS_METHODS.assetsCreateUrl, { resource }));
    if (!result || typeof result.relativeUrl !== "string" || typeof result.expiresAt !== "number") {
      throw new Error("T3 returned an invalid asset URL response");
    }
    return {
      relativeUrl: result.relativeUrl,
      expiresAt: result.expiresAt,
      ...(typeof result.sourcePath === "string" ? { sourcePath: result.sourcePath } : {}),
    };
  }

  async getSnapshot(): Promise<unknown> {
    let resolveSnapshot: (snapshot: unknown) => void = () => {};
    let rejectSnapshot: (error: Error) => void = () => {};
    const snapshotPromise = new Promise<unknown>((resolve, reject) => {
      resolveSnapshot = resolve;
      rejectSnapshot = reject;
    });
    const timeout = setTimeout(() => {
      rejectSnapshot(new Error(`T3 shell snapshot timed out after ${this.requestTimeoutMs}ms`));
    }, this.requestTimeoutMs);
    let unsubscribe: (() => Promise<void>) | null = null;

    try {
      unsubscribe = await this.client.openStream(
        ORCHESTRATION_WS_METHODS.subscribeShell,
        { requestCompletionMarker: true },
        (item) => {
          const row = asRecord(item);
          if (row?.kind !== "snapshot" || !row.snapshot) {
            return;
          }
          clearTimeout(timeout);
          resolveSnapshot(row.snapshot);
        },
        () => {
          clearTimeout(timeout);
          rejectSnapshot(new Error("T3 shell snapshot stream disconnected"));
        },
      );
      return await snapshotPromise;
    } finally {
      clearTimeout(timeout);
      await unsubscribe?.().catch(() => {});
    }
  }

  private async ensureShellSubscription(): Promise<void> {
    if (this.shellUnsubscribe) {
      return;
    }
    if (this.shellConnecting) return this.shellConnecting;
    this.shellConnecting = this.openShellSubscription();
    try {
      await this.shellConnecting;
    } finally {
      this.shellConnecting = null;
    }
  }

  private async openShellSubscription(): Promise<void> {
    this.shellUnsubscribe = await this.client.openStream(
      ORCHESTRATION_WS_METHODS.subscribeShell,
      { requestCompletionMarker: true },
      (item) => {
        const row = asRecord(item);
        if (!row || row.kind === "synchronized") {
          return;
        }
        const next = applyShellStreamItem(this.shellSnapshot, item as OrchestrationShellStreamItem);
        if (next !== this.shellSnapshot) {
          this.shellSnapshot = next;
          if (next) for (const listener of this.snapshotListeners) listener(next);
        }
        const mapped = shellEventToDomainEvent(row);
        if (!mapped) {
          return;
        }
        for (const listener of this.shellListeners) {
          listener(mapped);
        }
      },
    );
  }

  async subscribeShellEvents(listener: (event: OrchestrationEvent) => void): Promise<() => void> {
    this.shellListeners.add(listener);
    await this.ensureShellSubscription();
    return () => {
      this.shellListeners.delete(listener);
    };
  }

  async onSnapshot(listener: (snapshot: OrchestrationShellSnapshot) => void): Promise<() => void> {
    this.snapshotListeners.add(listener);
    if (this.shellSnapshot) listener(this.shellSnapshot);
    await this.ensureShellSubscription();
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  async subscribeThread(
    threadId: string,
    listener: (item: unknown) => void,
  ): Promise<() => Promise<void>> {
    return this.client.openStream(
      ORCHESTRATION_WS_METHODS.subscribeThread,
      { threadId, requestCompletionMarker: true },
      listener,
    );
  }
}
