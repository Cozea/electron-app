import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'

import { resolveProjectSourcePath } from '@/features/projects/lib/projectSourcePath'

export const PREVIEW_EDITOR_PREFERENCE_KEY = 'cozea.preview.editor'

export const T3_STYLE_EDITOR_ORDER: ReadonlyArray<ExternalEditorId> = [
  'cursor',
  'vscode',
  'zed',
  'antigravity',
  'windsurf',
  'vscode-insiders',
  'vscodium',
  'webstorm',
  'intellij-idea',
  'phpstorm',
  'pycharm',
  'rider',
  'goland',
  'rubymine',
  'clion',
  'datagrip',
  'finder',
]

const SUPPORTED_EXTERNAL_EDITOR_IDS: ExternalEditorId[] = [...T3_STYLE_EDITOR_ORDER]

export function orderDetectedEditors<T extends { id: ExternalEditorId }>(
  availableEditors: ReadonlyArray<T>
): T[] {
  const byId = new Map(availableEditors.map((editor) => [editor.id, editor] as const))
  const seen = new Set<ExternalEditorId>()
  const ordered: T[] = []

  for (const editorId of T3_STYLE_EDITOR_ORDER) {
    const editor = byId.get(editorId)
    if (!editor) continue
    ordered.push(editor)
    seen.add(editor.id)
  }

  for (const editor of availableEditors) {
    if (seen.has(editor.id)) continue
    ordered.push(editor)
  }

  return ordered
}

export function readStoredExternalEditorPreference(): ExternalEditorId | null {
  try {
    const stored = window.localStorage.getItem(PREVIEW_EDITOR_PREFERENCE_KEY)
    if (!stored || stored === 'cozea') return null
    return SUPPORTED_EXTERNAL_EDITOR_IDS.includes(stored as ExternalEditorId)
      ? (stored as ExternalEditorId)
      : null
  } catch {
    return null
  }
}

export function resolvePreferredExternalEditorId(
  availableEditors: AvailableExternalEditor[],
  preferredEditorId: ExternalEditorId | null
): ExternalEditorId | null {
  if (preferredEditorId && availableEditors.some((editor) => editor.id === preferredEditorId)) {
    return preferredEditorId
  }

  return availableEditors[0]?.id ?? null
}

export async function resolveAbsoluteProjectFilePath(
  filePath: string,
  workspaceId: string | null
): Promise<string> {
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  if (!workspaceId) {
    return normalizedFilePath
  }

  return (
    (await resolveProjectSourcePath(normalizedFilePath, workspaceId)) ??
    normalizedFilePath.replace(/^\/+/, '')
  )
}

export async function openProjectFileInExternalEditor(options: {
  availableEditors?: AvailableExternalEditor[]
  filePath: string
  line?: number
  column?: number
  preferredEditorId?: ExternalEditorId | null
  workspaceId: string | null
}): Promise<{ success: boolean; editorId: ExternalEditorId | null; error?: string }> {
  const availableEditors =
    options.availableEditors ?? (await window.electronAPI.editor.listAvailableEditors())
  const editorId = resolvePreferredExternalEditorId(
    availableEditors,
    options.preferredEditorId ?? readStoredExternalEditorPreference()
  )

  if (!editorId) {
    return {
      success: false,
      editorId: null,
      error: 'No supported external editor is installed.',
    }
  }

  const projectRelativePath = await resolveAbsoluteProjectFilePath(options.filePath, options.workspaceId)
  const result = await window.electronAPI.editor.openInEditor({
    editorId,
    ...(options.workspaceId
      ? { workspaceId: options.workspaceId, path: projectRelativePath || '.' }
      : { filePath: projectRelativePath }),
    line: options.line,
    column: options.column,
  })

  return {
    success: result.success,
    editorId,
    error: result.success ? undefined : result.error,
  }
}
