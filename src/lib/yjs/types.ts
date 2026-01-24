import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

export interface CollaboratorState {
  user: { id: string; name: string; color: string; isAgent?: boolean }
  cursor?: { filePath: string; line: number; column: number }
}

export interface YjsProjectDocInterface {
  doc: Y.Doc
  files: Y.Map<Y.Text>
  awareness: Awareness
  getFileText(path: string): Y.Text
  initializeFile(path: string, content: string): void
  applyExternalChange(path: string, newContent: string): void
}
