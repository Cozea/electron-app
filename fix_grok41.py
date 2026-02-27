import re

with open("server/src/routes/ai/modelCatalog.ts", "r") as f:
    content = f.read()

content = content.replace(
    "'grok-4-1': {\n    provider: 'xai',\n    providerModelId: 'grok-4-1',\n    tier: 'powerful',\n    displayName: 'Grok 4.1',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'none',",
    "'grok-4-1': {\n    provider: 'xai',\n    providerModelId: 'grok-4-1-fast',\n    tier: 'powerful',\n    displayName: 'Grok 4.1 Fast',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],"
)
with open("server/src/routes/ai/modelCatalog.ts", "w") as f:
    f.write(content)
