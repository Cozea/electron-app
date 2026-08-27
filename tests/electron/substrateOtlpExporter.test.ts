import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OTLP_LOGS_ENDPOINT } from "../../apps/desktop/electron/substrate/constants";
import {
  exportSubstrateSpanToOtlp,
  isOtlpEnabled,
  resolveOtlpEndpoint,
} from "../../apps/desktop/electron/substrate/obs/otlpExporter";

describe("substrate OTLP exporter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults on when obs NDJSON is on", () => {
    expect(isOtlpEnabled({})).toBe(true);
    expect(resolveOtlpEndpoint({})).toBe(DEFAULT_OTLP_LOGS_ENDPOINT);
  });

  it("respects explicit endpoint override", () => {
    const env = { COZEA_OTLP_ENDPOINT: "https://collector.example/v1/logs" };
    expect(resolveOtlpEndpoint(env)).toBe("https://collector.example/v1/logs");
  });

  it("can disable export with COZEA_OTLP_ENDPOINT=0", () => {
    const env = { COZEA_OTLP_ENDPOINT: "0", COZEA_OBS_NDJSON: "1" };
    expect(isOtlpEnabled(env)).toBe(false);
    expect(resolveOtlpEndpoint(env)).toBeNull();
  });

  it("posts spans to the resolved endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await exportSubstrateSpanToOtlp(
      { name: "substrate.shadow.ready", attrs: { port: 4783 } },
      { COZEA_OTLP_ENDPOINT: "http://127.0.0.1:4318/v1/logs" },
    );

    expect(result.exported).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4318/v1/logs");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("substrate.shadow.ready");
  });
});
