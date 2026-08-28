import type { NativeApi } from "@cozea/assistant-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureNativeApi,
  registerT3NativeApiOverlay,
} from "../../apps/desktop/src/lib/nativeApi";
import {
  readT3CutoverActive,
  setT3CutoverActive,
} from "../../apps/desktop/src/substrate/t3CutoverStore";

const ownerA = Symbol("owner-a");
const ownerB = Symbol("owner-b");
const originalWindow = globalThis.window;

function asNativeApi(value: object): NativeApi {
  return value as NativeApi;
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
    writable: true,
  });
  registerT3NativeApiOverlay(ownerA, null);
  registerT3NativeApiOverlay(ownerB, null);
  setT3CutoverActive(ownerA, false);
  setT3CutoverActive(ownerB, false);
});

afterEach(() => {
  registerT3NativeApiOverlay(ownerA, null);
  registerT3NativeApiOverlay(ownerB, null);
  setT3CutoverActive(ownerA, false);
  setT3CutoverActive(ownerB, false);
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("T3 native API ownership", () => {
  it("falls back to another healthy overlay when the newest owner disconnects", () => {
    const apiA = asNativeApi({ marker: "a" });
    const apiB = asNativeApi({ marker: "b" });

    registerT3NativeApiOverlay(ownerA, apiA);
    registerT3NativeApiOverlay(ownerB, apiB);
    expect(ensureNativeApi()).toBe(apiB);

    registerT3NativeApiOverlay(ownerB, null);
    expect(ensureNativeApi()).toBe(apiA);
  });

  it("keeps global cutover active while at least one owner remains", () => {
    setT3CutoverActive(ownerA, true);
    setT3CutoverActive(ownerB, true);
    setT3CutoverActive(ownerA, false);
    expect(readT3CutoverActive()).toBe(true);

    setT3CutoverActive(ownerB, false);
    expect(readT3CutoverActive()).toBe(false);
  });

  it("delays a native call across a brief overlay startup gap", async () => {
    const dispatchCommand = vi.fn(async () => undefined);
    const deferredApi = ensureNativeApi();
    const payload = { type: "test.command" };

    const result = deferredApi.orchestration.dispatchCommand(
      payload as Parameters<NativeApi["orchestration"]["dispatchCommand"]>[0],
    );
    registerT3NativeApiOverlay(
      ownerA,
      asNativeApi({ orchestration: { dispatchCommand } }),
    );

    await expect(result).resolves.toBeUndefined();
    expect(dispatchCommand).toHaveBeenCalledWith(payload);
  });
});
