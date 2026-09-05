import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readiness: vi.fn(),
  ticket: vi.fn(),
  create: vi.fn(),
  overlay: vi.fn(),
  active: vi.fn(),
  bridge: vi.fn(),
  disconnectBridge: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("../../apps/desktop/src/substrate/useSubstrateOrchestrationSync", () => ({
  readShadowReadyT3Enabled: mocks.readiness,
}));
vi.mock("../../apps/desktop/src/substrate/fetchT3RpcSession", () => ({
  fetchT3RpcSession: mocks.ticket,
}));
vi.mock("@cozea/client-runtime", () => ({ createT3RpcSession: mocks.create }));
vi.mock("@/lib/nativeApi", () => ({ registerT3NativeApiOverlay: mocks.overlay }));
vi.mock("../../apps/desktop/src/substrate/t3CutoverStore", () => ({
  setT3CutoverActive: mocks.active,
}));
vi.mock("@/features/assistant/model/assistantRuntimeMetadataStore", () => ({
  connectT3ServerConfigBridge: mocks.bridge,
  disconnectT3ServerConfigBridge: mocks.disconnectBridge,
}));
vi.mock("../../apps/desktop/src/substrate/t3PreviewAutomationHost", () => ({
  registerT3PreviewAutomationHost: mocks.preview,
  T3_PREVIEW_AUTOMATION_HOST_REVISION: 1,
}));
vi.mock("../../apps/desktop/src/substrate/createT3NativeApi", () => ({
  createT3NativeApi: () => ({ marker: true }),
}));
vi.mock("../../apps/desktop/src/substrate/createT3OrchestrationApi", () => ({
  createT3OrchestrationApiFromClient: () => ({ orchestration: {} }),
}));
import { startT3Cutover } from "../../apps/desktop/src/substrate/useT3Cutover";

const stops: Array<() => void> = [];
let disconnect: () => void;
let close: ReturnType<typeof vi.fn>;
let getConfig: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  close = vi.fn();
  getConfig = vi.fn().mockResolvedValue({});
  subscribe = vi.fn().mockResolvedValue(vi.fn());
  mocks.readiness.mockResolvedValue(true);
  mocks.ticket.mockResolvedValue({ baseUrl: "http://localhost", wsTicket: "fresh" });
  mocks.preview.mockReturnValue(vi.fn());
  mocks.create.mockImplementation(() => ({
    close,
    client: {
      onDisconnect: (listener: () => void) => {
        disconnect = listener;
        return vi.fn();
      },
    },
    orchestration: {},
    serverConfig: { getConfig, subscribeServerConfig: subscribe },
  }));
});
afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
});
const start = () => {
  const update = vi.fn();
  const stop = startT3Cutover("http://localhost", Symbol(), update);
  stops.push(stop);
  return { update, stop };
};

it("retries failed readiness and reacquires credentials after disconnect without replaying commands", async () => {
  mocks.readiness.mockRejectedValueOnce(new Error("offline"));
  const { update } = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.create).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
  disconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(close).toHaveBeenCalledTimes(1);
  expect(mocks.active).toHaveBeenLastCalledWith(expect.any(Symbol), false);
  await vi.advanceTimersByTimeAsync(500);
  expect(mocks.ticket).toHaveBeenCalledTimes(2);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

it("does not install overlays after teardown while the readiness read is pending", async () => {
  let resolve!: (value: unknown) => void;
  getConfig.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { stop } = start();
  await vi.advanceTimersByTimeAsync(0);
  stop();
  resolve({});
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.bridge).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(mocks.overlay.mock.calls.every((call) => call[1] === null)).toBe(true);
});

it("releases config subscriptions that finish acquiring after teardown", async () => {
  let resolve!: (value: () => void) => void;
  subscribe.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let release: (() => void) | undefined;
  mocks.bridge.mockImplementation((_owner, bridge) => {
    release = bridge.subscribe(vi.fn());
  });
  mocks.disconnectBridge.mockImplementation(() => release?.());
  const { stop } = start();
  await vi.advanceTimersByTimeAsync(0);
  stop();
  const unsubscribe = vi.fn();
  resolve(unsubscribe);
  await vi.advanceTimersByTimeAsync(0);
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it("keeps successful legacy fallback available and probes for a restarted native server", async () => {
  mocks.readiness.mockResolvedValueOnce(false);
  const { update } = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith(
    expect.objectContaining({ active: false, loading: false, error: null }),
  );
  expect(mocks.ticket).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(3500);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
});

it("surfaces a readiness failure after a previously successful legacy probe", async () => {
  mocks.readiness.mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("shadow unavailable"));
  const { update, stop } = start();
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ loading: false, error: null }));
  await vi.advanceTimersByTimeAsync(3500);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ active: false, loading: false, error: "shadow unavailable" }));
  expect(mocks.ticket).not.toHaveBeenCalled();
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.readiness).toHaveBeenCalledTimes(2);
});

it("does not let deferred cleanup or callbacks from a stopped generation clear a rapid same-owner restart", async () => {
  const owner = Symbol();
  const update = vi.fn();
  const stopOld = startT3Cutover("http://localhost", owner, update);
  stops.push(stopOld);
  await vi.advanceTimersByTimeAsync(0);
  const oldDisconnect = disconnect;
  stopOld();
  const stopNew = startT3Cutover("http://localhost", owner, update);
  stops.push(stopNew);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.active).toHaveBeenLastCalledWith(owner, true);
  oldDisconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.active).toHaveBeenLastCalledWith(owner, true);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ active: true }));
});
