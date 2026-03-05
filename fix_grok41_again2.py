import re

with open("server/src/routes/ai/modelCatalog.ts", "r") as f:
    content = f.read()

content = content.replace(
    "providerModelId: 'grok-4-1',",
    "providerModelId: 'grok-4-1-fast',"
)

with open("server/src/routes/ai/modelCatalog.ts", "w") as f:
    f.write(content)
