import re

with open("server/src/routes/ai/modelCatalog.ts", "r") as f:
    content = f.read()

# Using regex to target exactly the capabilities block for grok-4-1
pattern = r"('grok-4-1': \{.*?providerModelId: 'grok-4-1-fast',.*?capabilities: \{).*?(\},)"
replacement = r"\1\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],\n      supportsWebSearch: true,\n      supportsFileSearch: false,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: false,\n      supportsShellTool: false,\n      supportsTextEditor: false,\n      supportsApplyPatch: false,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: false,\n      supportsImageInput: true,\n      supportsImageGeneration: false,\n      supportsPredictedOutput: false,\n      promptCachingType: 'none',\n    \2"

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open("server/src/routes/ai/modelCatalog.ts", "w") as f:
    f.write(content)
