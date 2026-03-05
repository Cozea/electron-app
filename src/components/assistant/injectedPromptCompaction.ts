export interface InjectedPromptField {
  label: string
  value: string
}

export interface InjectedPromptPreview {
  kind: 'terminal' | 'inspector' | 'problem'
  title: string
  subtitle: string
  snippet?: string
  fields?: InjectedPromptField[]
  pillText?: string
}

function compactSnippet(value: string, maxLength = 180): string | undefined {
  const normalized = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .trim()

  if (!normalized) return undefined
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

function truncateAtWordCount(value: string, maxWords: number): string | undefined {
  const words = value
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)

  if (words.length === 0) return undefined
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}…`
}

export function parseInjectedPromptForCompaction(text: string): InjectedPromptPreview | null {
  const normalized = text.trim()
  if (!normalized) return null

  const terminalMatch = normalized.match(
    /^(Help me understand this terminal output:|Explain this error and suggest how to fix it:)\s*```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```(?:\s*User request:\s*([\s\S]*))?$/m
  )
  if (terminalMatch) {
    const intent = terminalMatch[1]
    const terminalBody = terminalMatch[2]?.trim() ?? ''
    const userRequest = terminalMatch[3]?.trim() ?? ''
    const pillText = truncateAtWordCount(userRequest || terminalBody, 4) || 'Terminal output'

    return {
      kind: 'terminal',
      title: 'Terminal context',
      subtitle:
        intent.startsWith('Explain')
          ? 'Error analysis request'
          : 'Terminal output analysis request',
      snippet: compactSnippet(userRequest || terminalBody),
      pillText,
    }
  }

  if (normalized.startsWith('Help me diagnose and fix this problem.')) {
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)

    const severity = lines.find((line) => line.startsWith('Severity: '))
    const source = lines.find((line) => line.startsWith('Source: '))
    const location = lines.find((line) => line.startsWith('Location: '))
    const message = lines.find((line) => line.startsWith('Message: '))
    const messageText = message ? message.replace(/^Message:\s*/, '').trim() : ''
    const messageWords = messageText.split(/\s+/).filter(Boolean)
    const firstWord = messageWords[0] ?? 'Problem'
    const secondWord = messageWords[1]
    const secondWordShort =
      secondWord && secondWord.length > 5 ? `${secondWord.slice(0, 5)}…` : secondWord
    const pillText = secondWordShort ? `${firstWord} ${secondWordShort}` : firstWord

    const fields: InjectedPromptField[] = []
    if (severity) fields.push({ label: 'Severity', value: severity.replace(/^Severity:\s*/, '') })
    if (source) fields.push({ label: 'Source', value: source.replace(/^Source:\s*/, '') })
    if (location) fields.push({ label: 'Location', value: location.replace(/^Location:\s*/, '') })

    return {
      kind: 'problem',
      title: 'Problem context',
      subtitle: 'Diagnostic issue details',
      snippet: messageText ? compactSnippet(messageText) : undefined,
      fields: fields.length > 0 ? fields : undefined,
      pillText,
    }
  }

  if (!normalized.startsWith('I right-clicked an element in the preview inspector.')) {
    return null
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const pageLine = lines.find((line) => line.startsWith('Page: '))
  const selectorLine = lines.find((line) => line.startsWith('Selector: '))
  const stackLine = lines.find((line) => line.startsWith('React component stack: '))
  const changePromptIndex = lines.findIndex((line) => line.toLowerCase() === 'what i want to change:')
  const requestedChange =
    changePromptIndex >= 0
      ? lines.slice(changePromptIndex + 1).join(' ').trim()
      : ''

  const fields: InjectedPromptField[] = []
  const selectorValue = selectorLine ? selectorLine.replace(/^Selector:\s*/, '') : ''
  if (pageLine) fields.push({ label: 'Page', value: pageLine.replace(/^Page:\s*/, '') })
  if (selectorLine) fields.push({ label: 'Selector', value: selectorValue })
  if (stackLine) fields.push({ label: 'Stack', value: stackLine.replace(/^React component stack:\s*/, '') })

  return {
    kind: 'inspector',
    title: 'Inspector context',
    subtitle: 'Element details from preview inspector',
    snippet: compactSnippet(requestedChange),
    fields: fields.length > 0 ? fields : undefined,
    pillText: selectorValue || 'Inspected element',
  }
}
