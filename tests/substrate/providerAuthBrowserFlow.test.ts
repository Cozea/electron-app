import { Schema } from "effect";
import { expect, it, vi } from "vitest";
import { createProviderAuthBrowserFlow } from "../../apps/desktop/src/features/settings/providerAuthBrowserFlow";
import { ProviderAuthState } from "../../packages/contracts/src/t3/providerSetup";
const state = Schema.decodeUnknownSync(ProviderAuthState)({
  instanceId: "antigravity",
  phase: "waiting",
  flowId: "flow-a",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  expiresAt: null,
  message: null,
});
it("opens exactly once when an early notification precedes the start reply", async () => {
  const open = vi.fn(async () => undefined);
  const flow = createProviderAuthBrowserFlow(open);
  await flow.observe(state);
  expect(open).not.toHaveBeenCalled();
  await flow.begin(state);
  await flow.observe(state);
  expect(open).toHaveBeenCalledOnce();
  await flow.observe({ ...state, flowId: "other-account-flow" });
  expect(open).toHaveBeenCalledOnce();
  await flow.begin({ ...state, flowId: "retry-flow" });
  expect(open).toHaveBeenCalledTimes(2);
});
it("waits for a URL and rejects unsupported destinations without opening them", async () => {
  const open = vi.fn(async () => undefined);
  const flow = createProviderAuthBrowserFlow(open);
  await flow.begin({ ...state, authorizationUrl: null });
  expect(open).not.toHaveBeenCalled();
  await expect(flow.observe({ ...state, authorizationUrl: "https://example.com" })).rejects.toThrow(
    "unsupported",
  );
  expect(open).not.toHaveBeenCalled();
  await flow.observe(state);
  expect(open).toHaveBeenCalledOnce();
});
