import { describe, expect, it, vi } from "vitest";

import { waitForShadowHostedAssistantRuntimeReady } from "../../../apps/desktop/electron/substrate/shadowHostedRuntimeMonitor";

describe("shadowHostedRuntimeMonitor", () => {
  it("resolves when readiness endpoint returns ok", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));

    await waitForShadowHostedAssistantRuntimeReady({
      httpOrigin: "http://127.0.0.1:3773",
      readinessPath: "/__cozea/ready",
      timeoutMs: 500,
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalled();
  });
});
