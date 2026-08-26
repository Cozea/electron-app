import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { CollabJournalEntry, DevAppLaunchRequest, ORCHESTRATION_WS_METHODS, WS_METHODS } from "@cozea/contracts";

describe("@cozea/contracts T3 wholesale", () => {
  it("exposes upstream orchestration WS method tags", () => {
    expect(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot).toBe(
      "orchestration.getArchivedShellSnapshot",
    );
    expect(ORCHESTRATION_WS_METHODS.subscribeShell).toBe("orchestration.subscribeShell");
  });

  it("exposes upstream server WS method tags", () => {
    expect(Object.keys(WS_METHODS).length).toBeGreaterThan(50);
    expect(WS_METHODS.serverGetConfig).toBe("server.getConfig");
  });

  it("decodes Cozea-only IPC extension payloads", () => {
    const collab = Schema.decodeSync(CollabJournalEntry)({
      roomId: "room_1",
      updateId: "upd_1",
      ciphertext: "cipher",
      createdAtMs: Date.now(),
    });
    expect(collab.roomId).toBe("room_1");

    const devApp = Schema.decodeSync(DevAppLaunchRequest)({
      devAppId: "preview",
      projectRootPath: "/tmp/project",
    });
    expect(devApp.devAppId).toBe("preview");
  });
});
