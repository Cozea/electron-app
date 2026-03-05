import re

with open("src/components/builder/BuilderConversation.tsx", "r") as f:
    content = f.read()

# Replace useChat import and usages
content = content.replace("import { useChat } from '@ai-sdk/react'", "import { useCozeaChat } from '@/hooks/useCozeaChat'")

# Use CozeaChat instead of useChat and pass useAiChatTransport options
pattern = r"""  const \{ transport: chatTransport \} = useAiChatTransport\(\{
    accessToken,
    organizationId: currentOrganization\?\.organizationId,
    model,
    conversationId,
    agentId: 'build',
    surface: 'builder',
    variantId: promptSettings\?\.variantId ?? 'medium',
    enableTools,
    enableWebSearch,
    extraBody: \{
      projectContext: projectContextPayload,
      \.\.\.\(providerOptions \? \{ providerOptions \} : \{\}\),
    \},
    providerAuthHeader,
    api: chatApi,
  \}\)"""

replacement = """"""
content = re.sub(pattern, replacement, content, flags=re.DOTALL)

# Handle the case where variantId logic changed slightly previously
pattern_alt = r"""  const \{ transport: chatTransport \} = useAiChatTransport\(\{
    accessToken,
    organizationId: currentOrganization\?\.organizationId,
    model,
    conversationId,
    agentId: 'build',
    surface: 'builder',
    variantId,
    enableTools,
    enableWebSearch,
    extraBody: \{
      projectContext: projectContextPayload,
      \.\.\.\(providerOptions \? \{ providerOptions \} : \{\}\),
    \},
    providerAuthHeader,
    api: chatApi,
  \}\)"""

content = re.sub(pattern_alt, replacement, content, flags=re.DOTALL)


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
      console\.error\('Builder chat error:', err\)

      const billingErr = parseBillingError\(err\)
      if \(billingErr\) \{
        // Billing errors are always fatal
        setBillingError\(billingErr\)
        onBillingError\?.\(billingErr\)
        onError\(billingErr\.title \|\| 'Billing Error'\)
        return
      \}

      const message = err instanceof Error
        \? err\.message
        : typeof err === 'string'
          \? err
          : 'Build failed'
      lastErrorRef\.current = message
      const retryHint = latestRetryHintRef\.current

      if \(retryHint\?\.code === 'duplicate_response_item_id' \|\| isDuplicateResponseItemError\(message\)\) \{
        autoContinueBlockedRef\.current = 'duplicate-response-item-id'
        onError\('Build paused: provider rejected duplicated response item IDs\. Retry once to continue\.'\)
        return
      \}

      if \(retryHint && !retryHint\.retryable\) \{
        onError\(message\)
        return
      \}

      // Check if we should let auto-continue recover from this error
      if \(shouldAllowRecovery\(\)\) \{
        console\.log\('\[Builder\] Error occurred but allowing recovery via auto-continue:', message\)
        isRecoveringRef\.current = true
        // Don't propagate error yet - auto-continue will try to recover
        return
      \}

      onError\(message\)
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
    retryHint: hookRetryHint,
    billingError,
    setBillingError,
  } = useCozeaChat({
    transportArgs: {
      accessToken,
      organizationId: currentOrganization?.organizationId,
      model,
      conversationId,
      agentId: 'build',
      surface: 'builder',
      variantId,
      enableTools,
      enableWebSearch,
      extraBody: {
        projectContext: projectContextPayload,
        ...(providerOptions ? { providerOptions } : {}),
      },
      providerAuthHeader,
      api: chatApi,
    },
    chatOptions: {
      onToolCall: handleToolCall,
      onError: (err: unknown) => {
        console.error('Builder chat error:', err)
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Build failed'
        lastErrorRef.current = message

        const currentRetryHint = latestRetryHintRef.current
        if (currentRetryHint?.code === 'duplicate_response_item_id' || isDuplicateResponseItemError(message)) {
          autoContinueBlockedRef.current = 'duplicate-response-item-id'
          onError('Build paused: provider rejected duplicated response item IDs. Retry once to continue.')
          return
        }

        if (currentRetryHint && !currentRetryHint.retryable) {
          onError(message)
          return
        }

        if (shouldAllowRecovery()) {
          console.log('[Builder] Error occurred but allowing recovery via auto-continue:', message)
          isRecoveringRef.current = true
          return
        }
        onError(message)
      },
    },
    onBillingError: (err) => {
      onBillingError?.(err as any)
      onError(err.title || 'Billing Error')
    },
  })
  
  useEffect(() => {
    latestRetryHintRef.current = hookRetryHint
  }, [hookRetryHint])"""

content = re.sub(pattern2, replacement2, content, flags=re.DOTALL)

# Fix local dedupedMessages
content = content.replace("const dedupedMessages = useMemo(() => dedupeMessagesById(messages), [messages])", "")
content = re.sub(
    r"  useEffect\(\(\) => \{\n    const typedMessages = dedupedMessages as Array<\{\n      parts: Array<\{ type: string \} & Record<string, unknown>>\n    \}>\n    latestRetryHintRef\.current = readLatestRetryHint\(typedMessages\)\n  \}, \[dedupedMessages\]\)\n",
    "",
    content,
    flags=re.DOTALL
)

# Clean imports
content = content.replace("import { useAiChatTransport } from '@/lib/ai/useAiChatTransport'\n", "")
content = content.replace("import { readLatestRetryHint, type RetryHint } from '@/lib/ai/retryHints'", "import { type RetryHint } from '@/lib/ai/retryHints'")
content = content.replace("import { dedupeMessagesById } from '@/lib/ai/useAiChatTransport'\n", "")

# We removed variantId fallback earlier, verify it:
content = content.replace("const variantId = promptSettings?.variantId ?? 'medium'", "const variantId = promptSettings?.variantId")

with open("src/components/builder/BuilderConversation.tsx", "w") as f:
    f.write(content)
