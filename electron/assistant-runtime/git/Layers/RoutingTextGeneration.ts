// @ts-nocheck
/**
 * RoutingTextGeneration – Dispatches text generation requests to the concrete
 * provider-specific implementation based on the provider in each request input.
 *
 * Known providers map to Codex, Claude, Cursor, or OpenCode. Unknown or
 * absent providers fall back to Codex.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, ServiceMap } from "effect";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { CursorTextGenerationLive } from "./CursorTextGeneration.ts";
import { OpenCodeTextGenerationLive } from "./OpenCodeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends ServiceMap.Service<CodexTextGen, TextGenerationShape>()(
  "cozea/assistant-runtime/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends ServiceMap.Service<ClaudeTextGen, TextGenerationShape>()(
  "cozea/assistant-runtime/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

class CursorTextGen extends ServiceMap.Service<CursorTextGen, TextGenerationShape>()(
  "cozea/assistant-runtime/git/Layers/RoutingTextGeneration/CursorTextGen",
) {}

class OpenCodeTextGen extends ServiceMap.Service<OpenCodeTextGen, TextGenerationShape>()(
  "cozea/assistant-runtime/git/Layers/RoutingTextGeneration/OpenCodeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;
  const cursor = yield* CursorTextGen;
  const openCode = yield* OpenCodeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape =>
    provider === "claudeAgent"
      ? claude
      : provider === "opencode"
        ? openCode
        : provider === "cursor"
          ? cursor
          : codex;

  return {
    generateCommitMessage: (input) =>
      route(input.modelSelection.provider).generateCommitMessage(input),
    generatePrContent: (input) => route(input.modelSelection.provider).generatePrContent(input),
    generateBranchName: (input) => route(input.modelSelection.provider).generateBranchName(input),
    generateThreadTitle: (input) =>
      route(input.modelSelection.provider).generateThreadTitle(input),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

const InternalCursorLayer = Layer.effect(
  CursorTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CursorTextGenerationLive));

const InternalOpenCodeLayer = Layer.effect(
  OpenCodeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(OpenCodeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(
  Layer.provide(InternalCodexLayer),
  Layer.provide(InternalClaudeLayer),
  Layer.provide(InternalCursorLayer),
  Layer.provide(InternalOpenCodeLayer),
);
