import re

with open("server/src/routes/ai/modelCatalog.ts", "r") as f:
    content = f.read()

# 1. Gemini 3.1 Pro Variants: ['low', 'high'] -> ['low', 'medium', 'high']
content = content.replace(
    "'gemini-3.1-pro': {\n    provider: 'google',\n    providerModelId: 'gemini-3.1-pro-preview',\n    tier: 'powerful',\n    displayName: 'Gemini 3.1 Pro',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'level',\n      reasoningRange: ['low', 'high'],",
    "'gemini-3.1-pro': {\n    provider: 'google',\n    providerModelId: 'gemini-3.1-pro-preview',\n    tier: 'powerful',\n    displayName: 'Gemini 3.1 Pro',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'level',\n      reasoningRange: ['low', 'medium', 'high'],"
)
content = content.replace(
    "'gemini-3.1-pro-customtools': {\n    provider: 'google',\n    providerModelId: 'gemini-3.1-pro-preview-customtools',\n    tier: 'powerful',\n    displayName: 'Gemini 3.1 Pro (Custom Tools)',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'level',\n      reasoningRange: ['low', 'high'],",
    "'gemini-3.1-pro-customtools': {\n    provider: 'google',\n    providerModelId: 'gemini-3.1-pro-preview-customtools',\n    tier: 'powerful',\n    displayName: 'Gemini 3.1 Pro (Custom Tools)',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'level',\n      reasoningRange: ['low', 'medium', 'high'],"
)

# 2. Anthropic Haiku 4.5: add reasoning capability
content = content.replace(
    "'claude-haiku-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-haiku-4-5-20251001',\n    tier: 'fast',\n    displayName: 'Claude Haiku 4.5',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'none',",
    "'claude-haiku-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-haiku-4-5-20251001',\n    tier: 'fast',\n    displayName: 'Claude Haiku 4.5',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['high', 'max'],"
)

# 3. Anthropic Sonnet 4.5: fix reasoningRange
content = content.replace(
    "'claude-sonnet-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-sonnet-4-5-20250929',\n    tier: 'standard',\n    displayName: 'Claude Sonnet 4.5',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['low', 'medium', 'high'],",
    "'claude-sonnet-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-sonnet-4-5-20250929',\n    tier: 'standard',\n    displayName: 'Claude Sonnet 4.5',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['high', 'max'],"
)

# 4. Anthropic Opus 4.5: fix reasoningRange
content = content.replace(
    "'claude-opus-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-opus-4-5-20251101',\n    tier: 'powerful',\n    displayName: 'Claude Opus 4.5',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],",
    "'claude-opus-4-5': {\n    provider: 'anthropic',\n    providerModelId: 'claude-opus-4-5-20251101',\n    tier: 'powerful',\n    displayName: 'Claude Opus 4.5',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['high', 'max'],"
)

# 5. Anthropic Opus 4.6: fix reasoningRange and reasoningType
content = content.replace(
    "'claude-opus-4-6': {\n    provider: 'anthropic',\n    providerModelId: 'claude-opus-4-6',\n    tier: 'powerful',\n    displayName: 'Claude Opus 4.6',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],",
    "'claude-opus-4-6': {\n    provider: 'anthropic',\n    providerModelId: 'claude-opus-4-6',\n    tier: 'powerful',\n    displayName: 'Claude Opus 4.6',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['low', 'medium', 'high', 'max'],"
)

# 6. OpenAI GPT-5.1-Codex-Mini: reasoning capability
content = content.replace(
    "'gpt-5.1-codex-mini': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.1-codex-mini',\n    tier: 'standard',\n    displayName: 'GPT-5.1-Codex-Mini',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],",
    "'gpt-5.1-codex-mini': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.1-codex-mini',\n    tier: 'standard',\n    displayName: 'GPT-5.1-Codex-Mini',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],"
)

# 7. OpenAI GPT-5.1-Codex-Max: reasoning capability
content = content.replace(
    "'gpt-5.1-codex-max': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.1-codex-max',\n    tier: 'powerful',\n    displayName: 'GPT-5.1-Codex-Max',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],",
    "'gpt-5.1-codex-max': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.1-codex-max',\n    tier: 'powerful',\n    displayName: 'GPT-5.1-Codex-Max',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high'],"
)

# 8. OpenAI GPT-5.2-Codex: PDF input capability
content = content.replace(
    "'gpt-5.2-codex': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.2-codex',\n    tier: 'powerful',\n    displayName: 'GPT-5.2-Codex',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high', 'xhigh'],\n      supportsWebSearch: true,\n      supportsFileSearch: true,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: true,\n      supportsShellTool: true,\n      supportsTextEditor: false,\n      supportsApplyPatch: true,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: false,",
    "'gpt-5.2-codex': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.2-codex',\n    tier: 'powerful',\n    displayName: 'GPT-5.2-Codex',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high', 'xhigh'],\n      supportsWebSearch: true,\n      supportsFileSearch: true,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: true,\n      supportsShellTool: true,\n      supportsTextEditor: false,\n      supportsApplyPatch: true,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: true,"
)

# 9. OpenAI GPT-5.3-Codex: PDF input capability
content = content.replace(
    "'gpt-5.3-codex': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.3-codex',\n    tier: 'powerful',\n    displayName: 'GPT-5.3-Codex',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high', 'xhigh'],\n      supportsWebSearch: true,\n      supportsFileSearch: true,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: true,\n      supportsShellTool: true,\n      supportsTextEditor: false,\n      supportsApplyPatch: true,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: false,",
    "'gpt-5.3-codex': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.3-codex',\n    tier: 'powerful',\n    displayName: 'GPT-5.3-Codex',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['low', 'medium', 'high', 'xhigh'],\n      supportsWebSearch: true,\n      supportsFileSearch: true,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: true,\n      supportsShellTool: true,\n      supportsTextEditor: false,\n      supportsApplyPatch: true,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: true,"
)

# 10. OpenAI GPT-5.2: drop minimal variant
content = content.replace(
    "'gpt-5.2': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.2',\n    tier: 'powerful',\n    displayName: 'GPT-5.2',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],",
    "'gpt-5.2': {\n    provider: 'openai',\n    providerModelId: 'gpt-5.2',\n    tier: 'powerful',\n    displayName: 'GPT-5.2',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'effort',\n      reasoningRange: ['none', 'low', 'medium', 'high', 'xhigh'],"
)

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

# 12. GitLab Duo: Align
content = content.replace(
    "'gitlab-duo-agentic': {\n    provider: 'gitlab',\n    providerModelId: 'duo-chat-sonnet-4-5',\n    tier: 'standard',\n    displayName: 'GitLab Duo Agentic Chat',\n    capabilities: {\n      supportsExtendedThinking: false,\n      reasoningType: 'none',\n      supportsWebSearch: false,\n      supportsFileSearch: false,\n      supportsCodeInterpreter: false,\n      supportsComputerUse: false,\n      supportsShellTool: false,\n      supportsTextEditor: false,\n      supportsApplyPatch: false,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: false,\n      supportsImageInput: false,",
    "'gitlab-duo-agentic': {\n    provider: 'gitlab',\n    providerModelId: 'duo-chat-sonnet-4-5',\n    tier: 'standard',\n    displayName: 'GitLab Duo Agentic Chat',\n    capabilities: {\n      supportsExtendedThinking: true,\n      reasoningType: 'budget',\n      reasoningRange: ['high', 'max'],\n      supportsWebSearch: false,\n      supportsFileSearch: false,\n      supportsCodeInterpreter: true,\n      supportsComputerUse: false,\n      supportsShellTool: true,\n      supportsTextEditor: false,\n      supportsApplyPatch: false,\n      supportsEffortParameter: false,\n      supportsUrlContext: false,\n      supportsMapsGrounding: false,\n      supportsPdfInput: true,\n      supportsImageInput: true,"
)

with open("server/src/routes/ai/modelCatalog.ts", "w") as f:
    f.write(content)

