import re

with open("src/components/builder/BuilderConversation.tsx", "r") as f:
    content = f.read()

content = content.replace(
    "function dedupeMessagesById<T extends ChatMessageLike>(messages: T[]): T[] {\n  if (messages.length <= 1) return messages\n\n  const lastIndexById = new Map<string, number>()\n  for (let index = 0; index < messages.length; index += 1) {\n    const messageId = messages[index]?.id\n    if (!messageId) continue\n    lastIndexById.set(messageId, index)\n  }\n\n  return messages.filter((message, index) => {\n    if (!message.id) return true\n    return lastIndexById.get(message.id) === index\n  })\n}\n",
    ""
)

with open("src/components/builder/BuilderConversation.tsx", "w") as f:
    f.write(content)
