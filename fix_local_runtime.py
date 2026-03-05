import re

with open("electron/services/LocalAiRuntimeService.ts", "r") as f:
    content = f.read()

content = content.replace(
    "const resolvedVariantId = normalizeModelVariant({",
    "const resolvedVariantId = normalizeModelVariant({"
)

with open("electron/services/LocalAiRuntimeService.ts", "w") as f:
    f.write(content)
