import re

with open("src/components/wizard/WizardConversation.tsx", "r") as f:
    content = f.read()

content = content.replace("type ChatHookResult = ReturnType<typeof useChat>", "type ChatHookResult = ReturnType<typeof useCozeaChat>")
content = content.replace("import {\n  lastAssistantMessageIsCompleteWithToolCalls,\n  lastAssistantMessageIsCompleteWithApprovalResponses,\n  type UIMessage,\n} from 'ai'", "import {\n  type UIMessage,\n} from 'ai'")

with open("src/components/wizard/WizardConversation.tsx", "w") as f:
    f.write(content)
