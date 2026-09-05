import { afterEach, expect, it, vi } from "vitest";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it("defaults off, persists opt-in, and retains a downloaded update after failed preparation", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  const install = vi.fn(async () => ({ success: false, error: "Preparation failed" }));
  vi.stubGlobal("window", { electronAPI: { updates: { install } } });
  const first = await import("../../apps/desktop/src/app/model/autoUpdateStore");
  expect(first.useAutoUpdateStore.getState().continueActiveChats).toBe(false);
  first.useAutoUpdateStore.getState().setContinueActiveChats(true);
  vi.resetModules();
  const reloaded = await import("../../apps/desktop/src/app/model/autoUpdateStore");
  expect(reloaded.useAutoUpdateStore.getState().continueActiveChats).toBe(true);
  reloaded.useAutoUpdateStore
    .getState()
    .applyUpdateState({ status: "downloaded", version: "fixture" });
  reloaded.useAutoUpdateStore.getState().setInstallMode("now");
  await reloaded.installDownloadedUpdate();
  expect(install).toHaveBeenCalledWith({ continueActiveChats: true });
  expect(reloaded.useAutoUpdateStore.getState()).toMatchObject({
    status: "downloaded",
    installMode: null,
    error: "Preparation failed",
  });
});
