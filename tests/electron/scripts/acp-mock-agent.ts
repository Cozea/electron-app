/**
 * Mock ACP agent used by AcpSessionRuntime tests
 * (tests/electron/assistant-runtime/provider/acp/AcpJsonRpcConnection.test.ts).
 *
 * Speaks the Agent Client Protocol over stdio via @cozea/effect-acp's agent
 * helper. Prompt behavior is selected through environment variables:
 *  - T3_ACP_EMIT_INTERLEAVED_ASSISTANT_TOOL_CALLS=1
 *      text chunk, tool call (with detail), tool completion, text chunk
 *  - T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS=1
 *      generic placeholder tool update (no detail), then completed update
 *  - default
 *      plan update (2 entries) followed by one text chunk
 *  - T3_ACP_REQUEST_LOG_PATH=<file>
 *      append every received request as ndjson {method, params}
 */
import { appendFileSync } from "node:fs";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

import * as AcpAgent from "../../../packages/effect-acp/src/agent.ts";

const sessionId = "mock-session-1";
const requestLogPath = process.env.T3_ACP_REQUEST_LOG_PATH;

function logRequest(method: string, params: unknown): void {
  if (!requestLogPath) return;
  appendFileSync(requestLogPath, `${JSON.stringify({ method, params })}\n`);
}

let currentModelValue = "default";

const modelSelectOptions = [
  { name: "Default", value: "default" },
  { name: "Composer 2", value: "composer-2" },
  { name: "Composer 2 Fast", value: "composer-2[fast=true]" },
];

function currentConfigOptions() {
  return [
    {
      type: "select" as const,
      id: "model",
      name: "Model",
      category: "model" as const,
      currentValue: currentModelValue,
      options: modelSelectOptions,
    },
  ];
}

const sessionModes = {
  currentModeId: "ask",
  availableModes: [
    { id: "ask", name: "Ask" },
    { id: "agent", name: "Agent" },
  ],
};

const program = Effect.gen(function* () {
  const agent = yield* AcpAgent.AcpAgent;

  yield* agent.handleInitialize((params) =>
    Effect.sync(() => {
      logRequest("initialize", params);
      return {
        protocolVersion: 1,
        agentCapabilities: {},
        agentInfo: {
          name: "acp-mock-agent",
          version: "0.0.0",
        },
      };
    }),
  );

  yield* agent.handleAuthenticate((params) =>
    Effect.sync(() => {
      logRequest("authenticate", params);
      return {};
    }),
  );

  yield* agent.handleCreateSession((params) =>
    Effect.sync(() => {
      logRequest("session/new", params);
      return {
        sessionId,
        configOptions: currentConfigOptions(),
        modes: sessionModes,
      };
    }),
  );

  yield* agent.handleLoadSession((params) =>
    Effect.sync(() => {
      logRequest("session/load", params);
      return {};
    }),
  );

  yield* agent.handleSetSessionConfigOption((params) =>
    Effect.sync(() => {
      logRequest("session/set_config_option", params);
      if (params.configId === "model" && typeof params.value === "string") {
        currentModelValue = params.value;
      }
      return {
        configOptions: currentConfigOptions(),
      };
    }),
  );

  yield* agent.handleCancel((params) =>
    Effect.sync(() => {
      logRequest("session/cancel", params);
    }),
  );

  yield* agent.handlePrompt((params) =>
    Effect.gen(function* () {
      logRequest("session/prompt", params);

      if (process.env.T3_ACP_EMIT_INTERLEAVED_ASSISTANT_TOOL_CALLS === "1") {
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Let me check the README first. " },
          },
        });
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Run analysis",
            status: "in_progress",
            rawInput: { command: "cat README.md" },
          },
        });
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            status: "completed",
          },
        });
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "The README looks fine." },
          },
        });
        return { stopReason: "end_turn" as const };
      }

      if (process.env.T3_ACP_EMIT_GENERIC_TOOL_PLACEHOLDERS === "1") {
        // Generic placeholder: title normalizes away and there is no command or
        // content, so the runtime derives no detail and suppresses the update.
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tool-1",
            title: "Tool call",
            status: "in_progress",
          },
        });
        yield* agent.client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-1",
            title: "Read file",
            kind: "read",
            status: "completed",
          },
        });
        return { stopReason: "end_turn" as const };
      }

      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            {
              content: "Inspect the repository",
              priority: "high",
              status: "in_progress",
            },
            {
              content: "Summarize the findings",
              priority: "medium",
              status: "pending",
            },
          ],
        },
      });
      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello from the mock agent." },
        },
      });
      return { stopReason: "end_turn" as const };
    }),
  );

  yield* agent.handleUnknownExtRequest((method, params) =>
    Effect.sync(() => {
      logRequest(method, params);
      return {
        echoedMethod: method,
        echoedParams: params ?? null,
      };
    }),
  );

  return yield* Effect.never;
});

program.pipe(
  Effect.provide(Layer.provide(AcpAgent.layerStdio(), NodeServices.layer)),
  NodeRuntime.runMain,
);
