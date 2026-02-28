import re

with open("src/components/builder/BuilderConversation.tsx", "r") as f:
    content = f.read()

content = content.replace("interface ChatMessageLike {\n  id?: string\n}\n\n", "")

with open("src/components/builder/BuilderConversation.tsx", "w") as f:
    f.write(content)
