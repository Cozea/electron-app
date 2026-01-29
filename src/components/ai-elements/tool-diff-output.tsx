"use client"

import { useMemo } from 'react'
import { CodeDiffViewer } from './code-diff-viewer'

export interface ToolDiffData {
  /** File path being edited */
  filePath: string
  /** Original content (before edit) */
  original: string
  /** Modified content (after edit) */
  modified: string
}

export interface ToolDiffOutputProps {
  /** Tool name to determine how to extract diff data */
  toolName: string
  /** Tool input containing the edit data */
  input: Record<string, unknown>
  /** Tool output (optional, for additional context) */
  output?: unknown
  /** Maximum height for the diff viewer */
  maxHeight?: number
  /** Use inline diff view */
  inline?: boolean
}

/**
 * Extract diff data from tool input based on tool type
 */
function extractDiffData(
  toolName: string,
  input: Record<string, unknown>
): ToolDiffData | ToolDiffData[] | null {
  switch (toolName) {
    case 'replace_string_in_file': {
      const filePath = String(input.filePath || input.file_path || '')
      const oldString = String(input.oldString || input.old_string || '')
      const newString = String(input.newString || input.new_string || '')

      if (!filePath || !oldString) return null

      return {
        filePath,
        original: oldString,
        modified: newString,
      }
    }

    case 'multi_replace_string_in_file': {
      const replacements = input.replacements as Array<{
        filePath?: string
        file_path?: string
        oldString?: string
        old_string?: string
        newString?: string
        new_string?: string
      }> | undefined

      if (!Array.isArray(replacements) || replacements.length === 0) return null

      return replacements.map((r) => ({
        filePath: String(r.filePath || r.file_path || ''),
        original: String(r.oldString || r.old_string || ''),
        modified: String(r.newString || r.new_string || ''),
      })).filter((d) => d.filePath && d.original)
    }

    case 'create_file': {
      const filePath = String(input.filePath || input.file_path || '')
      const content = String(input.content || '')

      if (!filePath) return null

      return {
        filePath,
        original: '',
        modified: content,
      }
    }

    default:
      return null
  }
}

/**
 * Check if a tool is a file edit tool that should show diff
 */
export function isFileEditTool(toolName: string): boolean {
  return [
    'replace_string_in_file',
    'multi_replace_string_in_file',
    'create_file',
  ].includes(toolName)
}

/**
 * Renders a Monaco diff viewer for file edit tools
 */
export function ToolDiffOutput({
  toolName,
  input,
  maxHeight = 300,
  inline = false,
}: ToolDiffOutputProps) {
  const diffData = useMemo(
    () => extractDiffData(toolName, input),
    [toolName, input]
  )

  if (!diffData) {
    return null
  }

  // Handle multiple diffs (multi_replace_string_in_file)
  if (Array.isArray(diffData)) {
    if (diffData.length === 0) return null

    return (
      <div className="space-y-3 p-4">
        {diffData.map((diff, index) => (
          <CodeDiffViewer
            key={`${diff.filePath}-${index}`}
            original={diff.original}
            modified={diff.modified}
            filePath={diff.filePath}
            maxHeight={maxHeight}
            inline={inline}
            showHeader={true}
          />
        ))}
      </div>
    )
  }

  // Single diff
  return (
    <div className="p-4">
      <CodeDiffViewer
        original={diffData.original}
        modified={diffData.modified}
        filePath={diffData.filePath}
        maxHeight={maxHeight}
        inline={inline}
        showHeader={true}
      />
    </div>
  )
}
