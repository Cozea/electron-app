import os
import re

components = [
    "src/lib/ai/useAiChatTransport.ts",
]

for filepath in components:
    if not os.path.exists(filepath):
        continue
    with open(filepath, "r") as f:
        content = f.read()

    # Drop explicit 'medium' fallback from chat transport args
    content = content.replace("variantId: variantId ?? 'medium',", "variantId: variantId,")
    content = content.replace("const fallback = variantId ?? normalizedVariantId", "const fallback = variantId ?? normalizedVariantId") # Keep fallback logic but variantId can be undefined now.

    with open(filepath, "w") as f:
        f.write(content)

