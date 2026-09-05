import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrchestrationShellSnapshot } from "@cozea/contracts/t3";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

const mocks = vi.hoisted(() => ({
  snapshots: [] as Array<(snapshot: OrchestrationShellSnapshot) => void>,
  disconnects: [] as Array<(error?: unknown) => void>,
  nativeClose: vi.fn(),
  nativeSession: vi.fn(),
  legacyClose: vi.fn(),
  legacySubscribe: vi.fn(),
  legacySnapshot: vi.fn(),
  applied: vi.fn(),
  synced: vi.fn(),
  legacyEvents: [] as OrchestrationEvent[],
  finishLegacy: undefined as (() => void) | undefined,
  readModel: { snapshotSequence: 0, projects: [], threads: [], updatedAt: "2026-09-05T00:00:00Z" },
}));
vi.mock("@/features/assistant/model/assistantStore", () => ({
  coalesceOrchestrationUiEvents: (events: unknown) => events,
  useStore: {
    getState: () => ({
      orchestrationReadModel: mocks.readModel,
      syncServerReadModel: mocks.synced,
      applyOrchestrationDomainEvents: mocks.applied,
    }),
  },
}));
vi.mock("@cozea/client-runtime", () => ({
  T3OrchestrationClient: class {
    constructor(session: unknown) {
      mocks.nativeSession(session);
    }
    close() {
      mocks.nativeClose();
    }
    onDisconnect(listener: (error?: unknown) => void) {
      mocks.disconnects.push(listener);
      return () => {};
    }
    async onSnapshot(listener: (snapshot: OrchestrationShellSnapshot) => void) {
      mocks.snapshots.push(listener);
      return () => {};
    }
  },
  SubstrateOrchestrationClient: class {
    async connect() {}
    async close() {
      mocks.legacyClose();
      mocks.finishLegacy?.();
    }
    getSnapshot() {
      return mocks.legacySnapshot();
    }
    async *subscribeDomainEvents(input: unknown) {
      mocks.legacySubscribe(input);
      for (const event of mocks.legacyEvents) yield event;
      await new Promise<void>((resolve) => {
        mocks.finishLegacy = resolve;
      });
    }
  },
}));
import { acquireSubstrateOrchestrationSync } from "../../apps/desktop/src/substrate/useSubstrateOrchestrationSync";
import {
  useT3ConnectionStore,
  t3ShellConnectionKey,
} from "../../apps/desktop/src/substrate/t3ConnectionStatus";

const base = "http://shadow.test";
const snapshot = (snapshotSequence: number): OrchestrationShellSnapshot => ({
  snapshotSequence,
  projects: [],
  threads: [],
  updatedAt: "2026-09-05T00:00:00Z",
});
const releases: Array<() => void> = [];
const acquire = () => {
  const release = acquireSubstrateOrchestrationSync(base);
  releases.push(release);
  return release;
};
const fetchMock = vi.fn<typeof fetch>();
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.snapshots.length = 0;
  mocks.disconnects.length = 0;
  mocks.legacyEvents = [];
  mocks.finishLegacy = undefined;
  mocks.legacySnapshot.mockResolvedValue(snapshot(10));
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.resolve();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("shell sync lifecycle", () => {
  it("retries failed readiness instead of permanently choosing legacy, then gets fresh tickets on reconnect", async () => {
    let readinessCalls = 0;
    let tickets = 0;
    fetchMock.mockImplementation(async (input) =>
      String(input).includes("/ready")
        ? ++readinessCalls === 1
          ? response({}, 503)
          : response({ ok: true, t3Server: true })
        : response({ ok: true, baseUrl: base, wsTicket: `ticket-${++tickets}` }),
    );
    acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.legacySubscribe).not.toHaveBeenCalled();
    expect(useT3ConnectionStore.getState().byOwner[t3ShellConnectionKey(base)]?.phase).toBe(
      "error",
    );
    await vi.advanceTimersByTimeAsync(500);
    mocks.snapshots[0]!(snapshot(20));
    expect(mocks.synced).toHaveBeenCalledTimes(1);
    mocks.disconnects[0]!(new Error("offline"));
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.nativeSession.mock.calls.map((call) => call[0])).toEqual([
      { ok: true, baseUrl: base, wsTicket: "ticket-1" },
      { ok: true, baseUrl: base, wsTicket: "ticket-2" },
    ]);
    mocks.snapshots[0]!(snapshot(99));
    expect(mocks.synced).toHaveBeenCalledTimes(1);
    mocks.snapshots[1]!(snapshot(19));
    expect(mocks.synced).toHaveBeenCalledTimes(1);
    expect(useT3ConnectionStore.getState().byOwner[t3ShellConnectionKey(base)]?.phase).toBe(
      "error",
    );
  });
  it("bootstraps legacy snapshots and subscribes after their revision, ignoring duplicate replay", async () => {
    fetchMock.mockResolvedValue(response({ ok: true, t3Server: false }));
    mocks.legacyEvents = [10, 11, 14].map(
      (sequence) =>
        ({
          sequence,
          type: "thread.deleted",
          payload: { threadId: "fixture" },
        }) as OrchestrationEvent,
    );
    acquire();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.synced).toHaveBeenCalledTimes(1);
    expect(mocks.legacySubscribe).toHaveBeenCalledWith({ afterSequence: 10 });
    expect(mocks.applied.mock.calls.map((call) => call[0][0].sequence)).toEqual([11, 14]);
    expect(mocks.nativeSession).not.toHaveBeenCalled();
  });
  it("shares discovery and aborts pending readiness only after the final owner leaves", async () => {
    let signal: AbortSignal | null | undefined;
    fetchMock.mockImplementation((_input, init) => {
      signal = init?.signal;
      return new Promise(() => {});
    });
    const first = acquire();
    const second = acquire();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    first();
    await Promise.resolve();
    expect(signal?.aborted).toBe(false);
    second();
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useT3ConnectionStore.getState().byOwner[t3ShellConnectionKey(base)]).toBeUndefined();
  });
});
