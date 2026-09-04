import { describe, expect, it } from "vitest";

import {
  resolveSidebarDevAppMenuAction,
  canReuseProjectDevAppLogo,
} from "@/features/projects/ui/sidebar/projectSidebarShared";

describe("project sidebar DevApp menu action", () => {
  it("offers publish for an unpublished project", () => {
    expect(
      resolveSidebarDevAppMenuAction({
        devAppPublicationState: "unpublished",
        devAppPublishingMode: null,
        canPublishDevApp: true,
      }),
    ).toEqual({
      label: "Publish",
      mode: "publish",
      enabled: true,
    });
  });

  it("offers update for a published project", () => {
    expect(
      resolveSidebarDevAppMenuAction({
        devAppPublicationState: "published",
        devAppPublishingMode: null,
        canPublishDevApp: true,
      }),
    ).toEqual({
      label: "Update",
      mode: "update",
      enabled: true,
    });
  });

  it("keeps an unavailable action visible but disabled", () => {
    expect(
      resolveSidebarDevAppMenuAction({
        devAppPublicationState: "unpublished",
        devAppPublishingMode: null,
        canPublishDevApp: false,
      }),
    ).toEqual({
      label: "Publish",
      mode: "publish",
      enabled: false,
    });
  });

  it.each([
    ["publish", "Publishing…"],
    ["update", "Updating…"],
  ] as const)("shows disabled %s progress", (mode, label) => {
    expect(
      resolveSidebarDevAppMenuAction({
        devAppPublicationState: "publishing",
        devAppPublishingMode: mode,
        canPublishDevApp: true,
      }),
    ).toEqual({
      label,
      mode,
      enabled: false,
    });
  });
});

describe("project sidebar DevApp logo request", () => {
  const logoDataUrl = "data:image/webp;base64,UklGRjEyMzRXRUJQ";

  it("always requests a logo before the first publish", () => {
    expect(canReuseProjectDevAppLogo("publish", logoDataUrl)).toBe(false);
  });

  it("reuses a valid logo on update", () => {
    expect(canReuseProjectDevAppLogo("update", logoDataUrl)).toBe(true);
  });

  it.each([undefined, "https://example.test/logo.png", "data:image/webp;base64,UklGRg=="])(
    "requests a logo when a legacy update has no valid local artwork",
    (value) => {
      expect(canReuseProjectDevAppLogo("update", value)).toBe(false);
    },
  );
});
