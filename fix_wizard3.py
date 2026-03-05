import re

with open("src/components/wizard/WizardConversation.tsx", "r") as f:
    content = f.read()

content = content.replace("import { BillingError, parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'", "import { BillingError, type BillingErrorData } from '@/components/assistant/BillingError'")
content = content.replace("import { useAiChatTransport } from '@/lib/ai/useAiChatTransport'\n", "")
content = content.replace("    retryHint,\n", "")
content = content.replace("    billingError: hookBillingError,\n", "")
content = content.replace("    setBillingError: setHookBillingError,\n", "")

with open("src/components/wizard/WizardConversation.tsx", "w") as f:
    f.write(content)
