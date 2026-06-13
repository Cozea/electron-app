import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ModelSelection } from "../../../shared/assistant-contracts/orchestration";

const decode = Schema.decodeUnknownSync(ModelSelection);
const decodeExit = Schema.decodeUnknownExit(ModelSelection);

describe("ModelSelection decode", () => {
  it("preserves an explicit provider for a custom instance id", () => {
    const parsed = decode({ provider: "claudeAgent", instanceId: "my-claude", model: "sonnet" });
    expect(parsed.provider).toBe("claudeAgent");
    expect(parsed.instanceId).toBe("my-claude");
    expect(parsed.model).toBe("sonnet");
  });

  it("infers a built-in provider from a built-in instance id when provider is absent", () => {
    const parsed = decode({ instanceId: "claudeAgent", model: "sonnet" });
    // The built-in instance id "claudeAgent" recovers the driver, NOT codex.
    expect(parsed.provider).toBe("claudeAgent");
    expect(parsed.instanceId).toBe("claudeAgent");
  });

  it("defaults the instance id to the driver when only a legacy provider is present", () => {
    const parsed = decode({ provider: "cursor", model: "auto" });
    expect(parsed.provider).toBe("cursor");
    expect(parsed.instanceId).toBe("cursor");
  });

  it("rejects a payload with only a model (instance id is required)", () => {
    // No provider and no instance id: the default provider ("codex") is applied
    // but the wire schema still requires an instanceId, so decode fails. This is
    // unchanged behavior — asserted here to pin it.
    const exit = decodeExit({ model: "gpt-5" });
    expect(exit._tag).toBe("Failure");
  });

  it("rejects a custom instance id with no provider instead of mislabeling it as codex", () => {
    // Regression for the silent codex mislabel: a custom (non-built-in) instance
    // id with no explicit provider cannot be attributed to a driver, so decode
    // must fail rather than default to "codex".
    const exit = decodeExit({ instanceId: "my-claude", model: "sonnet" });
    expect(exit._tag).toBe("Failure");
  });

  it("encodes back to the wire shape", () => {
    const parsed = decode({ provider: "opencode", instanceId: "opencode", model: "gpt" });
    const encoded = Schema.encodeUnknownSync(ModelSelection)(parsed);
    expect(encoded).toMatchObject({
      provider: "opencode",
      instanceId: "opencode",
      model: "gpt",
    });
  });
});
