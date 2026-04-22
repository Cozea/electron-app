/**
 * Optional integration check against a real `agent acp` install.
 * Enable with: T3_CURSOR_ACP_PROBE=1 bun run test --filter CursorAcpCliProbe
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { describe, expect } from "vitest";

import { AcpSessionRuntime, layerAcpSessionRuntime } from "../../../../../electron/assistant-runtime/provider/acp/AcpSessionRuntime.ts";

describe.runIf(process.env.T3_CURSOR_ACP_PROBE === "1")("Cursor ACP CLI probe", () => {
  it.effect("initialize and authenticate against real agent acp", () =>
    Effect.gen(function* () {
      const runtime = yield* AcpSessionRuntime;
      const started = yield* runtime.start();
      expect(started.initializeResult).toBeDefined();
    }).pipe(
      Effect.provide(
        layerAcpSessionRuntime({
          spawn: {
            command: "agent",
            args: ["acp"],
            cwd: process.cwd(),
          },
          cwd: process.cwd(),
          clientCapabilities: {
            _meta: {
              parameterizedModelPicker: true,
            },
          },
          clientInfo: { name: "t3-probe", version: "0.0.0" },
          authMethodId: "cursor_login",
        }),
      ),
      Effect.provide(NodeServices.layer),
    )
  );
});
