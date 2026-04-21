import { describe, expect, it } from "vitest";

import {
  parseCursorCliConfigChannel,
  parseCursorCliConfigCurrentModel,
} from "./CursorProvider.ts";

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
      expect(
        parseCursorCliConfigCurrentModel(
          JSON.stringify({
            model: {
              modelId: "claude-sonnet-4-6",
              displayModelId: "Claude Sonnet 4.6",
            },
          }),
        ),
      ).toEqual({
        slug: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
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

    it("returns undefined when the config has no current model", () => {
      expect(parseCursorCliConfigCurrentModel('{ "channel": "lab" }')).toBeUndefined();
      expect(parseCursorCliConfigCurrentModel("not-json")).toBeUndefined();
    });
  });
});
