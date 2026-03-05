import re

with open("src/components/wizard/WizardConversation.tsx", "r") as f:
    content = f.read()

# Replace useChat import and usages
content = content.replace("import { useChat } from '@ai-sdk/react'", "import { useCozeaChat } from '@/hooks/useCozeaChat'")

# Use CozeaChat instead of useChat and pass useAiChatTransport options
pattern = r"""  const \{ transport: chatTransport \} = useAiChatTransport\(\{
    accessToken,
    organizationId: currentOrganization\?\.organizationId,
    model,
    conversationId,
    agentId: 'plan',
    surface: 'wizard',
    variantId: normalizedVariantId,
    enableTools: true,
    enableWebSearch: true,
    extraBody: \{
      projectContext: \{
        name: projectId \|\| 'wizard-project',
        slug: \(projectId \|\| 'wizard-project'\)\.toLowerCase\(\),
        runtime: 'local',
      \},
    \},
    providerAuthHeader,
    api: chatApi,
  \}\)"""

replacement = """"""

content = re.sub(pattern, replacement, content, flags=re.DOTALL)


pattern2 = r"""  // useChat hook
  const \{
    messages,
    status,
    error,
    sendMessage,
    stop,
    addToolOutput,
  \} = useChat\(\{
    transport: chatTransport,
    sendAutomaticallyWhen: \(\{ messages \}\) =>
      lastAssistantMessageIsCompleteWithToolCalls\(\{ messages \}\) \|\|
      lastAssistantMessageIsCompleteWithApprovalResponses\(\{ messages \}\),
    onToolCall: handleToolCall,
    onError: \(err: unknown\) => \{
      console\.error\('Chat error:', err\)
      const billingErr = parseBillingError\(err\)
      if \(billingErr\) \{
        setBillingError\(billingErr\)
      \}
    \},
  \}\)"""

replacement2 = """  // useChat hook
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    addToolOutput,
    dedupedMessages,
    retryHint,
    billingError: hookBillingError,
    setBillingError: setHookBillingError,
  } = useCozeaChat({
    transportArgs: {
      accessToken,
      organizationId: currentOrganization?.organizationId,
      model,
      conversationId,
      agentId: 'plan',
      surface: 'wizard',
      variantId: normalizedVariantId,
      enableTools: true,
      enableWebSearch: true,
      extraBody: {
        projectContext: {
          name: projectId || 'wizard-project',
          slug: (projectId || 'wizard-project').toLowerCase(),
          runtime: 'local',
        },
      },
      providerAuthHeader,
      api: chatApi,
    },
    chatOptions: {
      onToolCall: handleToolCall,
    },
    onBillingError: (err) => setBillingError(err as any),
  })"""

content = re.sub(pattern2, replacement2, content, flags=re.DOTALL)

# Fix variables
content = content.replace("for (const message of messages) {", "for (const message of dedupedMessages) {")
content = re.sub(
    r"  const genericErrorMessage = useMemo\(\(\) => \{\n    if \(!error\) return null\n    const retryHint = readLatestRetryHint\(\n      messages as Array<\{ parts: Array<\{ type: string \} & Record<string, unknown>> \}>\n    \)\n    const retryHintMessage = getRetryHintMessage\(retryHint\)\n    const message = \(error as \{ message\?: string \}\)\.message\n    if \(typeof message === 'string' && message\.trim\(\)\) return message\n    if \(typeof error === 'string' && \(error as string\)\.trim\(\)\) return error as string\n    return 'Something went wrong'\n  \}, \[error, messages\]\)",
    """  const genericErrorMessage = useMemo(() => {
    if (!error || billingError) return null
    const retryHintMessage = getRetryHintMessage(retryHint)
    if (retryHintMessage) return retryHintMessage
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    const errorStr = error as unknown
    if (typeof errorStr === 'string' && errorStr.trim()) return errorStr
    return 'Something went wrong'
  }, [error, billingError, retryHint])""",
    content
)

# Clean imports
content = content.replace("import { useAiChatTransport, dedupeMessagesById } from '@/lib/ai/useAiChatTransport'\n", "")
content = content.replace("import { getRetryHintMessage, readLatestRetryHint } from '@/lib/ai/retryHints'", "import { getRetryHintMessage } from '@/lib/ai/retryHints'")
content = content.replace("import {\n  BillingError,\n  parseBillingError,\n  type BillingErrorData,\n} from '@/components/assistant/BillingError'", "import { BillingError, type BillingErrorData } from '@/components/assistant/BillingError'")

# Remove useMemo dedupe
content = content.replace("const dedupedMessages = useMemo(() => dedupeMessagesById(messages), [messages])", "")

with open("src/components/wizard/WizardConversation.tsx", "w") as f:
    f.write(content)
