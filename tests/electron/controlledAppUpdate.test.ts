import { expect, it, vi } from "vitest";
import { createControlledAppUpdateInstaller } from "../../apps/desktop/electron/services/controlledAppUpdate";
import type { HostUpdateRequest } from "../../shared/hostUpdateControl";
it("leaves continuation off by default and refuses an undownloaded update", async () => {
  const getHosts = vi.fn(() => []);
  const install = vi.fn();
  await createControlledAppUpdateInstaller({ isDownloaded: () => true, getHosts, install })();
  expect(getHosts).not.toHaveBeenCalled();
  expect(install).toHaveBeenCalledOnce();
  await expect(
    createControlledAppUpdateInstaller({ isDownloaded: () => false, getHosts, install })(true),
  ).rejects.toThrow("Download");
  expect(install).toHaveBeenCalledOnce();
});
it("waits for all hosts before installation and coalesces duplicate clicks", async () => {
  let ready!: () => void;
  const gate = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const host = { controlUpdate: vi.fn(() => gate) };
  const install = vi.fn();
  const run = createControlledAppUpdateInstaller({
    isDownloaded: () => true,
    getHosts: () => [host],
    install,
  });
  const first = run(true);
  expect(run(true)).toBe(first);
  expect(install).not.toHaveBeenCalled();
  ready();
  await first;
  expect(install).toHaveBeenCalledOnce();
  expect(host.controlUpdate).toHaveBeenCalledOnce();
});
it("cancels every prepared host after partial failure and permits explicit retry", async () => {
  let fail = true;
  const first = { controlUpdate: vi.fn(async (_request: HostUpdateRequest) => undefined) };
  const second = {
    controlUpdate: vi.fn(async (request: HostUpdateRequest) => {
      if (request.action === "prepare" && fail) throw new Error("unavailable");
    }),
  };
  const install = vi.fn();
  const run = createControlledAppUpdateInstaller({
    isDownloaded: () => true,
    getHosts: () => [first, second],
    install,
  });
  await expect(run(true)).rejects.toThrow("could not be prepared");
  expect(install).not.toHaveBeenCalled();
  expect(first.controlUpdate.mock.calls.map(([request]) => request.action)).toEqual([
    "prepare",
    "cancel",
  ]);
  expect(second.controlUpdate.mock.calls.map(([request]) => request.action)).toEqual([
    "prepare",
    "cancel",
  ]);
  fail = false;
  await run(true);
  expect(install).toHaveBeenCalledOnce();
});
it("clears markers if the updater fails before shutdown", async () => {
  const host = { controlUpdate: vi.fn(async (_request: HostUpdateRequest) => undefined) };
  const run = createControlledAppUpdateInstaller({
    isDownloaded: () => true,
    getHosts: () => [host],
    install: () => {
      throw new Error("install failed");
    },
  });
  await expect(run(true)).rejects.toThrow("install failed");
  expect(host.controlUpdate.mock.calls.map(([request]) => request.action)).toEqual([
    "prepare",
    "cancel",
  ]);
});
