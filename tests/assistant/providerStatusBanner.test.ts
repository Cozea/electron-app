import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ServerProvider } from "@cozea/assistant-contracts";
import { ProviderStatusBanner } from "@/features/projects/components/assistant/chat/ProviderStatusBanner";

describe("ProviderStatusBanner", () => {
  it("renders unchanged command feedback and captured updater output", () => {
    const status = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "0.150.1",
      status: "ready",
      auth: { status: "authenticated" },
      checkedAt: "2026-08-29T10:00:00.000Z",
      models: [],
      slashCommands: [],
      skills: [],
      versionAdvisory: {
        status: "behind_latest",
        currentVersion: "0.150.1",
        latestVersion: "0.151.0",
        updateCommand: "brew upgrade --cask codex",
        canUpdate: true,
        checkedAt: "2026-08-29T10:00:00.000Z",
        message: "Install the update now or review provider settings.",
      },
      updateState: {
        status: "unchanged",
        startedAt: "2026-08-29T10:00:00.000Z",
        finishedAt: "2026-08-29T10:00:01.000Z",
        message: "The installed provider version did not change.",
        output: "Already up-to-date.",
      },
    } as ServerProvider;

    const markup = renderToStaticMarkup(createElement(ProviderStatusBanner, { status }));

    expect(markup).toContain("The installed provider version did not change.");
    expect(markup).toContain("Update details");
    expect(markup).toContain("Already up-to-date.");
  });
});
