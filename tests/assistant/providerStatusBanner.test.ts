import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerProvider } from "@cozea/assistant-contracts";
import {
  ProviderAuthenticationHelp,
  resolveProviderRemediation,
} from "@/features/assistant/chat/ProviderRemediationAction";
import { ProviderStatusBanner } from "@/features/assistant/chat/ProviderStatusBanner";
import { ProviderUpdateNotice } from "@/features/assistant/chat/ProviderUpdateNotice";
import { applyProviderUpdate } from "@/features/assistant/chat/useProviderUpdate";
import {
  hasBlockingProviderBanner,
  presentProviderStatusMessage,
  resolveProviderBannerKind,
} from "@/features/assistant/chat/providerStatusPresentation";
import { markProviderRemediationResolved } from "@/features/assistant/chat/providerRemediationResolutionStore";

function createMemorySessionStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderStatusBanner", () => {
  it("blocks the composer for every provider state that replaces the timeline", () => {
    const ready = {
      status: "ready",
      versionAdvisory: { status: "current" },
    } as ServerProvider;
    const updateAvailable = {
      ...ready,
      versionAdvisory: { status: "behind_latest" },
    } as ServerProvider;
    const unavailable = { ...ready, status: "error" } as ServerProvider;

    expect(hasBlockingProviderBanner(ready)).toBe(false);
    expect(hasBlockingProviderBanner(updateAvailable)).toBe(true);
    expect(hasBlockingProviderBanner(unavailable)).toBe(true);
  });

  it("separates a recoverable update from a provider that is simply gone", () => {
    const ready = {
      status: "ready",
      versionAdvisory: { status: "current" },
    } as ServerProvider;

    expect(resolveProviderBannerKind(ready)).toBeNull();
    expect(
      resolveProviderBannerKind({
        ...ready,
        versionAdvisory: { status: "behind_latest" },
      } as ServerProvider),
    ).toBe("update-available");
    expect(resolveProviderBannerKind({ ...ready, status: "error" } as ServerProvider)).toBe(
      "unavailable",
    );
  });

  it("keeps implementation-vendor names out of provider status copy", () => {
    expect(
      presentProviderStatusMessage(
        "T3 Code could not restart the T3 server because the T3 runtime is offline.",
      ),
    ).toBe(
      "Cozea could not restart the local agent service because the local agent runtime is offline.",
    );
  });

  it("renders unchanged command feedback and captured updater output", () => {
    const status = {
      instanceId: "codex",
      driver: "codex",
      enabled: true,
      installed: true,
      version: "0.150.1",
      status: "ready",
      auth: { status: "authenticated" },
      message: "Provider connection is healthy.",
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
    expect(markup).toContain("Codex 0.150.1 is behind 0.151.0.");
    expect(markup).not.toContain("Provider connection is healthy.");
  });

  it("shows exact Claude login instructions with a copy action", () => {
    const status = {
      instanceId: "claudeAgent",
      provider: "claudeAgent",
      driver: "claudeAgent",
      enabled: true,
      installed: true,
      version: "2.1.251",
      status: "error",
      auth: { status: "unauthenticated" },
      checkedAt: "2026-08-29T10:00:00.000Z",
      message: "Authentication required.",
      models: [],
      slashCommands: [],
      skills: [],
    } as ServerProvider;

    const markup = renderToStaticMarkup(createElement(ProviderStatusBanner, { status }));

    expect(markup).toContain("Open Terminal");
    expect(markup).toContain("claude auth login");
    expect(markup).toContain("Copy");
    expect(markup).toContain("Complete the Anthropic sign-in");
    expect(markup).toContain("Start login in Cozea");
  });

  it.each([
    ["claudeAgent", "claude auth login"],
    ["codex", "codex login"],
    ["cursor", "agent login"],
    ["opencode", "opencode auth login"],
    ["gemini", "gemini"],
  ])("provides the exact terminal command for %s", (provider, command) => {
    const remediation = resolveProviderRemediation(
      provider,
      "The provider cannot start yet.",
      true,
    );

    expect(remediation).toMatchObject({ kind: "login", command });
  });

  it("keeps installation remediation ahead of authentication guidance", () => {
    const remediation = resolveProviderRemediation(
      "claudeAgent",
      "Claude is not installed or not on PATH.",
      true,
    );

    expect(remediation).toEqual({
      kind: "install",
      toolId: "claude",
      label: "Install Claude Code CLI",
    });
  });

  it("turns Claude's in-chat /login reply into visible authentication help", () => {
    const message = "Not logged in · Please run /login";
    const markup = renderToStaticMarkup(
      createElement(ProviderAuthenticationHelp, {
        provider: "claudeAgent",
        message,
      }),
    );

    expect(resolveProviderRemediation("claudeAgent", message)).toMatchObject({
      kind: "login",
      command: "claude auth login",
    });
    expect(markup).toContain("Sign in to Claude");
    expect(markup).toContain("claude auth login");
    expect(markup).toContain("Copy");
    expect(markup).toContain("Start login in Cozea");
  });

  it("does not add authentication help to ordinary or streaming replies", () => {
    const ordinaryMarkup = renderToStaticMarkup(
      createElement(ProviderAuthenticationHelp, {
        provider: "claudeAgent",
        message: "I can help with that project.",
      }),
    );
    const streamingMarkup = renderToStaticMarkup(
      createElement(ProviderAuthenticationHelp, {
        provider: "claudeAgent",
        message: "Not logged in · Please run /login",
        isStreaming: true,
      }),
    );
    const supersededMarkup = renderToStaticMarkup(
      createElement(ProviderAuthenticationHelp, {
        provider: "claudeAgent",
        message: "Not logged in · Please run /login",
        isSuperseded: true,
      }),
    );

    expect(ordinaryMarkup).toBe("");
    expect(streamingMarkup).toBe("");
    expect(supersededMarkup).toBe("");
  });

  it("restores a successful login after its timeline message remounts", () => {
    vi.stubGlobal("window", { sessionStorage: createMemorySessionStorage() });
    markProviderRemediationResolved("claude:auth-message-1");

    const markup = renderToStaticMarkup(
      createElement(ProviderAuthenticationHelp, {
        provider: "claudeAgent",
        message: "Not logged in · Please run /login",
        messageId: "auth-message-1",
      }),
    );

    expect(markup).toContain("Signed in to Claude");
    expect(markup).toContain("Signed in successfully.");
    expect(markup).not.toContain("Start login in Cozea");
  });
});

describe("ProviderUpdateNotice", () => {
  const behindProvider = {
    instanceId: "codex",
    provider: "codex",
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
  } as ServerProvider;

  it("offers the update in place instead of a dead-end notice", () => {
    const markup = renderToStaticMarkup(
      createElement(ProviderUpdateNotice, {
        status: behindProvider,
        isTurnRunning: false,
        onRestartAgent: () => Promise.resolve(),
      }),
    );

    expect(markup).toContain("Codex 0.150.1 is behind 0.151.0.");
    expect(markup).toContain("Update Codex");
    expect(markup).not.toContain("This provider is unavailable.");
  });

  it("falls back to the update command when Cozea cannot run the updater", () => {
    const markup = renderToStaticMarkup(
      createElement(ProviderUpdateNotice, {
        status: {
          ...behindProvider,
          versionAdvisory: { ...behindProvider.versionAdvisory!, canUpdate: false },
        } as ServerProvider,
        isTurnRunning: false,
        onRestartAgent: () => Promise.resolve(),
      }),
    );

    expect(markup).toContain("brew upgrade --cask codex");
    expect(markup).not.toContain("Update Codex");
  });

  it("holds the update back until a turn in flight finishes", () => {
    const markup = renderToStaticMarkup(
      createElement(ProviderUpdateNotice, {
        status: behindProvider,
        isTurnRunning: true,
        onRestartAgent: () => Promise.resolve(),
      }),
    );

    expect(markup).toContain("Update it once this turn finishes.");
    expect(markup).toContain("disabled");
  });

  it("leaves the restart to the update, with nothing extra to click", () => {
    const markup = renderToStaticMarkup(
      createElement(ProviderUpdateNotice, {
        status: behindProvider,
        isTurnRunning: false,
        onRestartAgent: () => Promise.resolve(),
      }),
    );

    expect(markup).not.toContain("Restart");
  });

  it("restarts the agent once an update installs a new version", async () => {
    const restarted: string[] = [];
    const state = await applyProviderUpdate(
      () =>
        Promise.resolve({
          status: "succeeded",
          startedAt: null,
          finishedAt: null,
          message: null,
          output: null,
        } as NonNullable<ServerProvider["updateState"]>),
      async () => {
        restarted.push("stopped");
      },
    );

    expect(state?.status).toBe("succeeded");
    expect(restarted).toEqual(["stopped"]);
  });

  it("leaves a live session alone when the update changed nothing", async () => {
    const restarted: string[] = [];
    await applyProviderUpdate(
      () =>
        Promise.resolve({
          status: "unchanged",
          startedAt: null,
          finishedAt: null,
          message: "Already up-to-date.",
          output: null,
        } as NonNullable<ServerProvider["updateState"]>),
      async () => {
        restarted.push("stopped");
      },
    );

    expect(restarted).toEqual([]);
  });
});
