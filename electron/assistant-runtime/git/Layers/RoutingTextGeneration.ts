// @ts-nocheck
/**
 * RoutingTextGeneration – Dispatches text generation requests to the provider
 * instance selected by each model selection.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer } from "effect";

import { TextGeneration, type TextGenerationShape } from "../Services/TextGeneration.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../../provider/ProviderDriver.ts";

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle";

const resolveInstanceTextGeneration = (
  registry: ProviderInstanceRegistryShape,
  operation: TextGenerationOp,
  instanceId: string,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistryShape,
): TextGenerationShape => ({
  generateCommitMessage: (input) =>
    resolveInstanceTextGeneration(
      registry,
      "generateCommitMessage",
      input.modelSelection.instanceId,
    ).pipe(Effect.flatMap((textGeneration) => textGeneration.generateCommitMessage(input))),
  generatePrContent: (input) =>
    resolveInstanceTextGeneration(
      registry,
      "generatePrContent",
      input.modelSelection.instanceId,
    ).pipe(Effect.flatMap((textGeneration) => textGeneration.generatePrContent(input))),
  generateBranchName: (input) =>
    resolveInstanceTextGeneration(
      registry,
      "generateBranchName",
      input.modelSelection.instanceId,
    ).pipe(Effect.flatMap((textGeneration) => textGeneration.generateBranchName(input))),
  generateThreadTitle: (input) =>
    resolveInstanceTextGeneration(
      registry,
      "generateThreadTitle",
      input.modelSelection.instanceId,
    ).pipe(Effect.flatMap((textGeneration) => textGeneration.generateThreadTitle(input))),
});

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  Effect.gen(function* () {
    const registry = yield* ProviderInstanceRegistry;
    return makeTextGenerationFromRegistry(registry);
  }),
);
