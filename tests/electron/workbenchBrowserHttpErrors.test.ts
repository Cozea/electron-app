import { describe, expect, it } from "vitest";

import { resolveBrowserPageError } from "@/features/browser/browserPageError";
import { browserHttpDiagnosticForResponse } from "@shared/browserHttpDiagnostics";
import { getBrowserPortParityRequirement } from "@shared/browserPortParityLedger";
import type { CozeaBrowserSurfaceState } from "@shared/browserSurfaceTypes";

const asState = (
  input: Pick<CozeaBrowserSurfaceState, "navStatus" | "httpDiagnostic">,
): CozeaBrowserSurfaceState => input as CozeaBrowserSurfaceState;

describe("workbench browser HTTP error parity", () => {
  it("classifies only final blank 4xx/5xx responses as HTTP diagnostics", () => {
    expect(
      browserHttpDiagnosticForResponse({
        url: "https://example.com/missing",
        statusCode: 404,
        statusText: "Not Found",
        blank: true,
      }),
    ).toEqual({
      url: "https://example.com/missing",
      statusCode: 404,
      statusText: "Not Found",
      blank: true,
    });
    expect(
      browserHttpDiagnosticForResponse({
        url: "https://example.com/framework-error",
        statusCode: 500,
        statusText: "Internal Server Error",
        blank: false,
      }),
    ).toBeNull();
    expect(
      browserHttpDiagnosticForResponse({
        url: "https://example.com/intentional-blank",
        statusCode: 204,
        statusText: "No Content",
        blank: true,
      }),
    ).toBeNull();
  });

  it("gives a transport failure precedence over a stale HTTP diagnostic", () => {
    expect(
      resolveBrowserPageError(
        asState({
          navStatus: {
            kind: "LoadFailed",
            url: "https://offline.example/",
            title: "",
            code: -105,
            description: "NAME_NOT_RESOLVED",
          },
          httpDiagnostic: {
            url: "https://old.example/",
            statusCode: 500,
            statusText: "Old error",
            blank: true,
          },
        }),
      ),
    ).toEqual({
      kind: "transport",
      url: "https://offline.example/",
      code: -105,
      description: "NAME_NOT_RESOLVED",
    });
  });

  it.each([
    "http-errors.transport-precedence",
    "http-errors.blank-error-document",
    "http-errors.framework-document",
  ])("records %s as a Cozea adaptation", (id) => {
    expect(getBrowserPortParityRequirement(id)).toMatchObject({
      id,
      area: "http-errors",
      status: "cozea-adapted",
    });
  });
});
