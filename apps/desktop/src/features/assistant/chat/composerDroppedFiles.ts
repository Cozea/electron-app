import { resolveDroppedFileSystemPath } from "@/features/projects/lib/resolveDroppedLocalFolderPath"

/**
 * How a drop onto an agent tile splits up. Only images can ride along as real
 * attachments: `ChatAttachment` in the provider contract is image-only, so a
 * PDF, a CSV or a folder reaches the agent as a path it opens itself.
 */
export interface DroppedComposerFilePartition {
  /** Files the provider can carry as attachments. */
  images: File[]
  /** Paths to mention in the composer, workspace relative where possible. */
  mentionPaths: string[]
  /** Names of dropped files that carried no local path to mention. */
  unresolvedNames: string[]
}

export interface PartitionDroppedComposerFilesOptions {
  resolvePath?: (file: File) => string
  workspaceRoot?: string | null
}

/**
 * Trim a dropped absolute path down to a workspace relative one, matching what
 * the `@` file menu inserts. Paths outside the workspace stay absolute so the
 * agent can still find them.
 */
export function toComposerMentionPath(absolutePath: string, workspaceRoot: string | null): string {
  const path = absolutePath.trim()
  if (path.length === 0) return ""

  const root = (workspaceRoot ?? "").trim().replace(/[/\\]+$/, "")
  if (root.length === 0) return path

  for (const separator of ["/", "\\"]) {
    const prefix = `${root}${separator}`
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    return relative.length > 0 ? relative : path
  }

  return path
}

export function partitionDroppedComposerFiles(
  files: readonly File[],
  options: PartitionDroppedComposerFilesOptions = {},
): DroppedComposerFilePartition {
  const images: File[] = []
  const mentionPaths: string[] = []
  const unresolvedNames: string[] = []

  for (const file of files) {
    if (file.type.startsWith("image/")) {
      images.push(file)
      continue
    }

    const absolutePath = resolveDroppedFileSystemPath(file, options.resolvePath)
    const mentionPath = toComposerMentionPath(absolutePath, options.workspaceRoot ?? null)
    if (mentionPath.length === 0) {
      unresolvedNames.push(file.name || "file")
      continue
    }
    if (mentionPaths.includes(mentionPath)) continue
    mentionPaths.push(mentionPath)
  }

  return { images, mentionPaths, unresolvedNames }
}

/**
 * Append `@path` mentions to the end of the composer. The trailing space is
 * what turns the token into a mention chip, so every appended path keeps one.
 */
export function appendComposerMentions(text: string, mentionPaths: readonly string[]): string {
  if (mentionPaths.length === 0) return text

  const mentions = mentionPaths.map((path) => `@${path}`).join(" ")
  if (text.length === 0) return `${mentions} `
  return `${text}${/\s$/.test(text) ? "" : " "}${mentions} `
}
