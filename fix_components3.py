import re

with open("src/components/builder/BuilderConversation.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "const variantId = promptSettings?.variantId ?? 'medium'",
    "const variantId = promptSettings?.variantId"
)

with open("src/components/builder/BuilderConversation.tsx", "w") as f:
    f.write(content)
