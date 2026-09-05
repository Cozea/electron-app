import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ChatAttachment, TurnCountRange } from "../../packages/contracts/src/t3/orchestration";
import { UserInputRequestedPayload, UserInputQuestion } from "../../packages/contracts/src/t3/providerRuntime";
import { AntigravitySettings, ServerSettings } from "../../packages/contracts/src/t3/settings";
import { ProviderSetupError } from "../../packages/contracts/src/t3/providerSetup";
import { assertT3RuntimeIdentity, assertNodeVersionForT3Server } from "../../apps/server/src/t3/paths";

const question = { id: "q1", header: "Choice", question: "Which option?", options: [{ label: "A", description: "", value: "native-a" }], allowCustomAnswer: false };

describe("adapted T3 wire contracts", () => {
  it("retains async delivery and native choice identity under the root Effect pin", () => {
    const request = { responseMode: "message", questions: [question] };
    expect(Schema.decodeUnknownSync(UserInputRequestedPayload)(request)).toEqual(request);
    expect(UserInputQuestion.makeUnsafe(question).multiSelect).toBe(false);
    expect(Schema.decodeUnknownSync(UserInputRequestedPayload)({ questions: [{ ...question, options: [], allowCustomAnswer: true }] }).questions).toHaveLength(1);
  });

  it("decodes default settings and keeps Antigravity explicitly opt-in", () => {
    expect(Schema.decodeUnknownSync(AntigravitySettings)({}).enabled).toBe(false);
    const settings = Schema.decodeUnknownSync(ServerSettings)({});
    expect(settings.textGenerationModelSelection.instanceId).toBe("codex");
  });

  it("retains file-bearing history and rejects malformed known attachment variants", () => {
    const file = { type: "file", id: "saved-file", name: "notes.pdf", mimeType: "application/pdf", sizeBytes: 42 };
    expect(Schema.decodeUnknownSync(ChatAttachment)(file)).toEqual(file);
    expect(Schema.is(ChatAttachment)({ ...file, sizeBytes: 0 })).toBe(false);
    expect(Schema.decodeUnknownSync(ChatAttachment)({ ...file, type: "future" }).type).toBe("future");
    expect(() => Schema.decodeUnknownSync(TurnCountRange)({ fromTurnCount: 2, toTurnCount: 1 })).toThrow("fromTurnCount");
    expect(new ProviderSetupError({ instanceId: settingsInstanceId(), operation: "sign-in", detail: "Retry sign-in" }).message).toBe("Retry sign-in");
  });
});

function settingsInstanceId() {
  return Schema.decodeUnknownSync(ServerSettings)({}).textGenerationModelSelection.instanceId;
}

describe("runtime/client revision gate", () => {
  it("rejects old, newer, and unstamped runtimes before startup", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-runtime-identity-"));
    try {
      expect(() => assertT3RuntimeIdentity(root, "expected")).toThrow("has not been opened");
      for (const t3Pin of ["old", "newer"]) {
        fs.writeFileSync(path.join(root, "cozea-runtime.json"), JSON.stringify({ t3Pin }));
        expect(() => assertT3RuntimeIdentity(root, "expected")).toThrow("does not match");
      }
      fs.writeFileSync(path.join(root, "cozea-runtime.json"), JSON.stringify({ t3Pin: "expected" }));
      expect(() => assertT3RuntimeIdentity(root, "expected")).not.toThrow();
      fs.unlinkSync(path.join(root, "cozea-runtime.json"));
      fs.mkdirSync(path.join(root, "dist"));
      fs.writeFileSync(path.join(root, "dist", ".cozea-runtime-pin"), "expected:local-changes\n");
      expect(() => assertT3RuntimeIdentity(root, "expected")).not.toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches the pinned server's supported Node engines", () => {
    for (const version of ["22.16.0", "23.11.0", "24.10.0", "25.0.0"]) expect(() => assertNodeVersionForT3Server(version)).not.toThrow();
    for (const version of ["22.15.0", "23.0.0", "24.0.0"]) expect(() => assertNodeVersionForT3Server(version)).toThrow();
  });
});
