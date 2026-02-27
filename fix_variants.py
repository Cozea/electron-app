import re

with open("server/src/routes/ai/modelVariants.ts", "r") as f:
    content = f.read()

# 1. getSupportedModelVariants: Handle Gemini 3.1 correctly (level -> low, medium, high)
# Note: Google models support 'low', 'high' or 'low', 'medium', 'high' depending on ID/range.
# The code currently uses:
# if (provider === 'google') {
#   if (capabilities.reasoningType === 'level') {
#     return ['low', 'high']
#   }

content = content.replace(
    "if (capabilities.reasoningType === 'level') {\n      return ['low', 'high']\n    }",
    "if (capabilities.reasoningType === 'level') {\n      const range = modelDeclaredVariants.length > 0 ? modelDeclaredVariants : ['low', 'high'];\n      return range;\n    }"
)

# 2. Fix normalizeModelVariant forcing high for google:
# if (args.provider === 'google' && supported.includes('high')) {
#    return 'high'
#  }
# Google should fallback to 'medium' if supported, else 'high'
content = content.replace(
    "if (args.provider === 'google' && supported.includes('high')) {\n    return 'high'\n  }",
    "if (args.provider === 'google') {\n    if (supported.includes(DEFAULT_VARIANT_ID)) return DEFAULT_VARIANT_ID\n    if (supported.includes('high')) return 'high'\n  }"
)

# 3. Fix non-reasoning variants to return undefined / omit 'medium' if not supported.
# Currently: if (capabilities.reasoningType === 'none') return [DEFAULT_VARIANT_ID] -> 'medium'
content = content.replace(
    "if (capabilities.reasoningType === 'none') {\n    return [DEFAULT_VARIANT_ID]\n  }",
    "if (capabilities.reasoningType === 'none') {\n    return []\n  }"
)

# Fix normalize fallback for none
content = content.replace(
    "return supported[0]!",
    "return supported[0] as VariantId"
)

with open("server/src/routes/ai/modelVariants.ts", "w") as f:
    f.write(content)
