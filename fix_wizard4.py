import re

with open("src/components/wizard/WizardConversation.tsx", "r") as f:
    content = f.read()

content = content.replace("const retryHint = readLatestRetryHint(", "const retryHint = null // readLatestRetryHint(")

with open("src/components/wizard/WizardConversation.tsx", "w") as f:
    f.write(content)
