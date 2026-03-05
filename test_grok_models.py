import re

with open("server/src/routes/ai/modelCatalog.ts", "r") as f:
    content = f.read()

# 11. xAI: Fix model IDs
content = content.replace(
    "providerModelId: 'grok-4-fast-reasoning',",
    "providerModelId: 'grok-4-fast',"
)
content = content.replace(
    "'grok-4-1': {\n    provider: 'xai',\n    providerModelId: 'grok-4-1',\n    tier: 'powerful',\n    displayName: 'Grok 4.1',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'none',",
    "'grok-4-1': {\n    provider: 'xai',\n    providerModelId: 'grok-4-1-fast',\n    tier: 'powerful',\n    displayName: 'Grok 4.1 Fast',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],"
)
content = content.replace(
    "'grok-4-fast': {\n    provider: 'xai',\n    providerModelId: 'grok-4-fast',\n    tier: 'standard',\n    displayName: 'Grok 4 Fast',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'high'],",
    "'grok-4-fast': {\n    provider: 'xai',\n    providerModelId: 'grok-4-fast',\n    tier: 'standard',\n    displayName: 'Grok 4 Fast',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],"
)
content = content.replace(
    "'grok-code-fast-1': {\n    provider: 'xai',\n    providerModelId: 'grok-code-fast-1',\n    tier: 'fast',\n    displayName: 'Grok Code',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',  // xAI uses reasoningEffort\n      reasoningRange: ['low', 'high'],",
    "'grok-code-fast-1': {\n    provider: 'xai',\n    providerModelId: 'grok-code-fast-1',\n    tier: 'fast',\n    displayName: 'Grok Code',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',  // xAI uses reasoningEffort\n      reasoningRange: ['low', 'medium', 'high'],"
)

with open("server/src/routes/ai/modelCatalog.ts", "w") as f:
    f.write(content)
