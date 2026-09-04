import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { isHostUpdateRequest, requestHostUpdate } from "../../shared/hostUpdateControl";
class Child extends EventEmitter {
  connected = true;
  send = vi.fn((_message: object, callback: (error: Error | null) => void) => callback(null));
}
const request = { type: "cozea:host-update", action: "prepare", requestId: "test-1" } as const;
afterEach(() => vi.useRealTimers());
it("correlates the action and request ID and releases listeners after acknowledgement", async () => {
  const child = new Child();
  const done = vi.fn();
  const promise = requestHostUpdate(child, request).then(done);
  child.emit("message", {
    type: "cozea:host-update-result",
    action: "cancel",
    requestId: "test-1",
    success: true,
  });
  child.emit("message", {
    type: "cozea:host-update-result",
    action: "prepare",
    requestId: "other",
    success: true,
  });
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  child.emit("message", { ...request, type: "cozea:host-update-result", success: true });
  await promise;
  expect(child.listenerCount("message")).toBe(0);
  expect(child.listenerCount("exit")).toBe(0);
});
it("rejects failed acknowledgement, process exit, synchronous send failure and timeout", async () => {
  vi.useFakeTimers();
  for (const failure of ["ack", "exit", "send", "timeout"]) {
    const child = new Child();
    if (failure === "send")
      child.send.mockImplementation(() => {
        throw new Error("disconnected");
      });
    const promise = requestHostUpdate(child, request, 20);
    const rejection = expect(promise).rejects.toThrow();
    if (failure === "ack")
      child.emit("message", { ...request, type: "cozea:host-update-result", success: false });
    if (failure === "exit") child.emit("exit");
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(20);
    await rejection;
    expect(child.listenerCount("message")).toBe(0);
    expect(child.listenerCount("exit")).toBe(0);
  }
});
it("rejects a disconnected child without sending and validates the parent-only protocol", async () => {
  const child = new Child();
  child.connected = false;
  await expect(requestHostUpdate(child, request)).rejects.toThrow("disconnected");
  expect(child.send).not.toHaveBeenCalled();
  expect(isHostUpdateRequest(request)).toBe(true);
  for (const value of [
    null,
    {},
    { ...request, action: "delete" },
    { ...request, requestId: "../secret" },
  ])
    expect(isHostUpdateRequest(value)).toBe(false);
});
