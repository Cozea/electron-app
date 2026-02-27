import re

with open("src/lib/ai/runtimeProfiles.ts", "r") as f:
    content = f.read()

# 1. getSupportedVariantsForModel: Handle non-reasoning and Google Gemini
content = content.replace(
    "if (!capabilities || capabilities.reasoningType === 'none') {\n    return [DEFAULT_VARIANT_ID]\n  }",
    "if (!capabilities || capabilities.reasoningType === 'none') {\n    return []\n  }"
)
content = content.replace(
    "if (capabilities.reasoningType === 'level') {\n      return ['low', 'high']\n    }",
    "if (capabilities.reasoningType === 'level') {\n      return modelDeclaredVariants.length > 0 ? modelDeclaredVariants : ['low', 'high']\n    }"
)

# 2. normalizeVariantForModel: Handle fallback
content = content.replace(
    "if (!args.capabilities) {\n    if (requested && isVariantId(requested)) {\n      return requested\n    }\n    return DEFAULT_VARIANT_ID\n  }",
    "if (!args.capabilities) {\n    if (requested && isVariantId(requested)) {\n      return requested\n    }\n    return undefined as any // Fallback to undefined for unknown models\n  }"
)
content = content.replace(
    "if (args.provider === 'google' && supported.includes('high')) {\n    return 'high'\n  }",
    "if (args.provider === 'google') {\n    if (supported.includes(DEFAULT_VARIANT_ID)) return DEFAULT_VARIANT_ID\n    if (supported.includes('high')) return 'high'\n  }"
)

with open("src/lib/ai/runtimeProfiles.ts", "w") as f:
    f.write(content)

with open("server/src/routes/ai/modelVariants.ts", "r") as f:
    content2 = f.read()

content2 = content2.replace(
    "export function normalizeModelVariant(args: {\n  requestedVariant: VariantId | undefined\n  provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'github-copilot' | 'gitlab'\n  modelId: string\n  capabilities: ModelCapabilities\n}): VariantId {",
    "export function normalizeModelVariant(args: {\n  requestedVariant: VariantId | undefined\n  provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'github-copilot' | 'gitlab'\n  modelId: string\n  capabilities: ModelCapabilities\n}): VariantId | undefined {"
)
with open("server/src/routes/ai/modelVariants.ts", "w") as f:
    f.write(content2)
