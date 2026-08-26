import { describe, expect, it } from "vitest";

import { createT3OrchestrationApi } from "@/substrate/createT3OrchestrationApi";

describe("T3 orchestration cutover API", () => {
  it("createT3OrchestrationApi exposes NativeApi orchestration surface", () => {
    const handle = createT3OrchestrationApi({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
    });

    expect(typeof handle.orchestration.dispatchCommand).toBe("function");
    expect(typeof handle.orchestration.getTurnDiff).toBe("function");
    expect(typeof handle.orchestration.getFullThreadDiff).toBe("function");
    expect(typeof handle.orchestration.getSnapshot).toBe("function");
    expect(typeof handle.orchestration.onDomainEvent).toBe("function");
  });
});
