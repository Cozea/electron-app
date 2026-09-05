import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  exchange: vi.fn(),
  ticket: vi.fn(),
  start: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@cozea/client-runtime", () => ({
  exchangeBootstrapAccessToken: fixture.exchange,
  issueWebSocketTicket: fixture.ticket,
  T3EffectRpcClient: class {},
}));
vi.mock("../../apps/server/src/t3/process.ts", () => ({
  startT3ServerProcess: fixture.start,
  resolveDefaultT3BaseDir: () => "/test-native-state",
}));
vi.mock("../../apps/server/src/t3/orchestrationProxy.ts", () => ({
  T3OrchestrationRpcProxy: class { close = fixture.close; },
}));

import { bootstrapT3Server } from "../../apps/server/src/t3Bootstrap";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(finish => { resolve = finish; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  fixture.exchange.mockResolvedValue("test-access-token");
  fixture.ticket.mockResolvedValue("test-ticket");
  fixture.close.mockResolvedValue(undefined);
  fixture.stop.mockResolvedValue(undefined);
  fixture.start.mockResolvedValue({
    baseUrl: "http://127.0.0.1:12345",
    pairingToken: "test-pairing-token",
    stop: fixture.stop,
  });
});

describe("T3 bootstrap shutdown ownership", () => {
  it("closes the transport and native process", async () => {
    const runtime = await bootstrapT3Server({ baseDir: "/test-native-state" });
    await runtime.stop();
    expect(fixture.close).toHaveBeenCalledTimes(1);
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  });

  it("still stops the native process when the RPC transport rejects", async () => {
    fixture.close.mockRejectedValue(new Error("private transport detail"));
    const runtime = await bootstrapT3Server({ baseDir: "/test-native-state" });
    await expect(runtime.stop()).rejects.toThrow("Native chat shutdown was not fully acknowledged.");
    expect(fixture.stop).toHaveBeenCalledTimes(1);
  });

  it("starts native termination without waiting for a stalled RPC transport", async () => {
    const closing = deferred();
    fixture.close.mockReturnValue(closing.promise);
    const runtime = await bootstrapT3Server({ baseDir: "/test-native-state" });
    const stopped = runtime.stop();
    try {
      await vi.waitFor(() => expect(fixture.stop).toHaveBeenCalledTimes(1));
    } finally {
      closing.resolve();
      await stopped;
    }
  });

  it("does not acknowledge shutdown before native exit is confirmed", async () => {
    const exiting = deferred();
    fixture.stop.mockReturnValue(exiting.promise);
    const runtime = await bootstrapT3Server({ baseDir: "/test-native-state" });
    let complete = false;
    const stopped = runtime.stop().then(() => { complete = true; });
    try {
      await vi.waitFor(() => expect(fixture.close).toHaveBeenCalledTimes(1));
      expect(complete).toBe(false);
    } finally {
      exiting.resolve();
      await stopped;
    }
    expect(complete).toBe(true);
  });

  it("reports incomplete shutdown when native termination fails", async () => {
    fixture.stop.mockRejectedValue(new Error("private child detail"));
    const runtime = await bootstrapT3Server({ baseDir: "/test-native-state" });
    await expect(runtime.stop()).rejects.toThrow("Native chat shutdown was not fully acknowledged.");
    expect(fixture.close).toHaveBeenCalledTimes(1);
  });
});
