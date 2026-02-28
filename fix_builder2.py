import re

with open("src/components/builder/BuilderConversation.tsx", "r") as f:
    content = f.read()

content = content.replace("type ChatHookResult = ReturnType<typeof useChat>", "type ChatHookResult = ReturnType<typeof useCozeaChat>")
content = content.replace("import {\n  lastAssistantMessageIsCompleteWithToolCalls,\n  lastAssistantMessageIsCompleteWithApprovalResponses,\n} from 'ai'\n", "")
content = content.replace("    billingError,\n    setBillingError,\n  } = useCozeaChat({", "  } = useCozeaChat({")

with open("src/components/builder/BuilderConversation.tsx", "w") as f:
    f.write(content)
