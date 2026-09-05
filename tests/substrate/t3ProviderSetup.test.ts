import { expect, it, vi } from "vitest";
import { createT3ProviderSetupApi } from "../../apps/desktop/src/substrate/createT3ProviderSetupApi";
const auth = {
  instanceId: "antigravity-work",
  phase: "waiting",
  flowId: "flow-1",
  authorizationUrl: null,
  expiresAt: null,
  message: null,
};
it("preserves account and flow identity and validates unary and streaming responses", async () => {
  const callUnary = vi.fn(async (_method: string, _input?: unknown): Promise<unknown> => auth);
  const unsubscribe = vi.fn(async () => undefined);
  let deliver!: (value: unknown) => void;
  const openStream = vi.fn(
    async (_method: string, _input: unknown, onValue: (value: unknown) => void) => {
      deliver = onValue;
      return unsubscribe;
    },
  );
  const api = createT3ProviderSetupApi({ callUnary, openStream });
  expect(await api.startAuth("antigravity-work")).toEqual(auth);
  expect(callUnary).toHaveBeenLastCalledWith("provider.auth.start", {
    instanceId: "antigravity-work",
  });
  await api.cancelAuth("antigravity-work", "flow-1");
  expect(callUnary).toHaveBeenLastCalledWith("provider.auth.cancel", {
    instanceId: "antigravity-work",
    flowId: "flow-1",
  });
  const onState = vi.fn();
  const stop = await api.subscribeAuth("antigravity-work", onState);
  deliver(auth);
  expect(onState).toHaveBeenCalledWith(auth);
  expect(() => deliver({ ...auth, phase: "unexpected" })).toThrow();
  expect(() => deliver({ ...auth, instanceId: "antigravity-personal" })).toThrow(
    "different account",
  );
  await stop();
  expect(unsubscribe).toHaveBeenCalledOnce();
  callUnary.mockResolvedValue({ phase: "succeeded" });
  await expect(api.startAuth("antigravity-work")).rejects.toThrow();
});
