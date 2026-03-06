"use client";

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextCacheUsage,
  ContextTrigger,
  type LanguageModelUsage,
} from "@/components/ai-elements/context";
import { getCachedModelContextWindow } from "@/lib/ai/modelCatalogClient";

export function getContextWindowSize(modelId: string): number | undefined {
  return getCachedModelContextWindow(modelId);
}

export interface ContextDisplayProps {
  /** Model identifier for context window lookup */
  modelId: string;
  /** Token usage from the AI SDK response */
  usage: LanguageModelUsage;
  /** Optional override for max tokens (auto-detected from modelId if not provided) */
  maxTokens?: number;
  /** Optional className for styling */
  className?: string;
}

/**
 * Displays token usage information with a progress bar and detailed breakdown.
 * Automatically determines context window size based on the model.
 *
 * @example
 * ```tsx
 * <ContextDisplay
 *   modelId="gpt-4o"
 *   usage={{
 *     inputTokens: 1500,
 *     outputTokens: 500,
 *     reasoningTokens: 200,
 *   }}
 * />
 * ```
 */
export function ContextDisplay({
  modelId,
  usage,
  maxTokens,
  className,
}: ContextDisplayProps) {
  const contextWindow = maxTokens ?? getContextWindowSize(modelId);
  const usedTokens =
    usage.totalTokens ??
    ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));

  // Check for cache usage (may be in inputTokenDetails)
  const hasCacheUsage =
    usage.inputTokenDetails?.cacheReadTokens !== undefined ||
    usage.inputTokenDetails?.cacheWriteTokens !== undefined;

  return (
    <Context
      maxTokens={contextWindow}
      usedTokens={usedTokens}
      usage={usage}
      modelId={modelId}
    >
      <ContextTrigger className={className} />
      <ContextContent>
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          {usage.reasoningTokens !== undefined && usage.reasoningTokens > 0 && (
            <ContextReasoningUsage />
          )}
          {hasCacheUsage && <ContextCacheUsage />}
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

export default ContextDisplay;
