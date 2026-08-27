import { Fragment, memo, useMemo, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const INLINE_COMMENT_TOKEN_PATTERN =
  "(\\*\\*[^*\\n][\\s\\S]*?\\*\\*|\\*[^*\\n][\\s\\S]*?\\*|<u>[\\s\\S]+?<\\/u>|\\[[^\\]\\n]+\\]\\([^)]+?\\))"
const INLINE_TOKEN_DETECTOR = /(\*\*|\*|<u>|\[)/
const COMMENT_LINK_PATTERN = /^\[([^\]\n]+)\]\(([^)\n]+)\)$/

function normalizeCommentHref(rawHref: string): string | null {
  const trimmed = rawHref.trim()
  if (!trimmed) return null

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

function renderInlineCommentTokens(input: string, keyPrefix: string): ReactNode[] {
  if (!INLINE_TOKEN_DETECTOR.test(input)) {
    return [input]
  }

  const nodes: ReactNode[] = []
  const tokenPattern = new RegExp(INLINE_COMMENT_TOKEN_PATTERN, "g")
  let lastIndex = 0
  let tokenMatch: RegExpExecArray | null

  while ((tokenMatch = tokenPattern.exec(input)) !== null) {
    const [token] = tokenMatch
    const startIndex = tokenMatch.index

    if (startIndex > lastIndex) {
      nodes.push(input.slice(lastIndex, startIndex))
    }

    const tokenKey = `${keyPrefix}-${startIndex}`

    if (token.startsWith("**") && token.endsWith("**")) {
      const inner = token.slice(2, -2)
      nodes.push(
        <strong key={tokenKey} className="font-semibold">
          {renderInlineCommentTokens(inner, `${tokenKey}-strong`)}
        </strong>
      )
    } else if (token.startsWith("*") && token.endsWith("*")) {
      const inner = token.slice(1, -1)
      nodes.push(
        <em key={tokenKey}>
          {renderInlineCommentTokens(inner, `${tokenKey}-em`)}
        </em>
      )
    } else if (token.startsWith("<u>") && token.endsWith("</u>")) {
      const inner = token.slice(3, -4)
      nodes.push(
        <span key={tokenKey} className="underline underline-offset-2">
          {renderInlineCommentTokens(inner, `${tokenKey}-u`)}
        </span>
      )
    } else {
      const linkMatch = token.match(COMMENT_LINK_PATTERN)
      if (!linkMatch) {
        nodes.push(token)
      } else {
        const [, label, hrefCandidate] = linkMatch
        const href = normalizeCommentHref(hrefCandidate)

        if (!href) {
          nodes.push(label)
        } else {
          nodes.push(
            <a
              key={tokenKey}
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-primary underline underline-offset-2 hover:text-primary/80 pointer-events-auto"
            >
              {renderInlineCommentTokens(label, `${tokenKey}-link`)}
            </a>
          )
        }
      }
    }

    lastIndex = startIndex + token.length
  }

  if (lastIndex < input.length) {
    nodes.push(input.slice(lastIndex))
  }

  return nodes
}

function renderCommentContent(content: string): ReactNode[] {
  const lines = content.split("\n")
  return lines.map((line, index) => (
    <Fragment key={`comment-line-${index}`}>
      {renderInlineCommentTokens(line, `line-${index}`)}
      {index < lines.length - 1 && <br />}
    </Fragment>
  ))
}

interface CommentRichTextProps {
  content: string
  className?: string
}

export const CommentRichText = memo(function CommentRichText({
  content,
  className,
}: CommentRichTextProps) {
  const renderedContent = useMemo(() => renderCommentContent(content), [content])

  return (
    <div className={cn("whitespace-normal break-words", className)}>
      {renderedContent}
    </div>
  )
})
