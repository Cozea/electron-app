import { expect, it, vi } from "vitest"
import { SessionEditorBridge } from "../../apps/desktop/src/features/collaboration/runtime/SessionEditorBridge"

it("retains rejected editor updates across view closure and retries in order", async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error("IPC unavailable")).mockResolvedValue(undefined)
  const bridge = new SessionEditorBridge(send)
  await expect(bridge.enqueue("s", new Uint8Array([1]))).rejects.toThrow("IPC")
  expect(bridge.count("s")).toBe(1)
  await bridge.enqueue("s", new Uint8Array([2]))
  expect(send.mock.calls.map(([, update]) => [...update])).toEqual([[1], [1], [2]])
  expect(bridge.count("s")).toBe(0)
})
