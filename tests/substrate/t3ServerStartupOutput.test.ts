import { describe, expect, it, vi } from "vitest";

import { createT3StartupOutputTracker } from "../../apps/server/src/t3/process.ts";

describe("T3 startup output tracking", () => {
  it("waits for a pairing token emitted after other readiness output", async () => {
    const onLog = vi.fn();
    const tracker = createT3StartupOutputTracker(onLog);

    tracker.append("stdout", "T3 Code server is ready.\nConnection string: http://127.0.0.1:13773\n");
    tracker.append("stdout", "Tok");
    tracker.append("stdout", "en: ABCD1234\nPairing URL: http://127.0.0.1/pair#ABCD1234\n");

    await expect(tracker.pairingToken).resolves.toBe("ABCD1234");
    expect(onLog).toHaveBeenCalledWith("T3 Code server is ready.");
    expect(onLog).toHaveBeenCalledWith("Connection string: http://127.0.0.1:13773");
  });

  it("does not forward credentials to application logs", async () => {
    const onLog = vi.fn();
    const tracker = createT3StartupOutputTracker(onLog);

    tracker.append("stderr", "Non-sensitive warning\n");
    tracker.append(
      "stdout",
      "Token: SECRET123\nPairing URL: http://localhost/pair#SECRET123\n\n  █▀▄ █  \n  ▀▄▀ █  \n",
    );

    await expect(tracker.pairingToken).resolves.toBe("SECRET123");
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith("Non-sensitive warning");
    expect(onLog.mock.calls.flat().join(" ")).not.toContain("SECRET123");
    expect(onLog.mock.calls.flat().join(" ")).not.toMatch(/[█▀▄]/);
  });
});
