import type { AvailableExternalEditor, ExternalEditorId } from '@shared/electronApiTypes'

import { resolveProjectSourcePath } from '@/features/projects/lib/projectSourcePath'

export const PREVIEW_EDITOR_PREFERENCE_KEY = 'cozea.preview.editor'

const SUPPORTED_EXTERNAL_EDITOR_IDS: ExternalEditorId[] = [
  'vscode',
  'vscode-insiders',
  'cursor',
  'windsurf',
  'vscodium',
  'zed',
  'antigravity',
  'webstorm',
  'intellij-idea',
  'phpstorm',
  'pycharm',
  'rider',
  'goland',
  'rubymine',
  'clion',
  'datagrip',
]

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

function normalizeProjectPath(projectPath: string | null): string | null {
  if (!projectPath) return null
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
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
  projectPath: string | null
): Promise<string> {
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  const resolvedRelativePath =
    normalizedProjectPath != null
      ? await resolveProjectSourcePath(normalizedFilePath, normalizedProjectPath)
      : null

  if (resolvedRelativePath && normalizedProjectPath) {
    return `${normalizedProjectPath}/${resolvedRelativePath.replace(/^\/+/, '')}`
  }

  if (normalizedProjectPath && !isAbsolutePath(normalizedFilePath) && !normalizedFilePath.startsWith(normalizedProjectPath)) {
    return `${normalizedProjectPath}/${normalizedFilePath.replace(/^\/+/, '')}`
  }

  return normalizedFilePath
}

export async function openProjectFileInExternalEditor(options: {
  availableEditors?: AvailableExternalEditor[]
  filePath: string
  line?: number
  column?: number
  preferredEditorId?: ExternalEditorId | null
  projectPath: string | null
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

  const absoluteFilePath = await resolveAbsoluteProjectFilePath(options.filePath, options.projectPath)
  const result = await window.electronAPI.editor.openInEditor({
    editorId,
    filePath: absoluteFilePath,
    line: options.line,
    column: options.column,
  })

  return {
    success: result.success,
    editorId,
    error: result.success ? undefined : result.error,
  }
}
