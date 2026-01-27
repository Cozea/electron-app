"use client";

import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextCacheUsage,
  ContextTrigger,
  type LanguageModelUsage,
} from "@/components/ai-elements/context";

// Model context window sizes (in tokens)
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI - GPT-5.x series (400K context)
  "gpt-5.1": 400_000,
  "gpt-5.1-mini": 400_000,
  "gpt-5.2": 400_000,
  // OpenAI - Legacy models
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
  "o1": 200_000,
  "o1-mini": 128_000,
  "o1-preview": 128_000,
  "o3-mini": 200_000,
  // Anthropic - Claude 4.5 series (200K context)
  "claude-haiku-4-5": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-opus-4-5": 200_000,
  // Anthropic - Legacy models
  "claude-3-5-sonnet-20241022": 200_000,
  "claude-3-5-haiku-20241022": 200_000,
  "claude-3-opus-20240229": 200_000,
  "claude-3-sonnet-20240229": 200_000,
  "claude-3-haiku-20240307": 200_000,
  "claude-sonnet-4-20250514": 200_000,
  "claude-opus-4-20250514": 200_000,
  // Google - Gemini 3 series (1M context)
  "gemini-3-flash": 1_000_000,
  "gemini-3-pro": 1_000_000,
  // Google - Gemini 2.5 series
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  // Google - Legacy models
  "gemini-2.0-flash-exp": 1_048_576,
  "gemini-2.0-flash": 1_048_576,
  "gemini-1.5-pro": 2_097_152,
  "gemini-1.5-flash": 1_048_576,
  // DeepSeek
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
  // Mistral
  "mistral-large-latest": 128_000,
  "mistral-small-latest": 32_000,
  // xAI
  "grok-2": 131_072,
  "grok-beta": 131_072,
  // Default fallback
  default: 200_000,
};

export function getContextWindowSize(modelId: string): number {
  // Try exact match first
  if (MODEL_CONTEXT_WINDOWS[modelId]) {
    return MODEL_CONTEXT_WINDOWS[modelId];
  }

  // Try matching by model family
  const modelLower = modelId.toLowerCase();
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (modelLower.includes(key.toLowerCase())) {
      return value;
    }
  }

  return MODEL_CONTEXT_WINDOWS.default;
}

export interface ContextDisplayProps {
  /** Model identifier for context window lookup and cost calculation */
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
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.reasoningTokens ?? 0);

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
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}

export default ContextDisplay;
