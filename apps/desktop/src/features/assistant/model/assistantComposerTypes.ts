export type UserInputAnswerDrafts = Record<string, Record<string, string | string[]>>

export interface ProviderModelOptionsByProvider {
  antigravity: ReadonlyArray<{ slug: string; name: string }>
  codex: ReadonlyArray<{ slug: string; name: string }>
  claudeAgent: ReadonlyArray<{ slug: string; name: string }>
  cursor: ReadonlyArray<{ slug: string; name: string }>
  opencode: ReadonlyArray<{ slug: string; name: string }>
}

export interface ComposerImageDraft {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file?: File
}
