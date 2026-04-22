import { describe, expect, it } from "vitest";

import {
  buildRecoveredCursorProviderSnapshot,
  inferCursorCapabilitiesFromModelSlug,
  parseCursorAboutOutput,
  parseCursorCliConfigChannel,
  parseCursorCliConfigCurrentModel,
} from "../../../../../electron/assistant-runtime/provider/Layers/CursorProvider.ts";
import type { CursorSettings } from "@cozea/assistant-contracts";

const EMPTY_CAPABILITIES = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
} as const;

const BASE_CURSOR_SETTINGS = {
  enabled: true,
  binaryPath: "/Users/admin/.local/bin/agent",
  apiEndpoint: "",
  customModels: [],
} satisfies CursorSettings;

describe("CursorProvider", () => {
  describe("parseCursorCliConfigChannel", () => {
    it("parses the configured channel", () => {
      expect(parseCursorCliConfigChannel('{ "channel": "lab" }')).toBe("lab");
      expect(parseCursorCliConfigChannel('{ "channel": "stable" }')).toBe("stable");
      expect(parseCursorCliConfigChannel('{ "version": 1 }')).toBeUndefined();
      expect(parseCursorCliConfigChannel("not-json")).toBeUndefined();
    });
  });

  describe("parseCursorCliConfigCurrentModel", () => {
    it("extracts the current configured model from Cursor CLI config", () => {
      expect(
        parseCursorCliConfigCurrentModel(
          JSON.stringify({
            model: {
              modelId: "composer-2-fast",
              displayModelId: "composer-2-fast",
              displayName: "Composer 2 Fast",
              displayNameShort: "Composer 2 Fast",
            },
          }),
        ),
      ).toEqual({
        slug: "composer-2-fast",
        name: "Composer 2 Fast",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [],
          supportsFastMode: false,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      });
    });

    it("falls back to display model id when no display name is available", () => {
      const currentModel = parseCursorCliConfigCurrentModel(
        JSON.stringify({
          model: {
            modelId: "claude-sonnet-4-6",
            displayModelId: "Claude Sonnet 4.6",
          },
        }),
      );

      expect(currentModel).toMatchObject({
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        isCustom: false,
      });
      expect(currentModel).toBeDefined();
      expect(currentModel?.capabilities).not.toBeNull();
      expect(currentModel?.capabilities?.supportsThinkingToggle).toBe(false);
      expect(currentModel?.capabilities?.reasoningEffortLevels.length).toBeGreaterThan(0);
    });

    it("returns undefined when the config has no current model", () => {
      expect(parseCursorCliConfigCurrentModel('{ "channel": "lab" }')).toBeUndefined();
      expect(parseCursorCliConfigCurrentModel("not-json")).toBeUndefined();
    });
  });

  describe("parseCursorAboutOutput", () => {
    it("surfaces macOS keychain credential failures with a specific message", () => {
      const parsed = parseCursorAboutOutput({
        stdout: "",
        stderr: "ERROR: SecItemCopyMatching failed -50\n",
        code: 1,
      });

      expect(parsed).toEqual({
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message:
          "Cursor Agent CLI could not read its macOS Keychain credentials. Unlock the login keychain, open Cursor once, then run `agent login` again if needed.",
      });
    });
  });

  describe("inferCursorCapabilitiesFromModelSlug", () => {
    it("inherits Claude model capabilities and applies Cursor slug defaults", () => {
      const capabilities = inferCursorCapabilitiesFromModelSlug(
        "claude-opus-4-7[thinking=true,context=200k,effort=high]",
      );

      expect(capabilities.supportsThinkingToggle).toBe(true);
      expect(capabilities.reasoningEffortLevels.some((option) => option.value === "high")).toBe(true);
      expect(
        capabilities.reasoningEffortLevels.find((option) => option.value === "high")?.isDefault,
      ).toBe(true);
      expect(
        capabilities.contextWindowOptions.find((option) => option.value === "200k")?.isDefault,
      ).toBe(true);
      expect(capabilities.promptInjectedEffortLevels).toContain("ultrathink");
    });

    it("uses Codex defaults for GPT-family models and preserves Cursor-specific tokens", () => {
      const capabilities = inferCursorCapabilitiesFromModelSlug(
        "gpt-5.4[context=272k,reasoning=medium,fast=false]",
      );

      expect(capabilities.supportsFastMode).toBe(true);
      expect(
        capabilities.reasoningEffortLevels.find((option) => option.value === "medium")?.isDefault,
      ).toBe(true);
      expect(capabilities.contextWindowOptions).toEqual([
        { value: "272k", label: "272k", isDefault: true },
      ]);
    });
  });

  describe("buildRecoveredCursorProviderSnapshot", () => {
    it("keeps Cursor available with a warning when ACP metadata is available", () => {
      const recovered = buildRecoveredCursorProviderSnapshot({
        checkedAt: "2026-04-22T00:00:00.000Z",
        cursorSettings: BASE_CURSOR_SETTINGS,
        parsed: {
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message:
            "Cursor Agent CLI could not read its macOS Keychain credentials. Unlock the login keychain, open Cursor once, then run `agent login` again if needed.",
        },
        fallbackVersion: "2026.04.17-787b533",
        discoveredModels: [
          {
            slug: "default[]",
            name: "Auto",
            isCustom: false,
            capabilities: EMPTY_CAPABILITIES,
          },
        ],
      });

      expect(recovered.status).toBe("warning");
      expect(recovered.version).toBe("2026.04.17-787b533");
      expect(recovered.auth).toEqual({ status: "unknown" });
      expect(recovered.message).toContain("Using Cursor ACP metadata because `agent about` failed.");
      expect(recovered.message).toContain("macOS Keychain credentials");
      expect(recovered.models).toEqual([
        {
          slug: "default[]",
          name: "Auto",
          isCustom: false,
          capabilities: EMPTY_CAPABILITIES,
        },
      ]);
    });
  });
});
