import re

with open("server/src/routes/ai/providerHelpers.ts", "r") as f:
    content = f.read()

# Fix Anthropic thinking configuration builder
pattern = r"if \(capabilities.supportsExtendedThinking && capabilities.reasoningType === 'budget'\) \{.*?options\.thinking = thinkingOptions\n    \}"
replacement = """if (capabilities.supportsExtendedThinking && capabilities.reasoningType === 'budget') {
      const range = capabilities.reasoningRange as { min: number; max: number } | string[]
      const thinkingOptions: Record<string, any> = { type: 'enabled' }

      if (Array.isArray(range)) {
        // Handle array range (e.g. ['low', 'medium', 'high', 'max'])
        const explicitBudget = requestOptions?.thinkingBudget
        if (explicitBudget && explicitBudget >= 1024) {
          thinkingOptions.budgetTokens = explicitBudget
        } else {
          const budgetMap: Record<'low' | 'medium' | 'high' | 'max', number> = {
            low: 1024,
            medium: 4000,
            high: 16000,
            max: 32000,
          }
          thinkingOptions.budgetTokens = budgetMap[variant] || 16000
        }
      } else {
        // Handle numeric range (min/max)
        const explicitBudget = requestOptions?.thinkingBudget
        if (explicitBudget && explicitBudget >= range.min) {
          thinkingOptions.budgetTokens = Math.min(explicitBudget, range.max)
        } else {
          const budgetMap: Record<'low' | 'medium' | 'high' | 'max', number> = {
            low: range.min,
            medium: Math.floor((range.max - range.min) / 2 + range.min),
            high: Math.min(range.max, 16_000),
            max: range.max,
          }
          thinkingOptions.budgetTokens = budgetMap[variant] || range.min
        }
      }

      if (capabilities.supportsEffortParameter) {
        const effort = requestOptions?.thinkingEffort || (variant === 'max' ? 'high' : variant)
        options.effort = effort
      }

      options.thinking = thinkingOptions
    }"""

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open("server/src/routes/ai/providerHelpers.ts", "w") as f:
    f.write(content)

