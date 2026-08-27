import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSubstrateObsNdjsonFlags } from "../../apps/desktop/electron/substrate/flags";
import {
  createSubstrateNdjsonWriter,
  resetSharedSubstrateNdjsonWriterForTests,
} from "../../apps/desktop/electron/substrate/obs";

describe("substrate NDJSON obs (phase 6)", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    resetSharedSubstrateNdjsonWriterForTests();
    for (const file of tempFiles.splice(0)) {
      fs.rmSync(file, { force: true });
    }
  });

  it("defaults on", () => {
    expect(readSubstrateObsNdjsonFlags({}).enabled).toBe(true);
    const writer = createSubstrateNdjsonWriter({ env: {} });
    expect(writer.enabled).toBe(true);
    expect(writer.filePath).not.toBeNull();
    writer.dispose();
  });

  it("can opt out", () => {
    const writer = createSubstrateNdjsonWriter({ env: { COZEA_OBS_NDJSON: "0" } });
    expect(writer.enabled).toBe(false);
    expect(writer.filePath).toBeNull();
    writer.writeSpan({ name: "should.not.write" });
  });

  it("writes spans when enabled", async () => {
    const filePath = path.join(os.tmpdir(), `cozea-obs-${Date.now()}.ndjson`);
    tempFiles.push(filePath);
    const writer = createSubstrateNdjsonWriter({
      env: { COZEA_OBS_NDJSON: "1" },
      filePath,
    });
    expect(writer.enabled).toBe(true);
    writer.writeSpan({
      name: "substrate.shadow.start",
      attrs: { port: 4783 },
    });
    writer.writeSpan({ name: "substrate.shadow.ready" });
    writer.dispose();

    await new Promise((resolve) => setTimeout(resolve, 30));
    const body = fs.readFileSync(filePath, "utf8").trim().split("\n");
    expect(body.length).toBeGreaterThanOrEqual(2);
    expect(body[0]).toContain("substrate.shadow.start");
    expect(body[1]).toContain("substrate.shadow.ready");
  });
});
