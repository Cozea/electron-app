import { describe, expect, it } from "vitest";

import {
  isProjectDevAppLogoDataUrl,
  PROJECT_DEVAPP_LOGO_ACCEPT,
  PROJECT_DEVAPP_LOGO_MAX_DATA_URL_LENGTH,
  PROJECT_DEVAPP_LOGO_MAX_INPUT_BYTES,
  validateProjectDevAppLogoFile,
} from "@/features/devapps/projectDevAppLogo";

describe("Project DevApp logos", () => {
  it("advertises macOS-compatible file extensions", () => {
    expect(PROJECT_DEVAPP_LOGO_ACCEPT).toContain(".png");
    expect(PROJECT_DEVAPP_LOGO_ACCEPT).toContain(".jpeg");
    expect(PROJECT_DEVAPP_LOGO_ACCEPT).toContain(".webp");
  });

  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s uploads", (type) => {
    expect(validateProjectDevAppLogoFile({ type, size: 128_000 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized uploads", () => {
    expect(validateProjectDevAppLogoFile({ type: "image/svg+xml", size: 128 })).toContain(
      "PNG, JPEG, or WebP",
    );
    expect(validateProjectDevAppLogoFile({ type: "image/png", size: 0 })).toContain("empty");
    expect(
      validateProjectDevAppLogoFile({
        type: "image/png",
        size: PROJECT_DEVAPP_LOGO_MAX_INPUT_BYTES + 1,
      }),
    ).toContain("smaller than 8 MB");
  });

  it("accepts only bounded raster image data URLs", () => {
    expect(isProjectDevAppLogoDataUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isProjectDevAppLogoDataUrl("data:image/jpeg;base64,/9j/")).toBe(true);
    expect(isProjectDevAppLogoDataUrl("data:image/webp;base64,UklGRjEyMzRXRUJQ")).toBe(true);
    expect(isProjectDevAppLogoDataUrl("data:image/webp;base64,UklGRg==")).toBe(false);
    expect(isProjectDevAppLogoDataUrl("data:image/png;base64,UklGRjEyMzRXRUJQ")).toBe(false);
    expect(isProjectDevAppLogoDataUrl("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(isProjectDevAppLogoDataUrl("https://example.test/logo.png")).toBe(false);
    expect(isProjectDevAppLogoDataUrl("data:image/png;base64,not base64")).toBe(false);
    expect(
      isProjectDevAppLogoDataUrl(
        `data:image/png;base64,${"A".repeat(PROJECT_DEVAPP_LOGO_MAX_DATA_URL_LENGTH)}`,
      ),
    ).toBe(false);
  });
});
