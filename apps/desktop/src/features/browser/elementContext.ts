import type { ThreadId } from "@cozea/contracts/t3/baseSchemas"
import type { PickedElementPayload, PickedElementStackFrame } from "@cozea/contracts/t3/ipc"

const ELEMENT_CONTEXT_HTML_PREVIEW_LIMIT = 4_000
const ELEMENT_CONTEXT_STYLES_LIMIT = 4_000
const ELEMENT_CONTEXT_LABEL_TAG_MAX = 24

const TRAILING_ELEMENT_CONTEXT_BLOCK_PATTERN =
  /\n*<element_context>\n([\s\S]*?)\n<\/element_context>\s*$/

export interface ElementContextSelection {
  pageUrl: string
  pageTitle: string | null
  tagName: string
  selector: string | null
  htmlPreview: string
  componentName: string | null
  source: PickedElementStackFrame | null
  styles: string
}

export interface ElementContextDraft extends ElementContextSelection {
  id: string
  threadId: ThreadId
  pickedAt: string
}

export interface ParsedElementContextEntry {
  header: string
  body: string
}

export interface ExtractedElementContexts {
  promptText: string
  contextCount: number
  contexts: ParsedElementContextEntry[]
}

function truncateString(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 1))}…`
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "")
}

export function normalizeElementContextSelection(
  raw: PickedElementPayload,
): ElementContextSelection | null {
  const pageUrl = raw.pageUrl.trim()
  const tagName = raw.tagName.trim().toLowerCase()
  if (pageUrl.length === 0 || tagName.length === 0) return null
  const stackFrame = raw.source ?? raw.stack[0] ?? null
  return {
    pageUrl,
    pageTitle: raw.pageTitle?.trim() ?? null,
    tagName,
    selector: raw.selector?.trim() || null,
    htmlPreview: truncateString(normalizeText(raw.htmlPreview), ELEMENT_CONTEXT_HTML_PREVIEW_LIMIT),
    componentName: raw.componentName?.trim() || null,
    source: stackFrame
      ? {
          functionName: stackFrame.functionName?.trim() || null,
          fileName: stackFrame.fileName?.trim() || null,
          lineNumber: stackFrame.lineNumber ?? null,
          columnNumber: stackFrame.columnNumber ?? null,
        }
      : null,
    styles: truncateString(normalizeText(raw.styles), ELEMENT_CONTEXT_STYLES_LIMIT),
  }
}

export function elementContextDedupKey(context: ElementContextSelection): string {
  return [context.pageUrl, context.selector ?? "", context.tagName, context.componentName ?? ""]
    .join("|")
    .toLowerCase()
}

function shortenTagLabel(tagName: string): string {
  if (tagName.length <= ELEMENT_CONTEXT_LABEL_TAG_MAX) return tagName
  return `${tagName.slice(0, ELEMENT_CONTEXT_LABEL_TAG_MAX - 1)}…`
}

export function formatElementContextLabel(context: ElementContextSelection): string {
  if (context.componentName) return `<${context.componentName}>`
  return `<${shortenTagLabel(context.tagName)}>`
}

function basenameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]/)
  return parts[parts.length - 1] ?? filePath
}

export function formatElementContextSourceLabel(context: ElementContextSelection): string | null {
  const source = context.source
  if (!source?.fileName) return null
  const base = basenameFromPath(source.fileName)
  if (source.lineNumber == null) return base
  return `${base}:${source.lineNumber}`
}

function buildContextHeader(context: ElementContextSelection): string {
  const label = formatElementContextLabel(context)
  const source = formatElementContextSourceLabel(context)
  return source ? `${label} (${source})` : label
}

function indentLines(value: string): string[] {
  return value.split("\n").map((line) => `  ${line}`)
}

function buildSingleContextLines(context: ElementContextSelection): string[] {
  const lines = [`- ${buildContextHeader(context)}:`]
  if (context.pageUrl.length > 0) lines.push(`  url: ${context.pageUrl}`)
  if (context.selector) lines.push(`  selector: ${context.selector}`)
  if (context.source?.fileName) {
    const { fileName, lineNumber, columnNumber } = context.source
    const location =
      lineNumber != null
        ? `${fileName}:${lineNumber}${columnNumber != null ? `:${columnNumber}` : ""}`
        : fileName
    lines.push(`  source: ${location}`)
  }
  const html = context.htmlPreview.trim()
  if (html.length > 0) lines.push("  html:", ...indentLines(html))
  const styles = context.styles.trim()
  if (styles.length > 0) lines.push("  styles:", ...indentLines(styles))
  return lines
}

export function buildElementContextBlock(contexts: ReadonlyArray<ElementContextSelection>): string {
  if (contexts.length === 0) return ""
  const lines: string[] = []
  for (let index = 0; index < contexts.length; index += 1) {
    lines.push(...buildSingleContextLines(contexts[index]!))
    if (index < contexts.length - 1) lines.push("")
  }
  return ["<element_context>", ...lines, "</element_context>"].join("\n")
}

export function appendElementContextsToPrompt(
  prompt: string,
  contexts: ReadonlyArray<ElementContextSelection>,
): string {
  const block = buildElementContextBlock(contexts)
  if (block.length === 0) return prompt
  const trimmed = prompt.trim()
  return trimmed.length > 0 ? `${trimmed}\n\n${block}` : block
}

let nextElementContextSequence = 0

export function newElementContextId(): string {
  nextElementContextSequence += 1
  return `el_${nextElementContextSequence.toString(36)}`
}

export function extractTrailingElementContexts(prompt: string): ExtractedElementContexts {
  const match = TRAILING_ELEMENT_CONTEXT_BLOCK_PATTERN.exec(prompt)
  if (!match) return { promptText: prompt, contextCount: 0, contexts: [] }
  const promptText = prompt.slice(0, match.index).replace(/\n+$/, "")
  const contexts = parseElementContextEntries(match[1] ?? "")
  return { promptText, contextCount: contexts.length, contexts }
}

function parseElementContextEntries(block: string): ParsedElementContextEntry[] {
  const entries: ParsedElementContextEntry[] = []
  let current: { header: string; bodyLines: string[] } | null = null
  const commit = () => {
    if (!current) return
    entries.push({ header: current.header, body: current.bodyLines.join("\n").trimEnd() })
    current = null
  }
  for (const line of block.split("\n")) {
    const headerMatch = /^- (.+):$/.exec(line)
    if (headerMatch) {
      commit()
      current = { header: headerMatch[1]!, bodyLines: [] }
      continue
    }
    if (!current) continue
    if (line.startsWith("  ")) current.bodyLines.push(line.slice(2))
    else if (line.length === 0) current.bodyLines.push("")
  }
  commit()
  return entries
}
