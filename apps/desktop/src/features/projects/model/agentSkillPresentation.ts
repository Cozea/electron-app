/** Initialisms that should not be sentence-cased when a skill slug is prettified. */
const SKILL_NAME_ACRONYMS = new Map<string, string>(
  Object.entries({
    ai: "AI", api: "API", ci: "CI", cli: "CLI", css: "CSS", db: "DB", docx: "DOCX",
    html: "HTML", io: "IO", ios: "iOS", mcp: "MCP", md: "MD", pdf: "PDF", pptx: "PPTX", pr: "PR",
    qa: "QA", sdk: "SDK", seo: "SEO", ui: "UI", ux: "UX", xlsx: "XLSX",
  }),
)

const SKILL_NAME_MINOR_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or",
  "per", "the", "to", "via", "with",
])

export function prettifySkillName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return trimmed

  const target = trimmed.includes(":")
    ? trimmed.slice(trimmed.lastIndexOf(":") + 1).trim()
    : trimmed
  if (!target || /[A-Z\s]/.test(target)) return target

  return target
    .split(/[-_]/)
    .filter(Boolean)
    .map((word, index) => {
      const acronym = SKILL_NAME_ACRONYMS.get(word.toLowerCase())
      if (acronym) return acronym
      if (index > 0 && SKILL_NAME_MINOR_WORDS.has(word.toLowerCase())) {
        return word.toLowerCase()
      }
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(" ")
}

const CONCISE_DESCRIPTION_LIMIT = 72
const DESCRIPTION_PREAMBLE = new RegExp(
  "^(?:" +
    [
      "use\\s+(?:this\\s+skill\\s+)?(?:when|whenever|for|to)",
      "this\\s+skill\\s+(?:is\\s+for|should\\s+be\\s+used\\s+(?:when|to|for))",
      "(?:load|invoke|trigger)\\s+(?:this\\s+skill\\s+)?(?:when|before)",
    ].join("|") +
    ")\\s+" +
    "(?:the\\s+user\\s+(?:wants?|asks?|needs?)\\s+(?:to\\s+|for\\s+)?)?",
  "i",
)
const DANGLING_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "but", "by", "can", "for", "from", "in", "into", "is",
  "its", "of", "on", "or", "that", "the", "their", "them", "then", "these", "this", "to",
  "used", "uses", "using", "when", "which", "while", "with", "your",
])

function stripDescriptionPreamble(value: string): string {
  const stripped = value.replace(DESCRIPTION_PREAMBLE, "")
  if (stripped.length < 16) return value
  return stripped.charAt(0).toUpperCase() + stripped.slice(1)
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\s][^*]*)\*/g, "$1")
}

function trimDanglingWords(value: string): string {
  const words = value.split(" ")
  while (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1].toLowerCase())) {
    words.pop()
  }
  return words.join(" ")
}

export function conciseDescription(description: string): string {
  const collapsed = stripInlineMarkdown(description.replace(/\s+/g, " ")).trim()
  if (!collapsed) return "No description"

  const firstSentence = collapsed.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? collapsed
  const sentence = stripDescriptionPreamble(
    (firstSentence.length < 24 ? collapsed : firstSentence).trim(),
  )
  if (sentence.length <= CONCISE_DESCRIPTION_LIMIT) return sentence

  const budget = CONCISE_DESCRIPTION_LIMIT - 1
  const head = sentence.slice(0, budget + 1)
  const clauseBreak = Math.max(
    head.lastIndexOf(", "),
    head.lastIndexOf("; "),
    head.lastIndexOf(": "),
    head.lastIndexOf(" — "),
    head.lastIndexOf(" – "),
    head.lastIndexOf(" that "),
    head.lastIndexOf(" which "),
    head.lastIndexOf(" where "),
  )
  const cut = clauseBreak > budget / 2 ? clauseBreak : head.lastIndexOf(" ")
  const trimmed = trimDanglingWords(
    sentence.slice(0, cut > 0 ? cut : budget).replace(/[\s,;:—–-]+$/, ""),
  )
  return `${trimmed}…`
}

export const ESSENTIAL_SKILL_NOTE = "Cozea cannot disable or delete it."
